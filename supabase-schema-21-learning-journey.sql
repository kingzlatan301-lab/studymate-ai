-- ═══════════════════════════════════════════════════════════════════════════
-- StudyMate AI - schema 21: learning journey          filename: supabase-schema-21-learning-journey.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE   Lets Bagley remember HOW a student learns, not just whether they got answers right.
--           1. learning_events      append-only log: what was studied, with which teaching method, at which stage
--                                   of the learning cycle, and how the student did. No free text, no question content.
--           2. learning_preferences what the STUDENT chose (preferred method, pace, answer detail). Never inferred.
--           3. curriculum_topics    gains `objectives` and `prerequisites` (verified, public, service-role-written),
--                                   plus a read-only checker to run before a syllabus is published.
--
-- WHAT IS DELIBERATELY NOT STORED
--   * No lesson text, notes, prompts, answers or typed free text (data minimisation; nothing here can leak content).
--   * No mastery score and no "learning style" label. Mastery stays DERIVED from attempts by the app, so it can be
--     tuned without migrating data. "Which method worked" is computed from events at read time, never stored as fact.
--   * No duplicate of review_schedule (schema 05) or weakness data. Spaced review is computed from attempts.
--
-- DEPENDS   Schema 20 (public.curriculum_topics). Aborts with a clear message if it is missing.
-- SAFE ON AN EXISTING DATABASE?  Yes. Additive only: no table is dropped, no row is deleted or rewritten, existing
--           columns/policies/grants are untouched. Idempotent (safe to run twice).
-- SECURITY  Students: read + insert their OWN learning_events (history cannot be rewritten or deleted); read, insert and
--           update ONLY the three preference columns of their own row. anon: no access to user tables.
--           Curriculum columns: public read of PUBLISHED syllabi (existing policy), writes service_role only.
--           service_role: full access (server only; the key never reaches the browser).
--           Every user table is `on delete cascade` from auth.users, so account deletion removes it (api/account.js).
-- COST/ABUSE  A trigger caps one user at 2,000 events per rolling 24 hours, and clamps client timestamps to a sane window.
-- SELF-CHECK  Ends with checks that ABORT and roll back the whole migration if any permission is wrong.
-- ROLLBACK    drop table public.learning_events, public.learning_preferences;
--             drop function public.learning_events_guard(), public.learning_preferences_touch(), public.curriculum_check_prerequisites(uuid);
--             alter table public.curriculum_topics drop column objectives, drop column prerequisites;
-- NOT TESTED HERE  This file was reviewed and structurally tested by the repo's test-suite but NOT executed against a
--           live Postgres. Run it first on a Supabase branch/staging project, then production.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.curriculum_topics') is null then
    raise exception 'schema 21 needs public.curriculum_topics (run schema 20 first)';
  end if;
end $$;

-- ── 1. learning_events (append-only) ─────────────────────────────────────────
-- One row per meaningful learning moment: a lesson taught, a practice round finished, a revision done.
-- `stage` follows the nine-step cycle: assess > explain > demonstrate > practise > evaluate > correct > adapt > reinforce > master.
-- `method` uses the same keys as the app's teaching methods (study-engine.js).
create table if not exists public.learning_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  client_id   text not null check (char_length(client_id) between 6 and 64),
  subject     text not null check (char_length(subject) between 1 and 80),
  topic       text not null check (char_length(topic) between 1 and 120),
  tool        text not null check (tool in ('ask','teach','practice','mock','flashcards','revision','notes')),
  stage       text check (stage is null or stage in ('assess','explain','demonstrate','practise','evaluate','correct','adapt','reinforce','master')),
  method      text check (method is null or method in ('simple','worked_steps','analogy','socratic','summary','retrieval','exam_focus','cause_effect','visual','derivation')),
  difficulty  text check (difficulty is null or difficulty in ('Easy','Medium','Hard','Exam')),
  outcome     text check (outcome is null or outcome in ('knew','shaky','lost')),
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (user_id, client_id)            -- the same event can never be stored twice (idempotent sync)
);

create index if not exists learning_events_user_time_idx  on public.learning_events (user_id, created_at desc);
create index if not exists learning_events_user_topic_idx on public.learning_events (user_id, subject, topic, occurred_at desc);

