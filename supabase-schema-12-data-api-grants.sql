-- StudyMate AI — schema 12: explicit Data API grants + least privilege
-- ════════════════════════════════════════════════════════════════════════
-- WHY: from 2026-10-30 Supabase stops auto-exposing public tables to the Data
-- API (PostgREST / supabase-js); a table is reachable only through explicit
-- GRANTs. Existing tables keep their legacy grants (which were broader than
-- the app needs: RLS was the only guard), and schemas 03–11 never granted
-- anything explicitly. This migration makes the access model explicit and
-- minimal, so it behaves identically before and after the cut-over.
--
-- IS THIS A NEW MIGRATION?  YES. It is NEW and has NOT been applied.
-- Schemas 03–11 are unchanged — do not edit or re-run them. (Schema 11 was
-- already run; this migration adds the grants it was missing.)
--
-- SAFE TO APPLY: idempotent (re-runnable), non-destructive (no DROP TABLE,
-- no DELETE/UPDATE of data, no policy that widens access), atomic (single
-- transaction), and tolerant of tables that don't exist yet in your project
-- (each table is skipped with a NOTICE if absent). Row Level Security is NOT
-- changed anywhere except removing two over-permissive youtube_cache policies.
--
-- WHAT THE APP USES (derived from the code, not guessed):
--   profiles                  select / upsert         (index.html)
--   saved_questions           select / insert         (index.html)
--   subscriptions             select (own)            (index.html, api/_lib/plan.js)
--   readiness_snapshots       select / insert         (index.html)
--   past_paper_analyses       select / insert         (index.html)
--   user_visual_preferences   select (writes via RPC) (personalization.js)
--   weakness_profiles         select / upsert / update mistake_type / delete own (weakness-sync.js)
--   answer_feedback           select / insert         (index.html)
--   youtube_cache             anon READ by api/youtube.js; WRITE by service_role only
--   everything else           server-only (service_role) or via SECURITY DEFINER RPCs
--
-- AFTER APPLYING run the verification query at the bottom of this file.
-- ROLLBACK (if something unexpectedly 403s): see the comment at the very end.

begin;

-- ── 0. Future tables: never auto-exposed (matches Supabase's new default) ──
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- ── 1. Helper (dropped at the end): run a statement only if the table exists ──
create or replace function pg_temp.sm_grant(p_table text, p_sql text)
returns void language plpgsql as $$
begin
  if to_regclass('public.' || p_table) is null then
    raise notice 'schema 12: public.% does not exist — skipped', p_table;
  else
    execute p_sql;
  end if;
end $$;

-- ── 2. Reset: strip every legacy table privilege from anon + authenticated ──
-- (re-granted below, minimally). Done per table so a missing table can't abort the migration.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','saved_questions','subscriptions','review_schedule','readiness_snapshots',
    'past_paper_analyses','ai_usage','ai_usage_reservations','payments','payment_intents',
    'profile_country_changes','user_visual_preferences','weakness_profiles','answer_feedback','youtube_cache'
  ] loop
    perform pg_temp.sm_grant(t, format('revoke all on table public.%I from anon, authenticated', t));
  end loop;
end $$;

-- ── 3. Signed-in students: the minimum each feature needs (RLS still limits to own rows) ──
select pg_temp.sm_grant('profiles', $q$grant select on public.profiles to authenticated$q$);
select pg_temp.sm_grant('profiles', $q$grant insert (id, first_name, country, exam_board, exam_enabled, study_class, study_routine, onboarding_complete, onboarding_completed_at, updated_at) on public.profiles to authenticated$q$);
select pg_temp.sm_grant('profiles', $q$grant update (id, first_name, country, exam_board, exam_enabled, study_class, study_routine, onboarding_complete, onboarding_completed_at, updated_at) on public.profiles to authenticated$q$);
select pg_temp.sm_grant('saved_questions',         'grant select, insert, delete on public.saved_questions to authenticated');
select pg_temp.sm_grant('subscriptions',           'grant select on public.subscriptions to authenticated');
select pg_temp.sm_grant('readiness_snapshots',     'grant select, insert on public.readiness_snapshots to authenticated');
select pg_temp.sm_grant('past_paper_analyses',     'grant select, insert on public.past_paper_analyses to authenticated');
select pg_temp.sm_grant('user_visual_preferences', 'grant select on public.user_visual_preferences to authenticated');
select pg_temp.sm_grant('weakness_profiles', $q$grant select, delete on public.weakness_profiles to authenticated$q$);
select pg_temp.sm_grant('weakness_profiles', $q$grant insert (user_id, subject, topic, level, difficulty, mistake_type, client_ts) on public.weakness_profiles to authenticated$q$);
select pg_temp.sm_grant('weakness_profiles', $q$grant update (mistake_type) on public.weakness_profiles to authenticated$q$);
select pg_temp.sm_grant('answer_feedback', $q$grant select on public.answer_feedback to authenticated$q$);
select pg_temp.sm_grant('answer_feedback', $q$grant insert (user_id, question, subject, exam, kind, value) on public.answer_feedback to authenticated$q$);

