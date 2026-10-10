-- StudyMate AI — weakness_profiles table
-- Run this in Supabase → SQL Editor → New query → Run.
-- One row per graded attempt (mirrors the local model in weakness-profile.js
-- exactly: subject + topic + level/difficulty/mistake_type per attempt),
-- rather than one row per subject/topic — this way mastery and trend can be
-- computed from the raw attempts the same way the local version does, and
-- nothing is lost in aggregation.

create table public.weakness_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  topic text not null default 'General',
  level text not null check (level in ('knew', 'shaky', 'lost')),
  difficulty text,              -- 'Easy' | 'Medium' | 'Hard' | 'Exam' | 'Teach Me' | null
  mistake_type text,            -- nullable; can be filled in later via an UPDATE (see below)
  client_ts bigint,             -- the original Date.now() from the device, kept for migration/dedup
  created_at timestamptz not null default now()
);

-- Speeds up the main query shape: "this user's attempts for this subject/topic,
-- most recent first" — exactly what computing mastery/trend needs.
create index weakness_profiles_user_subject_topic_idx
  on public.weakness_profiles (user_id, subject, topic, created_at desc);

alter table public.weakness_profiles enable row level security;

-- Four separate policies, not one blanket rule: the app reads (dashboard),
-- writes (recording an attempt), and — importantly — UPDATES an existing
-- row (the "what went wrong?" mistake-tagging feature in Practice Mode and
-- Mock Exam tags mistake_type on an attempt *after* it was already
-- recorded). Deletes are included too, for a future "clear my data" action.

create policy "Users can view their own weakness data"
  on public.weakness_profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert their own weakness data"
  on public.weakness_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own weakness data"
  on public.weakness_profiles for update
  using (auth.uid() = user_id);

create policy "Users can delete their own weakness data"
  on public.weakness_profiles for delete
  using (auth.uid() = user_id);
