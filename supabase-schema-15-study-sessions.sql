-- ═══════════════════════════════════════════════════════════════════════════
-- StudyMate AI — schema 15 (REVISED): study history + saved-question notes
-- filename: supabase-schema-15-study-sessions.sql   (replaces the earlier draft of the same name)
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE   1. study_sessions: completed practice / mock / CBT / quiz / retry sessions (history + analytics).
--           2. saved_questions.note: a personal note on a saved question.
-- DEPENDS   Schema 07 (public.saved_questions) and schema 12's grants model. Aborts with a clear message if 07 is missing.
-- SAFE ON AN EXISTING DATABASE?  Yes. Additive; no table is dropped, no row is deleted or rewritten.
--           Idempotent. If the earlier draft of schema 15 was already run, this tightens it:
--             • removes the client DELETE policy/grant and the unused subject index
--             • limits client INSERT to named columns (client can no longer set id / created_at)
--             • adds the explicit service_role grant the API needs (account export reads this table)
--             • scopes every policy `to authenticated`
-- SECURITY  Students: read own sessions, insert own sessions, never update/delete them (history cannot be rewritten).
--           saved_questions: students may update ONLY the `note` column of their own rows.
--           anon: no access. service_role: full access (server only; key never reaches the browser).
-- SELF-CHECK  Ends with checks that ABORT and roll back the whole migration if any permission is wrong.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

do $$
begin
  if to_regclass('public.saved_questions') is null then
    raise exception 'schema 15 needs public.saved_questions (run schema 07 first)';
  end if;
end $$;

-- ── 1. study_sessions ───────────────────────────────────────────────────────
create table if not exists public.study_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  client_id    text not null check (char_length(client_id) between 6 and 64),
  "type"       text not null check ("type" in ('practice','mock','cbt','quiz','retry')),
  subject      text not null check (char_length(subject) between 1 and 80),
  topics       text[] not null default '{}',
  difficulty   text check (difficulty is null or char_length(difficulty) <= 40),
  "style"      text check ("style" is null or char_length("style") <= 80),
  total        integer not null check (total between 1 and 500),
  correct      integer not null check (correct >= 0 and correct <= total),
  duration_sec integer check (duration_sec is null or duration_sec between 0 and 86400),
  completed_at timestamptz not null default now(),
  questions    jsonb not null check (jsonb_typeof(questions) = 'array' and pg_column_size(questions) <= 400000),
  created_at   timestamptz not null default now(),
  unique (user_id, client_id)          -- the same session can never be stored twice (idempotent sync)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'study_sessions_topics_len' and conrelid = 'public.study_sessions'::regclass) then
    alter table public.study_sessions add constraint study_sessions_topics_len check (cardinality(topics) <= 30);
  end if;
end $$;

create index if not exists study_sessions_user_completed_idx on public.study_sessions (user_id, completed_at desc);
drop index if exists public.study_sessions_user_subject_idx;       -- nothing queries by subject server-side

-- ── 2. Row Level Security: separate SELECT / INSERT policies, no UPDATE or DELETE for students ──
alter table public.study_sessions enable row level security;
drop policy if exists "select own study_sessions" on public.study_sessions;
drop policy if exists "insert own study_sessions" on public.study_sessions;
drop policy if exists "update own study_sessions" on public.study_sessions;
drop policy if exists "delete own study_sessions" on public.study_sessions;
create policy "select own study_sessions" on public.study_sessions for select to authenticated using (auth.uid() = user_id);
create policy "insert own study_sessions" on public.study_sessions for insert to authenticated with check (auth.uid() = user_id);

-- ── 3. Explicit Data API grants (least privilege) ───────────────────────────
revoke all on table public.study_sessions from anon, authenticated;
grant select on public.study_sessions to authenticated;
grant insert (user_id, client_id, "type", subject, topics, difficulty, "style", total, correct, duration_sec, completed_at, questions)
  on public.study_sessions to authenticated;
grant select, insert, update, delete on public.study_sessions to service_role;   -- API: account export / deletion

-- ── 4. saved_questions: notes (students may change ONLY the note column of their own rows) ──
alter table public.saved_questions add column if not exists note text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'saved_questions_note_len' and conrelid = 'public.saved_questions'::regclass) then
    alter table public.saved_questions add constraint saved_questions_note_len check (note is null or char_length(note) <= 1000);
  end if;
end $$;
drop policy if exists "update own saved_questions" on public.saved_questions;
create policy "update own saved_questions" on public.saved_questions for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant update (note) on public.saved_questions to authenticated;

-- ── 5. SELF-CHECK (this is the exact block that ran successfully): any failure aborts and rolls back everything above ──
do $$
declare n int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.study_sessions'::regclass) then
    raise exception 'self-check failed: RLS is not enabled on study_sessions';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'study_sessions';
  if n <> 2 then raise exception 'self-check failed: study_sessions should have exactly 2 policies, found %', n; end if;
  if has_table_privilege('anon', 'public.study_sessions', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: anon has access to study_sessions';
  end if;
  if has_table_privilege('authenticated', 'public.study_sessions', 'INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: authenticated has a table-wide write privilege on study_sessions';
  end if;
  if has_column_privilege('authenticated', 'public.study_sessions', 'correct', 'UPDATE') then
    raise exception 'self-check failed: students can rewrite recorded scores';
  end if;
  if not has_table_privilege('service_role', 'public.study_sessions', 'SELECT,INSERT') then
    raise exception 'self-check failed: service_role lacks access to study_sessions';
  end if;
  if not has_column_privilege('authenticated', 'public.saved_questions', 'note', 'UPDATE') then
    raise exception 'self-check failed: students cannot update their note';
  end if;
  if has_column_privilege('authenticated', 'public.saved_questions', 'question', 'UPDATE') then
    raise exception 'self-check failed: students can edit more than the note column of saved_questions';
  end if;
  raise notice 'schema 15 self-check passed';
end $$;

commit;
