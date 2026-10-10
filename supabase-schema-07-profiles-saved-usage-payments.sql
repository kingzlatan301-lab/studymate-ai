-- StudyMate AI — schema 07
-- ───────────────────────────────────────────────────────────────────────
-- Production-audit migration. Run ONCE in the Supabase SQL editor BEFORE
-- deploying the matching frontend/api changes. It is idempotent (safe to
-- re-run) and does NOT drop any existing table, RLS policy on
-- subscriptions / weakness_profiles, or the unique constraint from
-- supabase-schema-06-payment-reference-unique.sql.
--
-- Contents
--   1. profiles               — per-account onboarding/profile (Bug 1)
--   2. saved_questions        — per-account saved questions (Bug 11)
--   3. AI usage: reserve / commit / release (Bugs 8, 9, 10, 12)
--      + closes a quota bypass in the old ai_usage UPDATE policy
--   4. payments ledger + apply_verified_payment() (Bug 19)
--   5. find_user_id_by_email() for the Paystack webhook (Bug 19)
--   6. youtube_cache hardening note (Bug 18)

-- ═══════════════════════════════════════════════════════════════════════
-- 1. PROFILES  (extends the EXISTING public.profiles, which is keyed by `id`)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists country text;
alter table public.profiles add column if not exists exam_board text;
alter table public.profiles add column if not exists exam_enabled boolean not null default false;
alter table public.profiles add column if not exists study_class text;
alter table public.profiles add column if not exists study_routine text;
alter table public.profiles add column if not exists onboarding_complete boolean not null default false;
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_lengths_chk;
alter table public.profiles add constraint profiles_lengths_chk check (
  coalesce(char_length(first_name), 0)    <= 60 and
  coalesce(char_length(country), 0)       <= 16 and
  coalesce(char_length(exam_board), 0)    <= 40 and
  coalesce(char_length(study_class), 0)   <= 60 and
  coalesce(char_length(study_routine), 0) <= 24
);

alter table public.profiles enable row level security;

drop policy if exists "select own profile" on public.profiles;
create policy "select own profile" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "insert own profile" on public.profiles;
create policy "insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. SAVED QUESTIONS
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.saved_questions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  question     text not null check (char_length(question) <= 6000),
  subject      text not null check (char_length(subject) <= 80),
  answer_data  jsonb not null,               -- the parsed AI answer object
  question_key text generated always as (md5(question || '|' || subject)) stored,
  created_at   timestamptz not null default now(),
  unique (user_id, question_key)
);

create index if not exists saved_questions_user_created_idx
  on public.saved_questions (user_id, created_at desc);

alter table public.saved_questions enable row level security;

drop policy if exists "select own saved_questions" on public.saved_questions;
create policy "select own saved_questions" on public.saved_questions
  for select using (auth.uid() = user_id);

drop policy if exists "insert own saved_questions" on public.saved_questions;
create policy "insert own saved_questions" on public.saved_questions
  for insert with check (auth.uid() = user_id);

drop policy if exists "delete own saved_questions" on public.saved_questions;
create policy "delete own saved_questions" on public.saved_questions
  for delete using (auth.uid() = user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. AI USAGE — reserve → (commit | release)
-- ═══════════════════════════════════════════════════════════════════════
-- ai_usage.count   = number of COMMITTED (successfully answered) uses for
--                    (user, feature, period_key). period_key for 'daily'
--                    is the UTC date, so a new UTC day is a brand-new row
--                    and older days can never count against today.
-- ai_usage_reservations = in-flight requests. A reservation counts against
--                    the limit until it is committed, released, or expires
--                    (so a crashed serverless invocation can't lock a
--                    student out for long).
--
-- Concurrency: reserve_usage() takes a row lock on the (user, feature,
-- period) ai_usage row, so concurrent requests for the same student are
-- serialised and can never both squeeze into the last slot.

create table if not exists public.ai_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null,
  period_key  text not null,
  count       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, feature, period_key)
);
alter table public.ai_usage enable row level security;

drop policy if exists "select own ai_usage" on public.ai_usage;
create policy "select own ai_usage" on public.ai_usage
  for select using (auth.uid() = user_id);

-- SECURITY FIX: the original schema-05 let a signed-in student INSERT and
-- UPDATE their own ai_usage rows directly through the REST API — i.e. they
-- could PATCH count back to 0 with their own token and bypass the daily
-- limit. All legitimate writes go through the SECURITY DEFINER functions
-- below, which do not need these policies.
drop policy if exists "insert own ai_usage" on public.ai_usage;
drop policy if exists "update own ai_usage" on public.ai_usage;
revoke insert, update, delete on public.ai_usage from anon, authenticated;