-- Guard: clamp client clocks and cap volume per user. SECURITY INVOKER (no elevated rights), search_path pinned.
create or replace function public.learning_events_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.occurred_at is null or new.occurred_at > now() then new.occurred_at := now(); end if;
  if new.occurred_at < now() - interval '90 days' then new.occurred_at := now(); end if;
  if (select count(*) from public.learning_events e
       where e.user_id = new.user_id and e.created_at > now() - interval '24 hours') >= 2000 then
    raise exception 'learning_events: daily limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists learning_events_guard_trg on public.learning_events;
create trigger learning_events_guard_trg before insert on public.learning_events
  for each row execute function public.learning_events_guard();

alter table public.learning_events enable row level security;
drop policy if exists "select own learning_events" on public.learning_events;
drop policy if exists "insert own learning_events" on public.learning_events;
create policy "select own learning_events" on public.learning_events for select to authenticated using (auth.uid() = user_id);
create policy "insert own learning_events" on public.learning_events for insert to authenticated with check (auth.uid() = user_id);

revoke all on table public.learning_events from anon, authenticated;
grant select on public.learning_events to authenticated;
grant insert (user_id, client_id, subject, topic, tool, stage, method, difficulty, outcome, occurred_at)
  on public.learning_events to authenticated;
grant select, insert, update, delete on public.learning_events to service_role;   -- API: account export / deletion

