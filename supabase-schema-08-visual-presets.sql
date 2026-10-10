-- StudyMate AI — schema 08: Presets (visual personalization)
-- ───────────────────────────────────────────────────────────────────────
-- Stores each account's chosen Background / Accent / Bagley.
--   • One row per user, RLS: a user can only READ their own row.
--   • Nobody can INSERT/UPDATE the table directly (no policy + revoked).
--     Every write goes through set_visual_preferences(), which
--       1. validates the three ids (format + range 001..100),
--       2. checks Premium against the `subscriptions` table SERVER-SIDE —
--          anything above id 005 in a category needs an active, unexpired
--          subscription (ids 001-005 of each category are the free ones),
--       3. upserts the row for auth.uid().
--     So a Free user cannot save a Premium item by editing JavaScript or
--     calling the REST API with their own token.
-- Safe to re-run. Run AFTER schema 04 (subscriptions) and 07.

create table if not exists public.user_visual_preferences (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  background_id  text not null default 'background_001',
  accent_id      text not null default 'accent_001',
  bagley_id      text not null default 'bagley_001',
  updated_at     timestamptz not null default now(),
  constraint uvp_background_fmt check (background_id ~ '^background_(0[0-9][1-9]|0[1-9]0|100)$'),
  constraint uvp_accent_fmt     check (accent_id     ~ '^accent_(0[0-9][1-9]|0[1-9]0|100)$'),
  constraint uvp_bagley_fmt     check (bagley_id     ~ '^bagley_(0[0-9][1-9]|0[1-9]0|100)$')
);

alter table public.user_visual_preferences enable row level security;

drop policy if exists "select own visual prefs" on public.user_visual_preferences;
create policy "select own visual prefs" on public.user_visual_preferences
  for select using (auth.uid() = user_id);

-- No insert/update/delete policies on purpose; also revoke the table grants.
revoke insert, update, delete on public.user_visual_preferences from anon, authenticated;

create or replace function public.set_visual_preferences(
  p_background text,
  p_accent text,
  p_bagley text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_premium boolean := false;
  v_free_max constant integer := 5;   -- ids 001..005 per category are free
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  if p_background !~ '^background_(0[0-9][1-9]|0[1-9]0|100)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_background');
  end if;
  if p_accent !~ '^accent_(0[0-9][1-9]|0[1-9]0|100)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_accent');
  end if;
  if p_bagley !~ '^bagley_(0[0-9][1-9]|0[1-9]0|100)$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_bagley');
  end if;

  select exists (
    select 1 from subscriptions s
     where s.user_id = v_uid
       and s.status = 'active'
       and s.current_period_end > now()
  ) into v_premium;

  if not v_premium then
    if substring(p_background from '[0-9]+$')::int > v_free_max then
      return jsonb_build_object('ok', false, 'reason', 'premium_required', 'field', 'background');
    end if;
    if substring(p_accent from '[0-9]+$')::int > v_free_max then
      return jsonb_build_object('ok', false, 'reason', 'premium_required', 'field', 'accent');
    end if;
    if substring(p_bagley from '[0-9]+$')::int > v_free_max then
      return jsonb_build_object('ok', false, 'reason', 'premium_required', 'field', 'bagley');
    end if;
  end if;

  insert into user_visual_preferences (user_id, background_id, accent_id, bagley_id, updated_at)
  values (v_uid, p_background, p_accent, p_bagley, now())
  on conflict (user_id) do update
    set background_id = excluded.background_id,
        accent_id     = excluded.accent_id,
        bagley_id     = excluded.bagley_id,
        updated_at    = now();

  return jsonb_build_object('ok', true, 'premium', v_premium);
end;
$fn$;

revoke all on function public.set_visual_preferences(text, text, text) from public, anon;
grant execute on function public.set_visual_preferences(text, text, text) to authenticated;
