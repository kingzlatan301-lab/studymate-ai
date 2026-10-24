-- StudyMate AI — schema 13 (payment-provider groundwork for a second provider, e.g. Stripe)
-- ───────────────────────────────────────────────────────────────────────────────
-- Run ONCE in the Supabase SQL editor AFTER schema 12. Idempotent (safe to re-run).
-- PURELY ADDITIVE: does not change, replace or re-grant anything Paystack uses today.
--   • apply_verified_payment_v2 / create_payment_intent / payments PK are untouched.
--   • Every existing row becomes provider = 'paystack' via the column default.
-- Nothing in the app calls the new function until Stripe support is implemented
-- (checkout fails closed for any region whose provider is not in SUPPORTED_PROVIDERS).
--
--   1. provider / provider_ref columns on payment_intents, payments, subscriptions
--   2. one provider transaction id can only ever be applied once (partial unique index)
--   3. apply_verified_payment_v3 — v2's exact guarantees + provider binding
--
-- NAMING NOTE: payments.paystack_reference and subscriptions.paystack_reference are legacy column
-- names. They hold OUR server-generated intent reference for every provider (the idempotency key).
-- The provider's own id (Stripe Checkout Session / PaymentIntent id) goes in provider_ref.

-- ═══ 1. COLUMNS ═══
alter table public.payment_intents add column if not exists provider     text not null default 'paystack';
alter table public.payment_intents add column if not exists provider_ref text;
alter table public.payments        add column if not exists provider     text not null default 'paystack';
alter table public.payments        add column if not exists provider_ref text;
alter table public.subscriptions   add column if not exists provider     text not null default 'paystack';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_intents_provider_check') then
    alter table public.payment_intents add constraint payment_intents_provider_check check (provider in ('paystack', 'stripe'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payments_provider_check') then
    alter table public.payments add constraint payments_provider_check check (provider in ('paystack', 'stripe'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_provider_check') then
    alter table public.subscriptions add constraint subscriptions_provider_check check (provider in ('paystack', 'stripe'));
  end if;
end $$;

-- ═══ 2. A PROVIDER TRANSACTION CAN BE APPLIED ONCE, UNDER ONE REFERENCE ═══
-- Stops a replayed Stripe session/payment id from being applied under a second
-- StudyMate reference. (Paystack rows keep provider_ref NULL, so they are unaffected.)
create unique index if not exists payments_provider_ref_unique
  on public.payments (provider, provider_ref) where provider_ref is not null;
create index if not exists payment_intents_provider_ref_idx
  on public.payment_intents (provider, provider_ref) where provider_ref is not null;

-- ═══ 3. APPLY A VERIFIED PAYMENT, ANY PROVIDER — intent-checked, idempotent ═══
-- Same contract as apply_verified_payment_v2 plus:
--   • the intent's provider must equal p_provider  → else 'mismatch'
--   • p_provider_ref already used under another reference → 'mismatch'
-- Returns {result: 'applied' | 'already_applied' | 'other_user' | 'no_intent' | 'mismatch'}
create or replace function public.apply_verified_payment_v3(
  p_user_id uuid,
  p_reference text,
  p_provider text,
  p_provider_ref text,
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
  if p_provider not in ('paystack', 'stripe') then
    return jsonb_build_object('result', 'mismatch');
  end if;

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

  select * into i from payment_intents where reference = p_reference for update;
  if not found then
    return jsonb_build_object('result', 'no_intent');
  end if;
  if i.user_id <> p_user_id then
    return jsonb_build_object('result', 'other_user');
  end if;
  if i.provider <> p_provider
     or i.amount_minor <> p_amount_minor
     or upper(i.currency) <> upper(p_currency) then
    return jsonb_build_object('result', 'mismatch');
  end if;
  if p_provider_ref is not null and exists (
       select 1 from payments where provider = p_provider and provider_ref = p_provider_ref) then
    return jsonb_build_object('result', 'mismatch');   -- provider transaction already used for another reference
  end if;

  insert into payments (paystack_reference, user_id, amount_kobo, currency, livemode, pricing_region, provider, provider_ref)
  values (p_reference, p_user_id, p_amount_minor, upper(p_currency), p_livemode, i.pricing_region, p_provider, p_provider_ref);

  update payment_intents set status = 'paid', paid_at = now() where reference = p_reference;

  select current_period_end into v_end from subscriptions where user_id = p_user_id limit 1;
  v_new_end := greatest(coalesce(v_end, v_start), v_start) + make_interval(days => p_days);

  update subscriptions
     set status = 'active', plan = v_plan, provider = p_provider,
         currency_charged = upper(p_currency), amount_charged_kobo = p_amount_minor,
         paystack_reference = p_reference,
         current_period_start = v_start, current_period_end = v_new_end, updated_at = now()
   where user_id = p_user_id;

  if not found then
    insert into subscriptions
      (user_id, status, plan, provider, currency_charged, amount_charged_kobo,
       paystack_reference, current_period_start, current_period_end, updated_at)
    values
      (p_user_id, 'active', v_plan, p_provider, upper(p_currency), p_amount_minor,
       p_reference, v_start, v_new_end, now());
  end if;

  return jsonb_build_object('result', 'applied', 'current_period_end', v_new_end);
end;
$$;

revoke all on function public.apply_verified_payment_v3(uuid, text, text, text, integer, text, boolean, integer) from public, anon, authenticated;
grant execute on function public.apply_verified_payment_v3(uuid, text, text, text, integer, text, boolean, integer) to service_role;
