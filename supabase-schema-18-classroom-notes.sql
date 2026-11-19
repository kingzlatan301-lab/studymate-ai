-- Schema 18 -- Classroom Notes: server-side storage for goals, progress, bookmarks and notes.
-- ADDITIVE ONLY: creates new tables, drops/alters nothing. NOT YET USED BY THE APP: the first release keeps this data
-- in localStorage (see classroom-notes.js). Apply only when the sync step is built; safe to run earlier.
-- Curriculum itself stays in curriculum-data.js (reviewable in git); these tables hold only per-student data,
-- keyed by exam-board code / subject / topic NAME so a curriculum update never orphans or deletes progress.
-- Rollback: drop table public.cn_notes, public.cn_bookmarks, public.cn_topic_progress, public.cn_exam_goals;

create table if not exists public.cn_exam_goals (
  user_id uuid not null references auth.users(id) on delete cascade,
  board_code text not null check (char_length(board_code) between 1 and 40),
  created_at timestamptz not null default now(),
  primary key (user_id, board_code)
);
create table if not exists public.cn_topic_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  board_code text not null, subject text not null check (char_length(subject) <= 120), topic text not null check (char_length(topic) <= 160),
  done boolean not null default false, last_format text check (last_format in ('notes','glance','examples','practice')),
  updated_at timestamptz not null default now(),
  primary key (user_id, board_code, subject, topic)
);
create table if not exists public.cn_bookmarks (
  user_id uuid not null references auth.users(id) on delete cascade,
  board_code text not null, subject text not null check (char_length(subject) <= 120), topic text not null check (char_length(topic) <= 160),
  created_at timestamptz not null default now(),
  primary key (user_id, board_code, subject, topic)
);
create table if not exists public.cn_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  board_code text not null, subject text not null check (char_length(subject) <= 120), topic text not null check (char_length(topic) <= 160),
  body text not null check (char_length(body) <= 5000),
  updated_at timestamptz not null default now(),
  primary key (user_id, board_code, subject, topic)
);

do $$ declare t text; begin
  foreach t in array array['cn_exam_goals','cn_topic_progress','cn_bookmarks','cn_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_own', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t||'_own', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
