-- Run this AFTER the first schema script — weakness_profiles already exists,
-- this just adds one constraint to it.
--
-- Why: the migration/sync code uses an "upsert, ignore duplicates" pattern
-- so it's safe to retry (flaky connection, re-running migration, etc.)
-- without creating duplicate attempts that would skew mastery/accuracy.
-- That requires a unique constraint for Postgres to detect a conflict
-- against — client_ts (the original Date.now() from the device) combined
-- with user/subject/topic is what makes one attempt the "same" attempt.

alter table public.weakness_profiles
  add constraint weakness_profiles_dedupe unique (user_id, subject, topic, client_ts);
