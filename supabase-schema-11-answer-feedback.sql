-- StudyMate AI — answer feedback (helpful / not helpful / report an issue)
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Clients insert directly under RLS (same pattern as saved_questions); nobody can read, edit or delete anyone else's rows.

create table if not exists public.answer_feedback (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  question     text not null check (char_length(question) <= 6000),
  subject      text not null check (char_length(subject) <= 80),
  exam         text check (exam is null or char_length(exam) <= 40),
  kind         text not null check (kind in ('rating', 'report')),
  value        text not null check (
                 (kind = 'rating' and value in ('helpful', 'not_helpful')) or
                 (kind = 'report' and value in ('Wrong answer', 'Confusing explanation', 'Inappropriate content', 'Something else'))
               ),
  question_key text generated always as (md5(question || '|' || subject)) stored,
  created_at   timestamptz not null default now(),
  unique (user_id, question_key, kind)
);

create index if not exists answer_feedback_created_idx on public.answer_feedback (created_at desc);

alter table public.answer_feedback enable row level security;

drop policy if exists "select own answer_feedback" on public.answer_feedback;
create policy "select own answer_feedback" on public.answer_feedback
  for select using (auth.uid() = user_id);

drop policy if exists "insert own answer_feedback" on public.answer_feedback;
create policy "insert own answer_feedback" on public.answer_feedback
  for insert with check (auth.uid() = user_id);
-- No update/delete policies on purpose: feedback is append-only for clients.
