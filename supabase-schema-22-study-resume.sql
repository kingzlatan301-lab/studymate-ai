-- ═══════════════════════════════════════════════════════════════════════════
-- StudyMate AI - schema 22: continue where you left off, on any device     filename: supabase-schema-22-study-resume.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE   One saved "in progress" item per student per tool, so a Teach Me lesson, a Practice session, a Mock Exam
--           or a CBT exam started on one device can be continued on another (and survives clearing the app).
--             kind = 'lesson'   Teach Me lesson (the finished lesson text + the student's position)
--                    'practice' Practice session (score, difficulty, the question on screen, history log)
--                    'mock'     Mock Exam (questions, answers, and the exam's END TIME)
--                    'cbt'      CBT exam (questions, answers, flags, and the exam's END TIME)
--           Exams store an absolute end time, so the clock keeps counting while the app is closed.
--
-- DESIGN    * ONE row per (user, kind): a new session replaces the old one; the table can never grow.
--           * `content` = the heavy, rarely changing part (lesson text / question sets). `state` = the small part that
--             changes on every tap (position, answers, flags). The app uploads `content` only when it changes, so a
--             2-hour CBT does not re-upload ~150 KB on every answer. `content_hash` lets a state-only update prove it
--             matches the content already stored (a device that is behind can never mix its position into another
--             device's session).
--           * Finishing or discarding writes a TOMBSTONE (done = true, content/state removed), not a delete, so a second
--             device that still holds the old copy learns it is over instead of resurrecting it.
--           * Last write wins by the student's own timestamp: a trigger ignores any write older than what is stored and
--             clamps timestamps from the future. Nothing here is a security boundary for exam integrity: this is
--             practice, not a proctored exam.
--
-- NOT STORED  No payment, plan or entitlement data. Nothing here grants anything. Quotas stay server-side (a resumed
--           session makes no new AI call and uses no new Free-plan allowance).
-- DEPENDS   auth.users only. Independent of schemas 15-21.
-- SAFE ON AN EXISTING DATABASE?  Yes. Additive: one new table, one trigger function. No table is dropped, no row is
--           deleted or rewritten. Idempotent (safe to run twice).
-- SECURITY  Students: read, insert and update ONLY their own rows (RLS `auth.uid() = user_id`). No DELETE (tombstones
--           instead). Column grants: students cannot touch `updated_at`. anon: no access. service_role: full access
--           (server only: account export / deletion; the key never reaches the browser). `on delete cascade` from
--           auth.users, so deleting an account removes these rows.
--           Why UPDATE is granted on user_id and kind too: the Data API's upsert lists every sent column in its
--           ON CONFLICT ... DO UPDATE SET. RLS (`with check`) still pins user_id to the caller, and the trigger below
--           raises if user_id or kind ever change on an existing row.
-- SIZE      content <= 400 KB, state <= 150 KB (CHECK constraints).
-- SELF-CHECK  Ends with checks that ABORT and roll back the whole migration if any permission is wrong.
-- ROLLBACK    drop table public.study_resume;  drop function public.study_resume_guard();
-- NOT TESTED HERE  Reviewed and structurally tested by the repo's test-suite but NOT executed against a live Postgres.
--           Run it first on a Supabase branch / staging project, then production.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. study_resume ──────────────────────────────────────────────────────────
create table if not exists public.study_resume (
  user_id      uuid        not null references auth.users(id) on delete cascade,
  kind         text        not null check (kind in ('lesson','practice','mock','cbt')),
  content      jsonb       check (content is null or (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 400000)),
  state        jsonb       check (state   is null or (jsonb_typeof(state)   = 'object' and octet_length(state::text)   <= 150000)),
  content_hash text        check (content_hash is null or char_length(content_hash) between 1 and 64),
  done         boolean     not null default false,
  saved_at     timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, kind),
  -- a live row must carry its session; a finished/discarded row (tombstone) carries nothing
  constraint study_resume_live_or_tombstone check (
    (done and content is null and state is null) or (not done and content is not null and state is not null and content_hash is not null)
  )
);

-- ── 2. Guard: last write wins, clamp clocks, identity can never change ───────
create or replace function public.study_resume_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.kind <> old.kind then
      raise exception 'study_resume: owner and kind cannot change' using errcode = 'check_violation';
    end if;
  end if;
  if new.saved_at is null or new.saved_at > now() then new.saved_at := now(); end if;       -- a fast device clock never wins by being "in the future"
  if new.saved_at < now() - interval '30 days' then return null; end if;                    -- nothing older than 30 days is worth keeping
  if tg_op = 'UPDATE' and new.saved_at < old.saved_at then return null; end if;             -- a device that is behind never overwrites a newer save
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists study_resume_guard_trg on public.study_resume;
create trigger study_resume_guard_trg before insert or update on public.study_resume
  for each row execute function public.study_resume_guard();

-- ── 3. Row Level Security: own rows only; no DELETE policy (tombstones instead) ──
alter table public.study_resume enable row level security;
drop policy if exists "select own study_resume" on public.study_resume;
drop policy if exists "insert own study_resume" on public.study_resume;
drop policy if exists "update own study_resume" on public.study_resume;
create policy "select own study_resume" on public.study_resume for select to authenticated using (auth.uid() = user_id);
create policy "insert own study_resume" on public.study_resume for insert to authenticated with check (auth.uid() = user_id);
create policy "update own study_resume" on public.study_resume for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 4. Explicit Data API grants (least privilege) ────────────────────────────
revoke all on table public.study_resume from anon, authenticated;
grant select on public.study_resume to authenticated;
grant insert (user_id, kind, content, state, content_hash, done, saved_at) on public.study_resume to authenticated;
grant update (user_id, kind, content, state, content_hash, done, saved_at) on public.study_resume to authenticated;
grant select, insert, update, delete on public.study_resume to service_role;     -- API: account export / deletion

-- ── 5. SELF-CHECK: any failure aborts and rolls back everything above ────────
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.study_resume'::regclass) then
    raise exception 'self-check failed: RLS is not enabled on study_resume';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'study_resume') <> 3 then
    raise exception 'self-check failed: study_resume must have exactly 3 policies (select, insert, update)';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'study_resume' and cmd in ('DELETE', 'ALL')) then
    raise exception 'self-check failed: study_resume has a DELETE or ALL policy';
  end if;
  if has_table_privilege('anon', 'public.study_resume', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: anon has access to study_resume';
  end if;
  if has_table_privilege('authenticated', 'public.study_resume', 'INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: authenticated has a table-wide write privilege on study_resume';
  end if;
  if has_table_privilege('authenticated', 'public.study_resume', 'DELETE') then
    raise exception 'self-check failed: students can delete study_resume rows';
  end if;
  if has_column_privilege('authenticated', 'public.study_resume', 'updated_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.study_resume', 'updated_at', 'UPDATE') then
    raise exception 'self-check failed: students can set the server-controlled updated_at';
  end if;
  if not has_table_privilege('service_role', 'public.study_resume', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'self-check failed: service_role lacks access to study_resume';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.study_resume'::regclass and tgname = 'study_resume_guard_trg' and not tgisinternal) then
    raise exception 'self-check failed: the study_resume guard trigger is missing';
  end if;
  raise notice 'schema 22 self-check passed';
end $$;

commit;

-- ── VERIFY (read-only, run any time) ────────────────────────────────────────
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'study_resume';      -- true
-- select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'study_resume' order by 1;  -- select / insert / update
-- select kind, done, saved_at, updated_at from public.study_resume order by saved_at desc limit 20;              -- as service_role
--
-- ── OPTIONAL HOUSEKEEPING (run by hand or schedule; the app ignores rows older than 14 days anyway) ──
-- delete from public.study_resume where saved_at < now() - interval '60 days';
