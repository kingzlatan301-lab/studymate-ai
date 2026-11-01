-- ═══════════════════════════════════════════════════════════════════════════
-- StudyMate AI — AUDIT PROBE (read-only)            filename: audit-probe-readonly.sql
-- ═══════════════════════════════════════════════════════════════════════════
-- PURPOSE   Report what is REALLY in your live database, so we know which schemas
--           (10, 12, 13, 14, 15) are applied before running anything that changes data.
-- CHANGES   NOTHING. Only SELECT statements. No tables, grants, policies or data are touched.
-- DEPENDS   Nothing. Safe on any existing database, any number of times.
-- RUN       Supabase → SQL Editor → New query → paste everything → Run.
--           Then use Results ▸ "Copy" (or Download CSV) and paste it back to me.
-- ═══════════════════════════════════════════════════════════════════════════

select * from (

  -- A. Every table in public, with Row Level Security status
  select 'A. tables' as section, c.relname::text as item,
         case when c.relrowsecurity then 'RLS on' else 'RLS OFF' end as detail
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')

  union all
  -- A2. Tables the app expects that do not exist
  select 'A. tables', t, 'MISSING'
    from unnest(array['profiles','weakness_profiles','saved_questions','answer_feedback','past_paper_analyses',
                      'readiness_snapshots','review_schedule','user_visual_preferences','subscriptions','payments',
                      'payment_intents','profile_country_changes','ai_usage','ai_usage_reservations','youtube_cache',
                      'study_sessions']) as t
   where to_regclass('public.' || t) is null

  union all
  -- B. Table-level privileges held by the three API roles
  select 'B. table grants', g.grantee || ' · ' || g.table_name,
         string_agg(g.privilege_type, ', ' order by g.privilege_type)
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.grantee in ('anon','authenticated','service_role')
   group by g.grantee, g.table_name

  union all
  -- B2. Column-level privileges (profiles, weakness_profiles, answer_feedback, saved_questions use these)
  select 'B2. column grants', p.grantee || ' · ' || p.table_name || ' · ' || p.privilege_type,
         string_agg(p.column_name, ', ' order by p.column_name)
    from information_schema.column_privileges p
   where p.table_schema = 'public' and p.grantee in ('anon','authenticated')
     and p.table_name in ('profiles','weakness_profiles','answer_feedback','saved_questions','study_sessions')
   group by p.grantee, p.table_name, p.privilege_type

  union all
  -- C. Row Level Security policies
  select 'C. policies', pol.tablename || ' · ' || pol.policyname,
         pol.cmd || ' · roles=' || pol.roles::text
    from pg_policies pol
   where pol.schemaname = 'public'

  union all
  -- D. Every function in public (excluding extension-owned) and who may EXECUTE it
  select 'D. functions', p.oid::regprocedure::text,
         'anon=' || has_function_privilege('anon', p.oid, 'execute')
         || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'execute')
         || ' service_role=' || has_function_privilege('service_role', p.oid, 'execute')
         || case when p.prosecdef then ' · SECURITY DEFINER' else ' · invoker' end
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')

  union all
  -- E. Triggers on public tables
  select 'E. triggers', c.relname || ' · ' || t.tgname, 'enabled=' || t.tgenabled
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where c.relnamespace = 'public'::regnamespace and not t.tgisinternal

  union all
  -- F. Indexes on public tables
  select 'F. indexes', i.tablename || ' · ' || i.indexname, left(i.indexdef, 140)
    from pg_indexes i
   where i.schemaname = 'public'

  union all
  -- G. INFERRED schema state (based on objects that each schema creates)
  select 'G. inferred state', s.item,
         case when s.applied then 'looks APPLIED' else 'NOT applied' end
    from (values
      ('03 youtube_cache',                to_regclass('public.youtube_cache') is not null),
      ('04 subscriptions',                to_regclass('public.subscriptions') is not null),
      ('05 past_paper_analyses',          to_regclass('public.past_paper_analyses') is not null),
      ('05 ai_usage',                     to_regclass('public.ai_usage') is not null),
      ('07 profiles + reservations',      to_regclass('public.profiles') is not null and to_regclass('public.ai_usage_reservations') is not null),
      ('08 user_visual_preferences',      to_regclass('public.user_visual_preferences') is not null),
      ('09 payment_intents + reserve_usage_run',
         to_regclass('public.payment_intents') is not null and to_regprocedure('public.reserve_usage_run(text,text,integer,text,integer)') is not null),
      ('10 profile_country_changes',      to_regclass('public.profile_country_changes') is not null),
      ('11 answer_feedback',              to_regclass('public.answer_feedback') is not null),
      ('12 anon has no table grant except youtube_cache',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public' and grantee = 'anon' and table_name <> 'youtube_cache')),
      ('12 authenticated has no grant on ai_usage',
         not exists (select 1 from information_schema.role_table_grants
                      where table_schema = 'public' and grantee = 'authenticated' and table_name = 'ai_usage')),
      ('12 youtube_cache open write policies removed',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'youtube_cache' and cmd in ('INSERT','UPDATE'))),
      ('13 provider columns',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments' and column_name = 'provider')),
      ('14 srv_* usage functions exist',
         to_regprocedure('public.srv_reserve_usage(uuid,text,text,integer)') is not null),
      ('14 old reserve_usage NOT callable by authenticated',
         to_regprocedure('public.reserve_usage(text,text,integer)') is null
         or not has_function_privilege('authenticated', 'public.reserve_usage(text,text,integer)', 'execute')),
      ('15 study_sessions table',        to_regclass('public.study_sessions') is not null),
      ('15 saved_questions.note column',
         exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'saved_questions' and column_name = 'note'))
    ) as s(item, applied)

) probe
order by section, item;
