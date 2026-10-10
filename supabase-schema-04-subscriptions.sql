-- StudyMate AI — subscriptions table
-- Run this in Supabase → SQL Editor → New query → Run.
--
-- This table is the REAL source of truth for Premium status — replacing
-- the old localStorage flag entirely, which anyone could fake from their
-- browser's dev console. This table is deliberately READ-ONLY from the
-- app: students can see their own row, but there is no insert/update/
-- delete policy for the authenticated role at all. The only way a row
-- gets written is from api/verify-payment.js or api/paystack-webhook.js,
-- both of which use the service_role key (bypasses RLS by design) only
-- after independently confirming a real successful payment with Paystack
-- — never trusting anything the browser claims about its own status.

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  status text not null default 'inactive' check (status in ('active', 'inactive', 'cancelled')),
  plan text not null default 'premium_monthly',
  currency_charged text not null default 'NGN',
  amount_charged_kobo integer,
  paystack_reference text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

-- The ONLY policy: a student can read their own row. That's it — no
-- insert, no update, no delete policies for anyone but service_role.
create policy "Users can view their own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);