-- Deliberately NOT granted to authenticated (no client code touches them; they are written only by
-- SECURITY DEFINER functions or the server): review_schedule, ai_usage, ai_usage_reservations,
-- payments, payment_intents, profile_country_changes.
-- (review_schedule has policies but no code uses it; re-grant here if you ever build that feature.)

-- ── 4. youtube_cache: public READ, server-only WRITE ──
-- api/youtube.js reads with the (public) anon key and writes with the service-role key. The old
-- "Anyone can write/refresh" policies let ANYONE holding the public anon key overwrite cached video
-- results for every student (cache poisoning). Removing them is safe: the server write path uses
-- service_role, which bypasses RLS.
do $$
begin
  if to_regclass('public.youtube_cache') is not null then
    drop policy if exists "Anyone can write cached video results"   on public.youtube_cache;
    drop policy if exists "Anyone can refresh cached video results" on public.youtube_cache;
    grant select on public.youtube_cache to anon, authenticated;
  end if;
end $$;

-- ── 5. Server role: explicit grants so the API keeps working after the cut-over ──
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','saved_questions','subscriptions','review_schedule','readiness_snapshots',
    'past_paper_analyses','ai_usage','ai_usage_reservations','payments','payment_intents',
    'profile_country_changes','user_visual_preferences','weakness_profiles','answer_feedback','youtube_cache'
  ] loop
    perform pg_temp.sm_grant(t, format('grant select, insert, update, delete on table public.%I to service_role', t));
  end loop;
end $$;

-- ── 6. Functions: signed-in only (functions default to EXECUTE for PUBLIC, i.e. anon too) ──
do $$
begin
  if to_regprocedure('public.reserve_usage(text,text,integer)') is not null then
    revoke all on function public.reserve_usage(text,text,integer) from public, anon;
    grant execute on function public.reserve_usage(text,text,integer) to authenticated;
  end if;
  if to_regprocedure('public.commit_usage(uuid)') is not null then
    revoke all on function public.commit_usage(uuid) from public, anon;
    grant execute on function public.commit_usage(uuid) to authenticated;
  end if;
  if to_regprocedure('public.release_usage(uuid)') is not null then
    revoke all on function public.release_usage(uuid) from public, anon;
    grant execute on function public.release_usage(uuid) to authenticated;
  end if;
  if to_regprocedure('public.get_usage(text,text)') is not null then
    revoke all on function public.get_usage(text,text) from public, anon;
    grant execute on function public.get_usage(text,text) to authenticated;
  end if;
  -- Legacy schema-05 counter: no code calls it any more (superseded by reserve/commit). Remove it
  -- from every client role; the function itself is left in place.
  if to_regprocedure('public.check_and_increment_usage(text,text,integer)') is not null then
    revoke all on function public.check_and_increment_usage(text,text,integer) from public, anon, authenticated;
  end if;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (run after applying; read-only). Expected for role `anon`: only youtube_cache = SELECT.
-- For `authenticated`: exactly the grants listed in section 3 (plus youtube_cache SELECT).
--
--   select grantee, table_name, string_agg(privilege_type, ', ' order by privilege_type) as privileges
--     from information_schema.role_table_grants
--    where table_schema = 'public' and grantee in ('anon', 'authenticated')
--    group by grantee, table_name order by grantee, table_name;
--
--   -- column-level grants (profiles / weakness_profiles / answer_feedback):
--   select grantee, table_name, privilege_type, string_agg(column_name, ', ' order by column_name)
--     from information_schema.column_privileges
--    where table_schema = 'public' and grantee = 'authenticated'
--      and table_name in ('profiles','weakness_profiles','answer_feedback')
--    group by 1, 2, 3 order by 2, 3;
--
--   -- RLS must still be ON for every app table:
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relkind = 'r' order by relname;
--
-- ROLLBACK (only if a feature unexpectedly fails with "permission denied" / 42501 — then tell me
-- which table, and add the missing grant; do NOT re-grant broad access). To restore the old broad
-- legacy behaviour for one table temporarily: grant select, insert, update, delete on public.<t> to authenticated;
-- RLS keeps rows private either way.
