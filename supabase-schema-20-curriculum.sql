-- Schema 20 -- curriculum, syllabus versions and translations in Supabase (so a new syllabus can be published each year with no app release).
-- ADDITIVE ONLY. Rollback: drop table public.ui_strings, public.curriculum_translations, public.curriculum_topics, public.curriculum_syllabi;
--                          drop function public.publish_syllabus(uuid);
-- Reading is public (curriculum is not personal data) but only PUBLISHED rows are visible. Writing is service role only
-- (scripts/publish-syllabus.js or the SQL editor). The app keeps its bundled curriculum as the offline fallback; a published
-- row for the same board+subject replaces the bundled topic list and its `aliases` carry saved student progress to the new names.

create table if not exists public.curriculum_syllabi (
  id            uuid primary key default gen_random_uuid(),
  board_code    text not null check (char_length(board_code) between 1 and 40),
  subject       text not null check (char_length(subject) between 1 and 120),
  version       text not null check (char_length(version) between 1 and 40),     -- e.g. '2026', '2027-rev1'
  syllabus_year text check (char_length(syllabus_year) <= 120),
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  source        jsonb not null default '{}'::jsonb,                              -- authority, document, url, licence, evidence, verifiedAt, verifiedBy, scope
  aliases       jsonb not null default '{}'::jsonb,                              -- { "old topic name": "new topic name" | null }
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (board_code, subject, version)
);
-- at most ONE published syllabus per board+subject
create unique index if not exists curriculum_one_published on public.curriculum_syllabi (board_code, subject) where status = 'published';
create index if not exists curriculum_syllabi_updated on public.curriculum_syllabi (updated_at);

create table if not exists public.curriculum_topics (
  id          uuid primary key default gen_random_uuid(),
  syllabus_id uuid not null references public.curriculum_syllabi(id) on delete cascade,
  position    int  not null check (position >= 0),
  name        text not null check (char_length(name) between 1 and 160),
  subtopics   jsonb not null default '[]'::jsonb,
  unique (syllabus_id, position),
  unique (syllabus_id, name)
);

create table if not exists public.curriculum_translations (
  syllabus_id    uuid not null references public.curriculum_syllabi(id) on delete cascade,
  topic_position int  not null check (topic_position >= 0),
  lang           text not null check (lang ~ '^[a-z]{2}$'),
  name           text not null check (char_length(name) between 1 and 160),
  subtopics      jsonb not null default '[]'::jsonb,
  status         text not null default 'machine' check (status in ('machine','reviewed')),
  primary key (syllabus_id, topic_position, lang)
);

create table if not exists public.ui_strings (
  key        text not null check (char_length(key) between 1 and 400),           -- the exact English phrase
  lang       text not null check (lang ~ '^[a-z]{2}$'),
  text       text not null check (char_length(text) between 1 and 600),
  status     text not null default 'machine' check (status in ('machine','reviewed')),
  updated_at timestamptz not null default now(),
  primary key (key, lang)
);

-- Publishing swaps the live syllabus for a board+subject in ONE transaction: the previous published version is archived.
create or replace function public.publish_syllabus(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b text; s text;
begin
  select board_code, subject into b, s from public.curriculum_syllabi where id = p_id;
  if b is null then raise exception 'syllabus % not found', p_id; end if;
  if not exists (select 1 from public.curriculum_topics where syllabus_id = p_id) then raise exception 'syllabus % has no topics', p_id; end if;
  update public.curriculum_syllabi set status = 'archived', updated_at = now() where board_code = b and subject = s and status = 'published' and id <> p_id;
  update public.curriculum_syllabi set status = 'published', published_at = now(), updated_at = now() where id = p_id;
end $$;
revoke all on function public.publish_syllabus(uuid) from public, anon, authenticated;
grant execute on function public.publish_syllabus(uuid) to service_role;

alter table public.curriculum_syllabi      enable row level security;
alter table public.curriculum_topics       enable row level security;
alter table public.curriculum_translations enable row level security;
alter table public.ui_strings              enable row level security;

drop policy if exists curriculum_syllabi_read on public.curriculum_syllabi;
create policy curriculum_syllabi_read on public.curriculum_syllabi for select to anon, authenticated using (status = 'published');
drop policy if exists curriculum_topics_read on public.curriculum_topics;
create policy curriculum_topics_read on public.curriculum_topics for select to anon, authenticated
  using (exists (select 1 from public.curriculum_syllabi s where s.id = syllabus_id and s.status = 'published'));
drop policy if exists curriculum_translations_read on public.curriculum_translations;
create policy curriculum_translations_read on public.curriculum_translations for select to anon, authenticated
  using (exists (select 1 from public.curriculum_syllabi s where s.id = syllabus_id and s.status = 'published'));
drop policy if exists ui_strings_read on public.ui_strings;
create policy ui_strings_read on public.ui_strings for select to anon, authenticated using (true);

revoke all on public.curriculum_syllabi, public.curriculum_topics, public.curriculum_translations, public.ui_strings from anon, authenticated;
grant select on public.curriculum_syllabi, public.curriculum_topics, public.curriculum_translations, public.ui_strings to anon, authenticated;
grant select, insert, update, delete on public.curriculum_syllabi, public.curriculum_topics, public.curriculum_translations, public.ui_strings to service_role;

-- VERIFY (read-only):
-- select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('curriculum_syllabi','curriculum_topics','curriculum_translations','ui_strings');  -- all true
-- select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('curriculum_syllabi','curriculum_topics','curriculum_translations','ui_strings') and grantee in ('anon','authenticated') and privilege_type <> 'SELECT';  -- 0 rows