-- ── 2. learning_preferences (student-stated only) ────────────────────────────
-- One row per student. Every column is a choice the student made; nothing here is inferred by the AI.
create table if not exists public.learning_preferences (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  preferred_method text check (preferred_method is null or preferred_method in ('simple','worked_steps','analogy','socratic','summary','retrieval','exam_focus','cause_effect','visual','derivation')),
  pace             text check (pace is null or pace in ('gentle','steady','fast')),
  answer_detail    text check (answer_detail is null or answer_detail in ('short','balanced','detailed')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create or replace function public.learning_preferences_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists learning_preferences_touch_trg on public.learning_preferences;
create trigger learning_preferences_touch_trg before insert or update on public.learning_preferences
  for each row execute function public.learning_preferences_touch();

alter table public.learning_preferences enable row level security;
drop policy if exists "select own learning_preferences" on public.learning_preferences;
drop policy if exists "insert own learning_preferences" on public.learning_preferences;
drop policy if exists "update own learning_preferences" on public.learning_preferences;
create policy "select own learning_preferences" on public.learning_preferences for select to authenticated using (auth.uid() = user_id);
create policy "insert own learning_preferences" on public.learning_preferences for insert to authenticated with check (auth.uid() = user_id);
create policy "update own learning_preferences" on public.learning_preferences for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on table public.learning_preferences from anon, authenticated;
grant select on public.learning_preferences to authenticated;
grant insert (user_id, preferred_method, pace, answer_detail) on public.learning_preferences to authenticated;
grant update (preferred_method, pace, answer_detail) on public.learning_preferences to authenticated;
grant select, insert, update, delete on public.learning_preferences to service_role;

-- ── 3. Curriculum: verified learning objectives and prerequisites ────────────
-- Same trust model as schema 20: only service_role writes (scripts/publish-syllabus.js or the SQL editor), and a topic is
-- only visible once its syllabus is published. `source` on the syllabus already records who verified it and where from.
--   objectives     JSON array of short strings:  ["Solve linear equations in one unknown", ...]
--   prerequisites  JSON array of topic NAMES in the SAME syllabus: ["Fractions", "Indices"]
-- Never fill these with guesses. An empty array means "not verified yet", and the app will say so instead of inventing.
alter table public.curriculum_topics add column if not exists objectives    jsonb not null default '[]'::jsonb;
alter table public.curriculum_topics add column if not exists prerequisites jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'curriculum_topics_objectives_ok' and conrelid = 'public.curriculum_topics'::regclass) then
    alter table public.curriculum_topics add constraint curriculum_topics_objectives_ok
      check (jsonb_typeof(objectives) = 'array' and jsonb_array_length(objectives) <= 20 and pg_column_size(objectives) <= 8000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'curriculum_topics_prerequisites_ok' and conrelid = 'public.curriculum_topics'::regclass) then
    alter table public.curriculum_topics add constraint curriculum_topics_prerequisites_ok
      check (jsonb_typeof(prerequisites) = 'array' and jsonb_array_length(prerequisites) <= 12 and pg_column_size(prerequisites) <= 2000);
  end if;
end $$;

-- Read-only checker: run it for a syllabus BEFORE publishing. It lists every prerequisite that points at a topic that
-- does not exist in the same syllabus, a topic that lists itself, and any entry that is not a short non-empty string.
-- Returns no rows when everything is consistent. Changes nothing.
create or replace function public.curriculum_check_prerequisites(p_id uuid)
returns table (topic text, problem text, detail text)
language sql stable set search_path = public as $$
  with t as (select name, prerequisites from public.curriculum_topics where syllabus_id = p_id),
       e as (select t.name as topic, x.value as val, jsonb_typeof(x.value) as kind
               from t, lateral jsonb_array_elements(t.prerequisites) as x(value))
  select e.topic, 'not_a_string'::text, left(e.val::text, 60) from e where e.kind <> 'string'
  union all
  select e.topic, 'bad_length'::text, left(e.val #>> '{}', 60) from e
   where e.kind = 'string' and char_length(btrim(e.val #>> '{}')) not between 1 and 160
  union all
  select e.topic, 'refers_to_itself'::text, e.val #>> '{}' from e where e.kind = 'string' and (e.val #>> '{}') = e.topic
  union all
  select e.topic, 'unknown_topic'::text, e.val #>> '{}' from e
   where e.kind = 'string' and (e.val #>> '{}') <> e.topic and not exists (select 1 from t where t.name = (e.val #>> '{}'));
$$;
revoke all on function public.curriculum_check_prerequisites(uuid) from public, anon, authenticated;
grant execute on function public.curriculum_check_prerequisites(uuid) to service_role;

-- ── 4. SELF-CHECK: any failure aborts and rolls back everything above ────────
do $$
declare n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.learning_events'::regclass) then
    raise exception 'self-check failed: RLS is not enabled on learning_events';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.learning_preferences'::regclass) then
    raise exception 'self-check failed: RLS is not enabled on learning_preferences';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'learning_events';
  if n <> 2 then raise exception 'self-check failed: learning_events should have exactly 2 policies, found %', n; end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'learning_preferences';
  if n <> 3 then raise exception 'self-check failed: learning_preferences should have exactly 3 policies, found %', n; end if;
  if has_table_privilege('anon', 'public.learning_events', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.learning_preferences', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: anon has access to a learning table';
  end if;
  if has_table_privilege('authenticated', 'public.learning_events', 'INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: authenticated has a table-wide write privilege on learning_events';
  end if;
  if has_column_privilege('authenticated', 'public.learning_events', 'outcome', 'UPDATE')
     or has_column_privilege('authenticated', 'public.learning_events', 'id', 'INSERT')
     or has_column_privilege('authenticated', 'public.learning_events', 'created_at', 'INSERT') then
    raise exception 'self-check failed: students can rewrite learning history or set server-controlled columns';
  end if;
  if has_table_privilege('authenticated', 'public.learning_preferences', 'INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: authenticated has a table-wide write privilege on learning_preferences';
  end if;
  if has_column_privilege('authenticated', 'public.learning_preferences', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.learning_preferences', 'updated_at', 'UPDATE') then
    raise exception 'self-check failed: students can change the owner or the timestamp of a preference row';
  end if;
  if not has_table_privilege('service_role', 'public.learning_events', 'SELECT,INSERT')
     or not has_table_privilege('service_role', 'public.learning_preferences', 'SELECT,INSERT') then
    raise exception 'self-check failed: service_role lacks access to a learning table';
  end if;
  if has_table_privilege('authenticated', 'public.curriculum_topics', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('anon', 'public.curriculum_topics', 'INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: a client role can write curriculum topics';
  end if;
  if not has_table_privilege('anon', 'public.curriculum_topics', 'SELECT') then
    raise exception 'self-check failed: curriculum topics are no longer publicly readable';
  end if;
  if has_function_privilege('authenticated', 'public.curriculum_check_prerequisites(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.curriculum_check_prerequisites(uuid)', 'EXECUTE') then
    raise exception 'self-check failed: curriculum_check_prerequisites is callable by a client role';
  end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'curriculum_topics'
        and column_name in ('objectives','prerequisites')) <> 2 then
    raise exception 'self-check failed: curriculum_topics is missing objectives/prerequisites';
  end if;
  raise notice 'schema 21 self-check passed';
end $$;

commit;

-- ── VERIFY (read-only, run any time) ────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('learning_events','learning_preferences');   -- both true
-- select policyname, cmd from pg_policies where schemaname='public' and tablename in ('learning_events','learning_preferences') order by 1;
-- select * from public.curriculum_check_prerequisites('<syllabus uuid>');                     -- run as service_role; no rows = consistent
