-- ═══════════════════════════════════════════════════════════════════════════
-- StudyMate AI — schema 14: usage accounting is SERVER-ONLY   (run AFTER 12 and 13)
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PROBLEM THIS CLOSES (Free Mock Exam quota bypass)
--   reserve_usage / reserve_usage_run / commit_usage / release_usage were executable by `authenticated`
--   AND took the limit (p_max, p_max_calls) from the caller. Any signed-in Free user could call them directly
--   with their own token and p_max = 2147483647, create + commit a Mock Exam "run" with a run id they chose,
--   then send that run id to /api/ask. A committed run is "continue free" for up to 40 calls, so every
--   fabricated run id bought 40 Gemini calls without ever passing the limit check.
--
-- THE FIX
--   1. New srv_* functions: same accounting logic, but the student is an explicit p_user_id and they are
--      executable ONLY by service_role. The API (which has already verified the student's access token
--      server-side and owns the limits in api/_lib/limits.js) is the only caller; a student's own token
--      gets "permission denied for function".
--   2. The four old client-callable functions are revoked from anon/authenticated/public (left in place so a
--      rollback of the API code still loads; nothing client-side calls them — checked).
--   3. Read-only get_usage / get_usage_snapshot stay signed-in-callable: they only return the caller's own
--      counters (auth.uid()) and cannot change anything.
--
-- PREREQUISITE: SUPABASE_SERVICE_ROLE_KEY must be set in Vercel (it already is — payments use it). Deploy the
-- API code from this release BEFORE or together with this migration: the old API code calls the revoked
-- functions with the student's token and would fail ("usage check failed") until the new code is live.
--
-- Idempotent. Runs in one transaction and ends with a self-check that ABORTS (rolls everything back) if any
-- client role still has execute on a usage-writing function.
-- ═══════════════════════════════════════════════════════════════════════════
begin;

