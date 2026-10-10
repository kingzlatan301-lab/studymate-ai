-- StudyMate AI — Academic Intelligence data model (Phase 2)
-- Run this in Supabase → SQL Editor → New query → Run.
--
-- Everything here follows the same pattern as weakness_profiles and
-- subscriptions: RLS scoped strictly to auth.uid(), no exceptions. Only
-- three new tables — daily missions, exam reports, and readiness
-- explanations are all computed on the fly from these tables plus
-- weakness_profiles, not stored separately, per the spec's own
-- cost-control instruction (deterministic logic where possible, don't
-- store what can be cheaply recomputed).

-- ── REVIEW SCHEDULE ──────────────────────────────────────────────────
-- Concept-level spaced reassessment — distinct from Flashcards' per-card
-- system. One row per (subject, topic) a student has ever been tested on.
-- "Struggled → review soon. Demonstrated mastery → push it further out."
create table public.review_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  topic text not null,
  mastery_level text not null default 'Not Started',
  last_tested_at timestamptz,
  next_review_at timestamptz not null default now(),
  confidence numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, subject, topic)
);

alter table public.review_schedule enable row level security;

create policy "Users can view their own review schedule"
  on public.review_schedule for select using (auth.uid() = user_id);
create policy "Users can insert their own review schedule"
  on public.review_schedule for insert with check (auth.uid() = user_id);
create policy "Users can update their own review schedule"
  on public.review_schedule for update using (auth.uid() = user_id);

create index review_schedule_due_idx
  on public.review_schedule (user_id, next_review_at);

-- ── READINESS SNAPSHOTS ──────────────────────────────────────────────
-- Periodic deterministic snapshots of the Readiness Score per subject —
-- this is what lets the dashboard say "↑6% this month" without an AI call
-- or recomputing history from raw attempts every time.
create table public.readiness_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  readiness_pct integer not null check (readiness_pct between 0 and 100),
  computed_at timestamptz not null default now()
);

alter table public.readiness_snapshots enable row level security;

create policy "Users can view their own readiness snapshots"
  on public.readiness_snapshots for select using (auth.uid() = user_id);
create policy "Users can insert their own readiness snapshots"
  on public.readiness_snapshots for insert with check (auth.uid() = user_id);

create index readiness_snapshots_lookup_idx
  on public.readiness_snapshots (user_id, subject, computed_at desc);

-- ── PAST PAPER ANALYSES ──────────────────────────────────────────────
-- Stores only the AI's STRUCTURED OUTPUT (topic frequency, priority map),
-- never the raw uploaded document itself — per the spec's own privacy
-- instruction to avoid storing more than genuinely necessary. The actual
-- file is sent to Claude for one-time analysis and never persisted.
create table public.past_paper_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  papers_analyzed integer not null default 1,
  analysis jsonb not null, -- { topicFrequency: [...], priorityMap: {...}, notes: "..." }
  created_at timestamptz not null default now()
);

alter table public.past_paper_analyses enable row level security;

create policy "Users can view their own past paper analyses"
  on public.past_paper_analyses for select using (auth.uid() = user_id);
create policy "Users can insert their own past paper analyses"
  on public.past_paper_analyses for insert with check (auth.uid() = user_id);
create policy "Users can delete their own past paper analyses"
  on public.past_paper_analyses for delete using (auth.uid() = user_id);
