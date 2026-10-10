-- StudyMate AI — schema 09 (launch hardening)
-- ───────────────────────────────────────────────────────────────────────
-- Run ONCE in the Supabase SQL editor BEFORE deploying the matching code.
-- Idempotent; requires schema 04, 06, 07 to have been run already.
--
-- Contents
--   1. Usage "runs": ONE reservation can cover a multi-call feature use
--      (a Mock Exam makes one /api/ask call per question but is ONE use).
--   2. get_usage_snapshot(): every Free feature's usage in one round-trip.
--   3. payment_intents: the server-owned record of what a checkout MUST cost.
--   4. apply_verified_payment_v2(): re-checks user + amount + currency
--      against the intent INSIDE the same transaction that grants Premium.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. USAGE RUNS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.ai_usage_reservations add column if not exists run_id text;
alter table public.ai_usage_reservations add column if not exists calls  integer not null default 1;

alter table public.ai_usage_reservations drop constraint if exists ai_usage_reservations_run_id_chk;
alter table public.ai_usage_reservations add constraint ai_usage_reservations_run_id_chk
  check (run_id is null or char_length(run_id) between 8 and 64);

create index if not exists ai_usage_reservations_run_idx
  on public.ai_usage_reservations (user_id, feature, period_key, run_id)
  where run_id is not null;

-- reserve_usage_run — same lifecycle as reserve_usage(), plus an optional
-- run id that the CLIENT may supply but that can only ever REDUCE what it
-- costs the student to continue a run they already paid a slot for:
--
--   • no run id            → behaves exactly like reserve_usage() (1 call = 1 slot)
--   • run id, no live run  → takes a NEW slot (subject to the limit)
--   • run id of a COMMITTED run (< 90 min old) → continues it for free, but only
--                            up to p_max_calls calls in total (server-configured)
--   • run id of an in-flight run → refused ('run_in_flight'); runs are sequential
--
-- A client can therefore never use a run id to exceed the limit: a brand-new
-- run id always costs a slot, and an old one is capped by p_max_calls.
-- Serialisation: every path takes the same ai_usage row lock first.
create or replace function public.reserve_usage_run(
  p_feature text,
  p_period_key text,
  p_max integer,
  p_run_id text,
  p_max_calls integer
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
  r ai_usage_reservations%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_run_id is not null and char_length(p_run_id) not between 8 and 64 then
    raise exception 'bad run id';
  end if;

  insert into ai_usage (user_id, feature, period_key, count)
  values (v_uid, p_feature, p_period_key, 0)
  on conflict (user_id, feature, period_key) do nothing;

  select count into v_committed from ai_usage
   where user_id = v_uid and feature = p_feature and period_key = p_period_key
   for update;

  select count(*) into v_active from ai_usage_reservations
   where user_id = v_uid and feature = p_feature and period_key = p_period_key
     and status = 'reserved' and expires_at > now();

  if p_run_id is not null then
    select * into r from ai_usage_reservations
     where user_id = v_uid and feature = p_feature and period_key = p_period_key
       and run_id = p_run_id and status in ('reserved', 'committed')
       and (
         (status = 'committed' and created_at > now() - interval '90 minutes') or
         (status = 'reserved'  and expires_at > now())
       )
     order by created_at desc
     limit 1
     for update;

    if found then
      if r.status = 'reserved' then
        return jsonb_build_object('allowed', false, 'reason', 'run_in_flight',
                                  'used', v_committed + v_active, 'committed', v_committed);
      end if;
      if r.calls >= greatest(p_max_calls, 1) then
        return jsonb_build_object('allowed', false, 'reason', 'run_calls_exceeded',
                                  'used', v_committed + v_active, 'committed', v_committed);
      end if;
      update ai_usage_reservations set calls = calls + 1 where id = r.id;
      return jsonb_build_object('allowed', true, 'reused', true,
                                'used', v_committed + v_active, 'committed', v_committed,
                                'reservation_id', r.id);
    end if;
  end if;

  if v_committed + v_active >= p_max then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached',
                              'used', v_committed + v_active, 'committed', v_committed);
  end if;

  insert into ai_usage_reservations (user_id, feature, period_key, run_id, calls)
  values (v_uid, p_feature, p_period_key, p_run_id, 1)
  returning id into v_res;

  return jsonb_build_object('allowed', true, 'reused', false,
                            'used', v_committed + v_active + 1,
                            'committed', v_committed, 'reservation_id', v_res);
