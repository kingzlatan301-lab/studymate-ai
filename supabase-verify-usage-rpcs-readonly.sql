-- StudyMate AI — READ-ONLY verification of the AI-usage reservation functions.
-- Safe to run in the Supabase SQL editor: it only SELECTs from the catalogs. It writes nothing and calls no function.
-- Every row must show ok = true. Any false row names exactly what is wrong.
--
-- It exists because of the 42883 "operator does not exist: integer + text" failure: the live srv_reserve_usage_run had a
-- body that did arithmetic on p_run_id (a text id), which Postgres can only reject at CALL time, so nothing caught it in
-- tests. This checks the deployed definition itself.

with fn as (
  select p.oid, p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         regexp_replace(lower(pg_get_functiondef(p.oid)), '\s+', ' ', 'g') as body,
         p.prosecdef, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('srv_reserve_usage', 'srv_reserve_usage_run', 'srv_commit_usage', 'srv_release_usage')
), checks as (
  -- 1. the four functions exist exactly once, with the argument names/types/order the API sends
  select 'srv_reserve_usage_run signature' as test_name,
         exists (select 1 from fn where proname = 'srv_reserve_usage_run'
                  and args = 'p_user_id uuid, p_feature text, p_period_key text, p_max integer, p_run_id text, p_max_calls integer') as ok,
         coalesce((select string_agg(args, ' | ') from fn where proname = 'srv_reserve_usage_run'), 'MISSING') as detail
  union all
  select 'srv_reserve_usage signature',
         exists (select 1 from fn where proname = 'srv_reserve_usage'
                  and args = 'p_user_id uuid, p_feature text, p_period_key text, p_max integer'),
         coalesce((select string_agg(args, ' | ') from fn where proname = 'srv_reserve_usage'), 'MISSING')
  union all
  select 'srv_commit_usage signature',
         exists (select 1 from fn where proname = 'srv_commit_usage' and args = 'p_user_id uuid, p_reservation_id uuid'),
         coalesce((select string_agg(args, ' | ') from fn where proname = 'srv_commit_usage'), 'MISSING')
  union all
  select 'srv_release_usage signature',
         exists (select 1 from fn where proname = 'srv_release_usage' and args = 'p_user_id uuid, p_reservation_id uuid'),
         coalesce((select string_agg(args, ' | ') from fn where proname = 'srv_release_usage'), 'MISSING')
  union all
  -- 2. no overloaded duplicates (PostgREST cannot choose between them)
  select 'no duplicate overloads', (select count(*) from fn) = 4, (select count(*)::text || ' functions found (expect 4)' from fn)
  union all
  -- 3. the 42883 bug: arithmetic on the text run id / on p_max_calls
  select 'reserve_run: no arithmetic on p_run_id',
         not exists (select 1 from fn where proname = 'srv_reserve_usage_run'
                      and (body ~ 'p_run_id\s*[-+*/]' or body ~ '[-+*/]\s*p_run_id' or body ~ 'p_max_calls\s*\*\s*0')),
         'body must not contain p_max_calls * 0 + p_run_id or any other arithmetic on p_run_id'
  union all
  select 'reserve_run: inserts p_run_id directly',
         exists (select 1 from fn where proname = 'srv_reserve_usage_run'
                  and body like '%insert into ai_usage_reservations (user_id, feature, period_key, run_id, calls) values (p_user_id, p_feature, p_period_key, p_run_id, 1)%'),
         'expected: insert into ai_usage_reservations (user_id, feature, period_key, run_id, calls) values (p_user_id, p_feature, p_period_key, p_run_id, 1)'
  union all
  -- 4. column types the function writes to
  select 'ai_usage_reservations.run_id is text',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_reservations' and column_name = 'run_id' and data_type = 'text'),
         coalesce((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_reservations' and column_name = 'run_id'), 'COLUMN MISSING')
  union all
  select 'ai_usage_reservations.calls is integer',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_reservations' and column_name = 'calls' and data_type = 'integer'),
         coalesce((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'ai_usage_reservations' and column_name = 'calls'), 'COLUMN MISSING')
  union all
  -- 5. security: SECURITY DEFINER with a pinned search_path, executable by service_role ONLY
  select 'security definer + pinned search_path',
         not exists (select 1 from fn where not prosecdef or proconfig is null or not (proconfig::text ilike '%search_path=public%')),
         'all four must be SECURITY DEFINER with set search_path = public'
  union all
  select 'service_role can execute all four',
         not exists (select 1 from fn where not has_function_privilege('service_role', oid, 'EXECUTE')),
         'service_role EXECUTE'
  union all
  select 'students/anon/public cannot execute any',
         not exists (select 1 from fn where has_function_privilege('authenticated', oid, 'EXECUTE')
                                          or has_function_privilege('anon', oid, 'EXECUTE')),
         'a student must never be able to call these directly (supabase-schema-14)'
)
select test_name, ok, detail from checks order by ok, test_name;
