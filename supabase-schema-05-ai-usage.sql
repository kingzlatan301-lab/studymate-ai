-- StudyMate AI — server-side Free usage tracking
-- ───────────────────────────────────────────────────────────────────────
-- Run this once in the Supabase SQL editor (or via the CLI) BEFORE
-- deploying the updated api/ask.js. It backs the "3 AI questions/day"
-- Free limit with a real server-side counter, so it can no longer be
-- bypassed by clearing localStorage, changing device time, opening
-- another browser, or editing frontend JS.
--
-- See api/_lib/plan.js (checkAndIncrementUsage) for how this is called,
-- and api/ask.js for why only the 'askAI' feature uses it (Mock Exam,
-- CBT Mode etc. call /api/ask once per question in a loop, so a hard
-- per-request counter doesn't map cleanly onto their weekly limits —
-- those stay enforced client-side, as they already were).

create table if not exists public.ai_usage (
  user_id     uuid not null references auth.users(id) on delete cascade,
  feature     text not null,          -- e.g. 'askAI'
  period_key  text not null,          -- 'YYYY-MM-DD' (daily) or 'YYYY-Www' ISO week (weekly)
  count       integer not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (user_id, feature, period_key)
);

alter table public.ai_usage enable row level security;

-- Students can only ever see their own usage row — same pattern already
-- used by weakness_profiles / subscriptions in this project.
drop policy if exists "select own ai_usage" on public.ai_usage;
create policy "select own ai_usage" on public.ai_usage
  for select using (auth.uid() = user_id);

-- The app only ever writes through check_and_increment_usage() below
-- (SECURITY DEFINER), but these keep the table safe even if something
-- calls the REST API on it directly.
drop policy if exists "insert own ai_usage" on public.ai_usage;
create policy "insert own ai_usage" on public.ai_usage
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own ai_usage" on public.ai_usage;
create policy "update own ai_usage" on public.ai_usage
  for update using (auth.uid() = user_id);

-- Atomically checks whether the calling student is still under `p_max`
-- for (feature, period_key) and increments it if so, in a single
-- transaction. This is what actually closes the "open two tabs and spam
-- the button" race — a plain read-then-write from the API route alone
-- would not fully prevent that.
--
-- SECURITY DEFINER is required so this can upsert into ai_usage under
-- RLS, but it still only ever acts on auth.uid() — the identity from the
-- caller's own verified JWT, exactly like every other query in
-- api/_lib/plan.js. It can never be pointed at another student's row.
create or replace function public.check_and_increment_usage(
  p_feature text,
  p_period_key text,
  p_max integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into ai_usage (user_id, feature, period_key, count, updated_at)
  values (auth.uid(), p_feature, p_period_key, 0, now())
  on conflict (user_id, feature, period_key) do nothing;

  select count into v_count
    from ai_usage
    where user_id = auth.uid() and feature = p_feature and period_key = p_period_key
    for update;

  if v_count >= p_max then
    return jsonb_build_object('allowed', false, 'count', v_count);
  end if;

  update ai_usage
    set count = count + 1, updated_at = now()
    where user_id = auth.uid() and feature = p_feature and period_key = p_period_key;

  return jsonb_build_object('allowed', true, 'count', v_count + 1);
end;
$$;

grant execute on function public.check_and_increment_usage(text, text, integer) to authenticated;
