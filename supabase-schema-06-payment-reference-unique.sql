-- StudyMate AI — payment reference uniqueness (fixes the Critical
-- "payment reference reuse across accounts" finding from the production
-- audit)
-- ───────────────────────────────────────────────────────────────────────
-- api/verify-payment.js now rejects a reference that's already tied to a
-- DIFFERENT account, but that application-level check and the upsert that
-- follows it are two separate requests — not one atomic operation. Two
-- accounts submitting the exact same reference within milliseconds of
-- each other could both pass the check before either write lands. This
-- constraint is what actually closes that race: Postgres will refuse the
-- second write outright, no matter how the timing lines up.
--
-- Run the check below FIRST. If it returns any rows, resolve those
-- duplicates manually before running the ALTER TABLE — it will fail with
-- a constraint-violation error on the existing data otherwise.

-- 1. Check for existing duplicates (should return zero rows on a normal
--    launch-prep database; safe to run any time).
select paystack_reference, count(*), array_agg(user_id) as user_ids
from public.subscriptions
where paystack_reference is not null
group by paystack_reference
having count(*) > 1;

-- 2. Add the constraint. NULLs are unaffected (Postgres allows multiple
--    NULLs under a UNIQUE constraint), which is fine — every real,
--    verified payment always sets a real reference string.
alter table public.subscriptions
  add constraint subscriptions_paystack_reference_unique unique (paystack_reference);
