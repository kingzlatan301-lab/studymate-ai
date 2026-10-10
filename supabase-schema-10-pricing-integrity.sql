-- StudyMate AI — schema 10 (regional-pricing integrity / anti-abuse)
-- ───────────────────────────────────────────────────────────────────────
-- Run ONCE in the Supabase SQL editor AFTER schema 09. Idempotent.
-- Does NOT modify or recreate anything schema 09 created; it only ADDS
-- columns/tables/functions on top of it.
--
--   1. profile_country_changes — tamper-proof log of every change to
--      profiles.country, written by a DATABASE TRIGGER (so it cannot be
--      skipped by editing JavaScript or calling the REST API directly).
--   2. payment_intents risk columns — score, flags, residence confirmation.
--   3. create_payment_intent() — atomic, per-user-serialised intent creation
--      (reuses an open identical intent; hard backstop on attempt volume).
--   4. get_pricing_signals() — everything the server needs to price and risk-
--      assess a checkout in ONE round-trip.
--   5. Backfill pricing_region for payments made before schema 09 so those
--      students are region-locked too.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. COUNTRY-CHANGE LOG (trigger-written)
-- ═══════════════════════════════════════════════════════════════════════
create table if not exists public.profile_country_changes (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  old_country text,
  new_country text,
  changed_at  timestamptz not null default now()
);
create index if not exists profile_country_changes_user_idx
  on public.profile_country_changes (user_id, changed_at desc);

alter table public.profile_country_changes enable row level security;
-- No policies on purpose: students can neither read, edit nor delete this log.
revoke all on public.profile_country_changes from anon, authenticated;

create or replace function public.log_profile_country_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.country is distinct from old.country then
    insert into public.profile_country_changes (user_id, old_country, new_country)
    values (new.id, old.country, new.country);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_country_change_log on public.profiles;
create trigger profiles_country_change_log
  after update of country on public.profiles
  for each row execute function public.log_profile_country_change();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. RISK COLUMNS ON PAYMENT INTENTS
-- ═══════════════════════════════════════════════════════════════════════
alter table public.payment_intents add column if not exists risk_score        integer not null default 0;
alter table public.payment_intents add column if not exists risk_flags        text[]  not null default '{}';
alter table public.payment_intents add column if not exists country_confirmed boolean not null default false;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. ATOMIC INTENT CREATION
-- ═══════════════════════════════════════════════════════════════════════
-- Serialised per user (advisory lock), so two simultaneous checkouts can
-- neither create two open intents nor race past the attempt backstop.
--   • an identical OPEN intent (same region/currency/amount, < 15 min old) is
--     returned instead of creating another; its access_code is NULL while the
--     first request is still talking to Paystack (the caller treats that as
--     "checkout in progress", never as a reason to create a second one)
--   • more than 12 intents in the last hour → { blocked: true } regardless of
--     what the application layer decided (defence in depth)
create or replace function public.create_payment_intent(
  p_user_id uuid,
  p_reference text,
  p_region text,
  p_currency text,
  p_amount_minor integer,
  p_profile_country text,
  p_ip_country text,
  p_risk_score integer,
  p_risk_flags text[],
  p_confirmed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o payment_intents%rowtype;
  v_recent integer;
begin
  perform pg_advisory_xact_lock(hashtext('checkout:' || p_user_id::text));

  select * into o from payment_intents
   where user_id = p_user_id and status = 'initialized'
     and created_at > now() - interval '15 minutes'
     and pricing_region = p_region and currency = upper(p_currency) and amount_minor = p_amount_minor
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('reused', true, 'reference', o.reference, 'access_code', o.access_code);
  end if;

  select count(*) into v_recent from payment_intents
   where user_id = p_user_id and created_at > now() - interval '1 hour';
  if v_recent >= 12 then
    return jsonb_build_object('blocked', true, 'reason', 'too_many_attempts');
  end if;

  insert into payment_intents
    (reference, user_id, pricing_region, currency, amount_minor,
     profile_country, ip_country, risk_score, risk_flags, country_confirmed)
  values
    (p_reference, p_user_id, p_region, upper(p_currency), p_amount_minor,
     p_profile_country, p_ip_country, coalesce(p_risk_score, 0), coalesce(p_risk_flags, '{}'), coalesce(p_confirmed, false));

  return jsonb_build_object('reused', false, 'reference', p_reference);
end;
$$;
revoke all on function public.create_payment_intent(uuid, text, text, text, integer, text, text, integer, text[], boolean) from public, anon, authenticated;
grant execute on function public.create_payment_intent(uuid, text, text, text, integer, text, text, integer, text[], boolean) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. PRICING SIGNALS (one round-trip, server-only)
-- ═══════════════════════════════════════════════════════════════════════
create or replace function public.get_pricing_signals(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
  v_locked text;
  v_paid integer;
  v_changes jsonb;
  v_intents jsonb;
begin
  select country into v_country from profiles where id = p_user_id;

  select pricing_region into v_locked from payments
   where user_id = p_user_id and pricing_region is not null
   order by applied_at asc limit 1;

  select count(*) into v_paid from payments where user_id = p_user_id;

  select coalesce(jsonb_agg(jsonb_build_object('at', changed_at, 'to', new_country) order by changed_at desc), '[]'::jsonb)
    into v_changes
    from profile_country_changes
   where user_id = p_user_id and changed_at > now() - interval '30 days';

  select coalesce(jsonb_agg(jsonb_build_object('region', pricing_region, 'amount', amount_minor,
                                               'at', created_at, 'status', status) order by created_at desc), '[]'::jsonb)
    into v_intents
    from payment_intents
   where user_id = p_user_id and created_at > now() - interval '7 days';

  return jsonb_build_object('profile_country', v_country, 'locked_region', v_locked,
                            'paid_count', v_paid, 'country_changes', v_changes, 'intents', v_intents);
end;
$$;
revoke all on function public.get_pricing_signals(uuid) from public, anon, authenticated;
grant execute on function public.get_pricing_signals(uuid) to service_role;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. BACKFILL: region-lock students who paid BEFORE schema 09
-- ═══════════════════════════════════════════════════════════════════════
-- Older payments have no pricing_region, so those students would not be
-- locked. Infer it from the amount actually charged (the price table's
-- amounts are distinct apart from US/International, which cost the same, so
-- the inference cannot change anyone's price). Unknown amounts stay NULL.
update public.payments set pricing_region = case amount_kobo
    when 200000 then 'ng' when 430000 then 'gh' when 440000 then 'ke' when 535000 then 'za'
    when 580000 then 'gb' when 570000 then 'us' when 520000 then 'ca' when 150000 then 'in'
    when 615000 then 'au' when 470000 then 'ae' else null end
 where pricing_region is null and upper(currency) = 'NGN';
