-- StudyMate AI — youtube_cache table
-- Run this in Supabase → SQL Editor → New query → Run.
--
-- A shared cache of YouTube search results, keyed by search query. This is
-- what api/youtube.js checks BEFORE calling the YouTube API — if a query
-- was already searched by any student recently, it's served straight from
-- here at zero YouTube-quota cost. Given the shared key's ~100
-- searches/day limit, this is what makes that limit actually survive real
-- traffic: popular topics ("photosynthesis", "quadratic equations") get
-- searched once, then reused by everyone.
--
-- Unlike weakness_profiles, this table holds no personal/user data at all
-- — just cached public YouTube search results, the same thing YouTube's
-- own website would show anyone. That's why RLS here is deliberately
-- permissive (open read/write for the shared anon key) rather than scoped
-- to auth.uid() — there's no student data to protect in this table, and it
-- needs to be shared across every request, not tied to whoever happens to
-- be signed in.

create table public.youtube_cache (
  query text primary key,       -- normalized (trimmed, lowercased) search text
  results jsonb not null,       -- the array of {videoId, title, channelTitle, thumbnail}
  cached_at timestamptz not null default now()
);

alter table public.youtube_cache enable row level security;

create policy "Anyone can read cached video results"
  on public.youtube_cache for select
  using (true);

create policy "Anyone can write cached video results"
  on public.youtube_cache for insert
  with check (true);

create policy "Anyone can refresh cached video results"
  on public.youtube_cache for update
  using (true);