create table if not exists public.ai_usage_reservations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null,
  period_key  text not null,
  status      text not null default 'reserved' check (status in ('reserved', 'committed', 'released')),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '2 minutes')
);
create index if not exists ai_usage_reservations_lookup_idx
  on public.ai_usage_reservations (user_id, feature, period_key, status);

alter table public.ai_usage_reservations enable row level security;
-- No policies on purpose: students never touch this table directly.
revoke all on public.ai_usage_reservations from anon, authenticated;

-- Reserve one slot. Returns {allowed, used, reservation_id}.
create or replace function public.reserve_usage(
  p_feature text,
  p_period_key text,
  p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_committed integer;
  v_active integer;
  v_res uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  insert into ai_usage (user_id, feature, period_key, count)
  values (v_uid, p_feature, p_period_key, 0)
  on conflict (user_id, feature, period_key) do nothing;

  -- Row lock = per-student/feature/period serialisation point.
  select count into v_committed from ai_usage
   where user_id = v_uid and feature = p_feature and period_key = p_period_key
   for update;

  select count(*) into v_active from ai_usage_reservations
   where user_id = v_uid and feature = p_feature and period_key = p_period_key
     and status = 'reserved' and expires_at > now();

  if v_committed + v_active >= p_max then
    return jsonb_build_object('allowed', false, 'used', v_committed + v_active, 'committed', v_committed);
  end if;

  insert into ai_usage_reservations (user_id, feature, period_key)
  values (v_uid, p_feature, p_period_key)
  returning id into v_res;

  return jsonb_build_object('allowed', true, 'used', v_committed + v_active + 1,
                            'committed', v_committed, 'reservation_id', v_res);
end;
$$;

-- Commit a reservation after the AI provider answered successfully.
-- Idempotent: committing twice never double-counts.
create or replace function public.commit_usage(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  r ai_usage_reservations%rowtype;
  v_committed integer;
  v_total bigint;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select * into r from ai_usage_reservations
   where id = p_reservation_id and user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Lock the counter row (same order as reserve_usage: counter → reservation
  -- is taken there; here we hold the reservation first, which is safe because
  -- reserve_usage never waits on a reservation row it does not insert).
  if r.status = 'reserved' then
    update ai_usage set count = count + 1, updated_at = now()
     where user_id = v_uid and feature = r.feature and period_key = r.period_key;
    update ai_usage_reservations set status = 'committed' where id = r.id;
  end if;

  select count into v_committed from ai_usage
   where user_id = v_uid and feature = r.feature and period_key = r.period_key;
  select coalesce(sum(count), 0) into v_total from ai_usage
   where user_id = v_uid and feature = r.feature;

  return jsonb_build_object('ok', true, 'committed', v_committed, 'total', v_total);
end;
$$;

-- Release a reservation after a provider failure — the student keeps the slot.
create or replace function public.release_usage(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update ai_usage_reservations set status = 'released'
   where id = p_reservation_id and user_id = v_uid and status = 'reserved';
  return jsonb_build_object('ok', true);
end;
$$;

-- Read-only snapshot for the UI: today's usage (committed + in-flight) and
-- the lifetime number of successfully answered questions for the feature.
create or replace function public.get_usage(p_feature text, p_period_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_committed integer := 0;
  v_active integer := 0;
  v_total bigint := 0;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select coalesce(count, 0) into v_committed from ai_usage
   where user_id = v_uid and feature = p_feature and period_key = p_period_key;
  select count(*) into v_active from ai_usage_reservations
   where user_id = v_uid and feature = p_feature and period_key = p_period_key
     and status = 'reserved' and expires_at > now();
  select coalesce(sum(count), 0) into v_total from ai_usage
   where user_id = v_uid and feature = p_feature;

  return jsonb_build_object('used', coalesce(v_committed, 0) + v_active,
                            'committed', coalesce(v_committed, 0), 'total', v_total);
end;
$$;

grant execute on function public.reserve_usage(text, text, integer) to authenticated;
grant execute on function public.commit_usage(uuid)                 to authenticated;
grant execute on function public.release_usage(uuid)                to authenticated;
grant execute on function public.get_usage(text, text)              to authenticated;

-- The old single-step function from schema-05 is superseded by the
-- reservation functions above and is no longer called by api/ask.js.
-- It is left in place (not dropped) so a rollback of the API code still
-- works; it only ever acts on the caller's own row.

-- Housekeeping helper (optional, e.g. a weekly Supabase cron job):
--   delete from public.ai_usage_reservations where created_at < now() - interval '2 days';

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PAYMENTS LEDGER + ATOMIC APPLY
-- ═══════════════════════════════════════════════════════════════════════
-- Why a ledger: `subscriptions` holds ONE row per student, and its
-- paystack_reference is overwritten on every renewal. Without a permanent
-- record of every reference ever applied, an OLD successful reference could
-- be replayed to extend Premium again, and a retried webhook / repeated
-- verify call would keep resetting the period. The ledger's UNIQUE
-- reference is the idempotency key.

create table if not exists public.payments (
  paystack_reference text primary key,
  user_id            uuid not null references auth.users(id) on delete cascade,
  amount_kobo        integer not null,
  currency           text not null,
  livemode           boolean not null default true,
  applied_at         timestamptz not null default now()
);
alter table public.payments enable row level security;
drop policy if exists "select own payments" on public.payments;
create policy "select own payments" on public.payments
  for select using (auth.uid() = user_id);
revoke insert, update, delete on public.payments from anon, authenticated;

-- Atomically: record the reference (once) and extend/create the student's
-- subscription. Called ONLY by the server with the service_role key.
-- Returns:
--   {result:'applied',         current_period_end}
--   {result:'already_applied', current_period_end}   same student, same reference
--   {result:'other_user'}                             reference belongs to someone else
create or replace function public.apply_verified_payment(
  p_user_id uuid,
  p_reference text,
  p_amount_kobo integer,
  p_currency text,
  p_livemode boolean,
  p_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_user uuid;
  v_end timestamptz;
  v_start timestamptz := now();
  v_new_end timestamptz;
  v_plan text := case when p_livemode then 'premium_monthly' else 'premium_monthly_test' end;
begin
  -- Serialise everything for this student (and this reference's owner check).
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  perform pg_advisory_xact_lock(hashtext('ref:' || p_reference));

  select user_id into v_existing_user from payments where paystack_reference = p_reference;
  if found then
    if v_existing_user <> p_user_id then
      return jsonb_build_object('result', 'other_user');
    end if;
    select current_period_end into v_end from subscriptions where user_id = p_user_id limit 1;
    return jsonb_build_object('result', 'already_applied', 'current_period_end', v_end);
  end if;

  insert into payments (paystack_reference, user_id, amount_kobo, currency, livemode)
  values (p_reference, p_user_id, p_amount_kobo, p_currency, p_livemode);

  -- Extend from the later of "now" and the current unexpired end, so an early
  -- renewal never throws away days the student already paid for.
  select current_period_end into v_end from subscriptions where user_id = p_user_id limit 1;
  v_new_end := greatest(coalesce(v_end, v_start), v_start) + make_interval(days => p_days);

  update subscriptions
     set status = 'active',
         plan = v_plan,
         currency_charged = p_currency,
         amount_charged_kobo = p_amount_kobo,
         paystack_reference = p_reference,
         current_period_start = v_start,
         current_period_end = v_new_end,
         updated_at = now()
   where user_id = p_user_id;

  if not found then
    insert into subscriptions
      (user_id, status, plan, currency_charged, amount_charged_kobo,
       paystack_reference, current_period_start, current_period_end, updated_at)
    values
      (p_user_id, 'active', v_plan, p_currency, p_amount_kobo,
       p_reference, v_start, v_new_end, now());
  end if;

  return jsonb_build_object('result', 'applied', 'current_period_end', v_new_end);
end;
$$;

revoke all on function public.apply_verified_payment(uuid, text, integer, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.apply_verified_payment(uuid, text, integer, text, boolean, integer) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. EMAIL → USER ID (webhook only)
-- ═══════════════════════════════════════════════════════════════════════
-- GoTrue's admin "list users" endpoint has no reliable email filter, so the
-- webhook's previous lookup could silently miss the account. This resolves
-- it exactly, server-side only.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public, auth
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. YOUTUBE CACHE — stop anonymous writes (manual step)
-- ═══════════════════════════════════════════════════════════════════════
-- schema-03 (not in this repo snapshot) created youtube_cache with RLS that
-- allows the public anon key to write. Anyone could therefore poison the
-- shared cache with arbitrary video ids/titles shown to every student.
-- api/youtube.js now writes the cache with the service_role key instead, so
-- anonymous writes can be removed. List the current policies first:
--
--   select policyname, cmd from pg_policies where tablename = 'youtube_cache';
--
-- then drop every INSERT/UPDATE policy shown, e.g.:
--
--   drop policy "<name of insert policy>" on public.youtube_cache;
--   drop policy "<name of update policy>" on public.youtube_cache;
--   revoke insert, update, delete on public.youtube_cache from anon, authenticated;
--
-- Keep the SELECT policy (the cache holds only public search results).