end;
$$;

revoke all on function public.reserve_usage_run(text, text, integer, text, integer) from public, anon;
grant execute on function public.reserve_usage_run(text, text, integer, text, integer) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. USAGE SNAPSHOT (one round-trip for the whole usage UI)
-- ═══════════════════════════════════════════════════════════════════════
-- p_items: [{"feature":"askAI","period_key":"2026-10-06"}, ...]
-- returns: {"askAI":{"used":1,"committed":1}, ..., "_total_askAI": 42}
create or replace function public.get_usage_snapshot(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  it jsonb;
  v_committed integer;
  v_active integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    raise exception 'bad items';
  end if;

  for it in select * from jsonb_array_elements(p_items) loop
    select coalesce(count, 0) into v_committed from ai_usage
     where user_id = v_uid and feature = it->>'feature' and period_key = it->>'period_key';
    select count(*) into v_active from ai_usage_reservations
     where user_id = v_uid and feature = it->>'feature' and period_key = it->>'period_key'
       and status = 'reserved' and expires_at > now();
    v_out := v_out || jsonb_build_object(it->>'feature',
      jsonb_build_object('used', coalesce(v_committed, 0) + v_active, 'committed', coalesce(v_committed, 0)));
  end loop;

  v_out := v_out || jsonb_build_object('_total_askAI',
    (select coalesce(sum(count), 0) from ai_usage where user_id = v_uid and feature = 'askAI'));
  return v_out;
end;
$$;

revoke all on function public.get_usage_snapshot(jsonb) from public, anon;
grant execute on function public.get_usage_snapshot(jsonb) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PAYMENT INTENTS — the server decides, records, and later enforces price
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.payment_intents (
  reference       text primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  pricing_region  text not null,            -- region code used for pricing (e.g. 'ng', 'in', 'intl')
  currency        text not null,
  amount_minor    integer not null check (amount_minor > 0),
  status          text not null default 'initialized'
                  check (status in ('initialized', 'paid', 'failed', 'abandoned')),
  profile_country text,                     -- what the profile said at checkout (audit only)
  ip_country      text,                     -- edge-reported country (audit only, never authoritative)
  access_code     text,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
create index if not exists payment_intents_user_idx on public.payment_intents (user_id, created_at desc);

alter table public.payment_intents enable row level security;
-- No policies on purpose: written/read only by the server (service_role).
revoke all on public.payment_intents from anon, authenticated;

alter table public.payments add column if not exists pricing_region text;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. APPLY A VERIFIED PAYMENT — intent-checked, idempotent
-- ═══════════════════════════════════════════════════════════════════════
-- Returns {result: 'applied' | 'already_applied' | 'other_user' | 'no_intent' | 'mismatch'}
-- The caller (api/_lib/payments.js) has ALREADY verified the transaction with
-- Paystack; this function independently refuses to grant unless the amount,
-- currency and user match the intent the server created at checkout.
create or replace function public.apply_verified_payment_v2(
  p_user_id uuid,
  p_reference text,
  p_amount_minor integer,
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
  i payment_intents%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  perform pg_advisory_xact_lock(hashtext('ref:' || p_reference));

  -- Idempotency first: a reference that was already applied never re-extends.
  select user_id into v_existing_user from payments where paystack_reference = p_reference;
  if found then
    if v_existing_user <> p_user_id then
      return jsonb_build_object('result', 'other_user');
    end if;
    select current_period_end into v_end from subscriptions where user_id = p_user_id limit 1;
    return jsonb_build_object('result', 'already_applied', 'current_period_end', v_end);
  end if;

  select * into i from payment_intents where reference = p_reference for update;
  if not found then
    return jsonb_build_object('result', 'no_intent');
  end if;
  if i.user_id <> p_user_id then
    return jsonb_build_object('result', 'other_user');
  end if;
  if i.amount_minor <> p_amount_minor or upper(i.currency) <> upper(p_currency) then
    return jsonb_build_object('result', 'mismatch');
  end if;

  insert into payments (paystack_reference, user_id, amount_kobo, currency, livemode, pricing_region)
  values (p_reference, p_user_id, p_amount_minor, upper(p_currency), p_livemode, i.pricing_region);

  update payment_intents set status = 'paid', paid_at = now() where reference = p_reference;

  select current_period_end into v_end from subscriptions where user_id = p_user_id limit 1;
  v_new_end := greatest(coalesce(v_end, v_start), v_start) + make_interval(days => p_days);

  update subscriptions
     set status = 'active', plan = v_plan,
         currency_charged = upper(p_currency), amount_charged_kobo = p_amount_minor,
         paystack_reference = p_reference,
         current_period_start = v_start, current_period_end = v_new_end, updated_at = now()
   where user_id = p_user_id;

  if not found then
    insert into subscriptions
      (user_id, status, plan, currency_charged, amount_charged_kobo,
       paystack_reference, current_period_start, current_period_end, updated_at)
    values
      (p_user_id, 'active', v_plan, upper(p_currency), p_amount_minor,
       p_reference, v_start, v_new_end, now());
  end if;

  return jsonb_build_object('result', 'applied', 'current_period_end', v_new_end);
end;
$$;

revoke all on function public.apply_verified_payment_v2(uuid, text, integer, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.apply_verified_payment_v2(uuid, text, integer, text, boolean, integer) to service_role;

-- The old function has no intent check (it only trusted the caller's amount
-- floor). Nothing in the code calls it any more; remove it from every role
-- except service_role so it cannot be used by mistake.
revoke all on function public.apply_verified_payment(uuid, text, integer, text, boolean, integer) from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. LIFETIME STUDY STATS (cross-device; replaces the hard-coded streak)
-- ═══════════════════════════════════════════════════════════════════════
-- Computed from the student's own weakness_profiles rows, so it follows the
-- account across devices. Day boundaries are UTC. The streak counts
-- consecutive active days ending today or yesterday (0 if neither).
create or replace function public.get_lifetime_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_attempts bigint; v_knew bigint; v_shaky bigint; v_lost bigint;
  v_days bigint; v_streak bigint := 0;
  v_today date := (now() at time zone 'utc')::date;
  v_last date;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select count(*),
         count(*) filter (where level = 'knew'),
         count(*) filter (where level = 'shaky'),
         count(*) filter (where level = 'lost')
    into v_attempts, v_knew, v_shaky, v_lost
    from weakness_profiles where user_id = v_uid;

  with d as (
    select distinct (coalesce(to_timestamp(client_ts / 1000.0), created_at) at time zone 'utc')::date as day
      from weakness_profiles where user_id = v_uid
  )
  select count(*), max(day) into v_days, v_last from d;

  if v_last is not null and v_last >= v_today - 1 then
    with d as (
      select distinct (coalesce(to_timestamp(client_ts / 1000.0), created_at) at time zone 'utc')::date as day
        from weakness_profiles where user_id = v_uid
    ), g as (
      select day, day - (row_number() over (order by day))::int as grp from d
    )
    select count(*) into v_streak from g where grp = (select grp from g where day = v_last);
  end if;

  return jsonb_build_object('attempts', v_attempts, 'knew', v_knew, 'shaky', v_shaky, 'lost', v_lost,
                            'active_days', v_days, 'streak_days', v_streak);
end;
$$;
revoke all on function public.get_lifetime_stats() from public, anon;
grant execute on function public.get_lifetime_stats() to authenticated;
