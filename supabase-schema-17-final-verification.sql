-- StudyMate AI — schema 17: FINAL VERIFICATION (read-only)   filename: supabase-schema-17-final-verification.sql
-- PURPOSE  Fails loudly, listing EVERY problem, if the database breaks a security rule. Changes nothing.
-- DEPENDS  Nothing (run last). A failure is information, not damage: it names exactly what is missing.
-- RULES CHECKED  RLS on all 16 tables · anon has no access (except read-only youtube_cache) · students cannot write
--   server-controlled tables · no "write for everyone" policies · usage/payment functions not callable by client roles ·
--   srv_* usage functions exist and are service_role-only · every SECURITY DEFINER function pins search_path ·
--   students cannot rewrite study history or edit more than a saved question's note · service_role can reach every table.
do $$
declare
  fails text[] := '{}'; warns text[] := '{}';
  t text; p text; rel text; r record; n int; checks int := 0;
  all_tables text[] := array['profiles','weakness_profiles','saved_questions','answer_feedback','past_paper_analyses',
    'readiness_snapshots','review_schedule','user_visual_preferences','subscriptions','payments','payment_intents',
    'profile_country_changes','ai_usage','ai_usage_reservations','youtube_cache','study_sessions'];
  server_only text[] := array['subscriptions','payments','payment_intents','profile_country_changes','ai_usage','ai_usage_reservations'];
begin
  foreach t in array all_tables loop
    rel := 'public.' || t;
    if to_regclass(rel) is null then
      fails := array_append(fails, t || ': table is missing');
      continue;
    end if;
    checks := checks + 1;
    if not (select relrowsecurity from pg_class where oid = rel::regclass) then
      fails := array_append(fails, t || ': Row Level Security is OFF');
    end if;
    if t = 'youtube_cache' then
      if has_table_privilege('anon', rel, 'INSERT,UPDATE,DELETE,TRUNCATE') then
        fails := array_append(fails, 'youtube_cache: anon can write (cache poisoning)');
      end if;
    elsif has_table_privilege('anon', rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or has_any_column_privilege('anon', rel, 'SELECT,INSERT,UPDATE,REFERENCES') then
      fails := array_append(fails, t || ': anon has access (schema 12 not applied?)');
    end if;
    if t = any(server_only) or t = 'youtube_cache' then
      if has_table_privilege('authenticated', rel, 'INSERT,UPDATE,DELETE,TRUNCATE')
         or has_any_column_privilege('authenticated', rel, 'INSERT,UPDATE') then
        fails := array_append(fails, t || ': students can write a server-controlled table');
      end if;
    end if;
    if t <> 'review_schedule' then
      foreach p in array array['SELECT','INSERT','UPDATE'] loop
        if not has_table_privilege('service_role', rel, p) then
          fails := array_append(fails, t || ': service_role lacks ' || p || ' (API would fail)');
        end if;
      end loop;
    end if;
  end loop;

  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')
              and (coalesce(qual,'') = 'true' or coalesce(with_check,'') = 'true')
              and roles <> array['service_role']::name[] loop
    fails := array_append(fails, r.tablename || ': policy "' || r.policyname || '" lets anyone write');
  end loop;
  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and cmd <> 'SELECT' and roles <> array['service_role']::name[]
              and (tablename = any(server_only) or tablename = 'youtube_cache') loop
    fails := array_append(fails, r.tablename || ': client write policy "' || r.policyname || '" exists on a server-controlled table');
  end loop;

  select count(distinct proname) into n from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname in ('srv_reserve_usage','srv_reserve_usage_run','srv_commit_usage','srv_release_usage');
  if n <> 4 then
    fails := array_append(fails, format('schema 14 not applied: found %s of 4 srv_* usage functions', n));
  end if;

  for r in select p2.oid, p2.proname, p2.oid::regprocedure::text as sig, p2.prosecdef, p2.proconfig
             from pg_proc p2
            where p2.pronamespace = 'public'::regnamespace
              and not exists (select 1 from pg_depend d where d.objid = p2.oid and d.deptype = 'e') loop
    checks := checks + 1;
    if r.prosecdef and not exists (select 1 from unnest(coalesce(r.proconfig, '{}'::text[])) c where c like 'search_path=%') then
      fails := array_append(fails, r.sig || ': SECURITY DEFINER without a fixed search_path');
    end if;
    if r.proname like 'srv\_%' or r.proname like 'apply\_verified\_payment%'
       or r.proname in ('create_payment_intent','find_user_id_by_email','reserve_usage','reserve_usage_run',
                        'commit_usage','release_usage','check_and_increment_usage') then
      if has_function_privilege('anon', r.oid, 'execute') or has_function_privilege('authenticated', r.oid, 'execute') then
        fails := array_append(fails, r.sig || ': callable by client roles');
      end if;
    end if;
    if (r.proname like 'srv\_%' or r.proname like 'apply\_verified\_payment%')
       and not has_function_privilege('service_role', r.oid, 'execute') then
      fails := array_append(fails, r.sig || ': service_role cannot execute it (API would fail)');
    end if;
  end loop;

  if to_regclass('public.study_sessions') is not null
     and has_table_privilege('authenticated', 'public.study_sessions', 'UPDATE,DELETE') then
    fails := array_append(fails, 'study_sessions: students can rewrite or delete history');
  end if;
  if to_regclass('public.saved_questions') is not null then
    if has_column_privilege('authenticated', 'public.saved_questions', 'question', 'UPDATE')
       or has_column_privilege('authenticated', 'public.saved_questions', 'answer_data', 'UPDATE')
       or has_column_privilege('authenticated', 'public.saved_questions', 'user_id', 'UPDATE') then
      fails := array_append(fails, 'saved_questions: students can edit more than the note column');
    end if;
    if not has_column_privilege('authenticated', 'public.saved_questions', 'note', 'UPDATE') then
      fails := array_append(fails, 'saved_questions: students cannot update their note (schema 15)');
    end if;
  end if;

  for r in select i.indrelid::regclass::text as tbl, count(*) as c
             from pg_index i join pg_class c on c.oid = i.indrelid
            where c.relnamespace = 'public'::regnamespace
            group by i.indrelid, i.indkey::text, coalesce(pg_get_expr(i.indpred, i.indrelid), ''),
                     coalesce(pg_get_expr(i.indexprs, i.indrelid), '')
           having count(*) > 1 loop
    warns := array_append(warns, r.tbl || ' has ' || r.c || ' identical indexes');
  end loop;

  if coalesce(array_length(fails, 1), 0) > 0 then
    raise exception E'schema 17 verification FAILED (% problem(s)):\n- %', array_length(fails, 1), array_to_string(fails, E'\n- ');
  end if;
  if coalesce(array_length(warns, 1), 0) > 0 then
    raise notice 'warnings (not failures): %', array_to_string(warns, '; ');
  end if;
  raise notice 'schema 17 verification PASSED (% objects checked)', checks;
end $$;