-- ── 1. reserve (single slot) ────────────────────────────────────────────────
create or replace function public.srv_reserve_usage(
  p_user_id uuid,
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
  v_committed integer;
  v_active integer;
  v_res uuid;
begin
  if p_user_id is null then raise exception 'user required'; end if;

  insert into ai_usage (user_id, feature, period_key, count)
  values (p_user_id, p_feature, p_period_key, 0)
  on conflict (user_id, feature, period_key) do nothing;

  -- Row lock = per-student/feature/period serialisation point (same order as every other path).
  select count into v_committed from ai_usage
   where user_id = p_user_id and feature = p_feature and period_key = p_period_key
   for update;

  select count(*) into v_active from ai_usage_reservations
   where user_id = p_user_id and feature = p_feature and period_key = p_period_key
     and status = 'reserved' and expires_at > now();

  if v_committed + v_active >= p_max then
    return jsonb_build_object('allowed', false, 'used', v_committed + v_active, 'committed', v_committed);
  end if;

  insert into ai_usage_reservations (user_id, feature, period_key)
  values (p_user_id, p_feature, p_period_key)
  returning id into v_res;

  return jsonb_build_object('allowed', true, 'used', v_committed + v_active + 1,
                            'committed', v_committed, 'reservation_id', v_res);
end;
$$;

-- ── 2. reserve (run-aware: Mock Exam = one slot for many calls) ─────────────
create or replace function public.srv_reserve_usage_run(
  p_user_id uuid,
  p_feature text,
  p_period_key text,
  p_max integer,
  p_run_id text,
  p_max_calls integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_committed integer;
  v_active integer;
  v_res uuid;
  r ai_usage_reservations%rowtype;
begin
  if p_user_id is null then raise exception 'user required'; end if;
  if p_run_id is not null and char_length(p_run_id) not between 8 and 64 then
    raise exception 'bad run id';
  end if;

  insert into ai_usage (user_id, feature, period_key, count)
  values (p_user_id, p_feature, p_period_key, 0)
  on conflict (user_id, feature, period_key) do nothing;

  select count into v_committed from ai_usage
   where user_id = p_user_id and feature = p_feature and period_key = p_period_key
   for update;

  select count(*) into v_active from ai_usage_reservations
   where user_id = p_user_id and feature = p_feature and period_key = p_period_key
     and status = 'reserved' and expires_at > now();

  if p_run_id is not null then
    select * into r from ai_usage_reservations
     where user_id = p_user_id and feature = p_feature and period_key = p_period_key
       and run_id = p_run_id and status in ('reserved', 'committed')
       and (
         (status = 'committed' and created_at > now() - interval '90 minutes') or
         (status = 'reserved'  and expires_at > now())
       )
     order by created_at desc
     limit 1
     for update;

    if found then
      if r.status = 'reserved' then
        return jsonb_build_object('allowed', false, 'reason', 'run_in_flight',
                                  'used', v_committed + v_active, 'committed', v_committed);
      end if;
      if r.calls >= greatest(p_max_calls, 1) then
        return jsonb_build_object('allowed', false, 'reason', 'run_calls_exceeded',
                                  'used', v_committed + v_active, 'committed', v_committed);
      end if;
      update ai_usage_reservations set calls = calls + 1 where id = r.id;
      return jsonb_build_object('allowed', true, 'reused', true,
                                'used', v_committed + v_active, 'committed', v_committed,
                                'reservation_id', r.id);
    end if;
  end if;

  if v_committed + v_active >= p_max then
    return jsonb_build_object('allowed', false, 'reason', 'limit_reached',
                              'used', v_committed + v_active, 'committed', v_committed);
  end if;

  insert into ai_usage_reservations (user_id, feature, period_key, run_id, calls)
  values (p_user_id, p_feature, p_period_key, p_run_id, 1)
  returning id into v_res;

  return jsonb_build_object('allowed', true, 'reused', false,
                            'used', v_committed + v_active + 1,
                            'committed', v_committed, 'reservation_id', v_res);
end;
$$;

-- ── 3. commit ───────────────────────────────────────────────────────────────
create or replace function public.srv_commit_usage(p_user_id uuid, p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r ai_usage_reservations%rowtype;
  v_committed integer;
  v_total bigint;
begin
  if p_user_id is null then raise exception 'user required'; end if;

  select * into r from ai_usage_reservations
   where id = p_reservation_id and user_id = p_user_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if r.status = 'reserved' then
    update ai_usage set count = count + 1, updated_at = now()
     where user_id = p_user_id and feature = r.feature and period_key = r.period_key;
    update ai_usage_reservations set status = 'committed' where id = r.id;
  end if;

  select count into v_committed from ai_usage
   where user_id = p_user_id and feature = r.feature and period_key = r.period_key;
  select coalesce(sum(count), 0) into v_total from ai_usage
   where user_id = p_user_id and feature = r.feature;

  return jsonb_build_object('ok', true, 'committed', v_committed, 'total', v_total);
end;
$$;

-- ── 4. release ──────────────────────────────────────────────────────────────
create or replace function public.srv_release_usage(p_user_id uuid, p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is null then raise exception 'user required'; end if;
  update ai_usage_reservations set status = 'released'
   where id = p_reservation_id and user_id = p_user_id and status = 'reserved';
  return jsonb_build_object('ok', true);
end;
$$;

-- ── 5. Privileges: the srv_* functions are service_role ONLY ────────────────
revoke all on function public.srv_reserve_usage(uuid, text, text, integer)                      from public, anon, authenticated;
revoke all on function public.srv_reserve_usage_run(uuid, text, text, integer, text, integer)   from public, anon, authenticated;
revoke all on function public.srv_commit_usage(uuid, uuid)                                      from public, anon, authenticated;
revoke all on function public.srv_release_usage(uuid, uuid)                                     from public, anon, authenticated;
grant execute on function public.srv_reserve_usage(uuid, text, text, integer)                    to service_role;
grant execute on function public.srv_reserve_usage_run(uuid, text, text, integer, text, integer) to service_role;
grant execute on function public.srv_commit_usage(uuid, uuid)                                    to service_role;
grant execute on function public.srv_release_usage(uuid, uuid)                                   to service_role;

-- ═════════════════════════ PART B — closes the bypass ═════════════════════════
-- (Everything above only ADDS server-only functions and changes nothing for the currently deployed API code.
--  Run from here only once the matching API code is live, or run the whole file in one go — see README.)
-- ── 6. Close the client-callable versions (the bypass) ──────────────────────
do $$
begin
  if to_regprocedure('public.reserve_usage(text,text,integer)') is not null then
    revoke all on function public.reserve_usage(text,text,integer) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.reserve_usage_run(text,text,integer,text,integer)') is not null then
    revoke all on function public.reserve_usage_run(text,text,integer,text,integer) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.commit_usage(uuid)') is not null then
    revoke all on function public.commit_usage(uuid) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.release_usage(uuid)') is not null then
    revoke all on function public.release_usage(uuid) from public, anon, authenticated;
  end if;
end $$;

-- ── 7. Self-check: abort the whole migration if any client role can still write usage ──
do $$
declare
  f text;
  r text;
  bad text := '';
begin
  foreach f in array array[
    'public.reserve_usage(text,text,integer)',
    'public.reserve_usage_run(text,text,integer,text,integer)',
    'public.commit_usage(uuid)',
    'public.release_usage(uuid)',
    'public.check_and_increment_usage(text,text,integer)',
    'public.srv_reserve_usage(uuid,text,text,integer)',
    'public.srv_reserve_usage_run(uuid,text,text,integer,text,integer)',
    'public.srv_commit_usage(uuid,uuid)',
    'public.srv_release_usage(uuid,uuid)'
  ] loop
    if to_regprocedure(f) is null then continue; end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then bad := bad || format(' %s can execute %s;', r, f); end if;
    end loop;
  end loop;
  if bad <> '' then raise exception 'schema 14 self-check failed:%', bad; end if;

  if not has_function_privilege('service_role', 'public.srv_reserve_usage_run(uuid,text,text,integer,text,integer)', 'EXECUTE') then
    raise exception 'schema 14 self-check failed: service_role cannot execute srv_reserve_usage_run';
  end if;
end $$;

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- READ-ONLY CHECK you can run any time in the Supabase SQL editor (changes nothing).
-- Every row of the first query must show can_execute = false for anon AND authenticated:
--
--   select p.proname, r.role,
--          has_function_privilege(r.role, p.oid, 'EXECUTE') as can_execute
--     from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
--    cross join (values ('anon'), ('authenticated')) as r(role)
--    where p.proname in ('reserve_usage','reserve_usage_run','commit_usage','release_usage',
--                        'check_and_increment_usage','srv_reserve_usage','srv_reserve_usage_run',
--                        'srv_commit_usage','srv_release_usage')
--    order by p.proname, r.role;
-- ═══════════════════════════════════════════════════════════════════════════
