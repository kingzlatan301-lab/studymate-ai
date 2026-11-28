-- StudyMate AI — schema 23: close public RPC access to trigger-only functions
-- Permission-only change. No rows, tables, or trigger definitions are modified.
-- These functions are called by installed database triggers and are not app RPC endpoints.
-- Run after the current app/schema version has been backed up and reviewed.
begin;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.log_profile_country_change() from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.handle_new_user()', 'execute')
     or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') then
    raise exception 'schema 23 verification failed: handle_new_user is still client-callable';
  end if;
  if has_function_privilege('anon', 'public.log_profile_country_change()', 'execute')
     or has_function_privilege('authenticated', 'public.log_profile_country_change()', 'execute') then
    raise exception 'schema 23 verification failed: log_profile_country_change is still client-callable';
  end if;
  if not exists (
    select 1 from pg_trigger
    where not tgisinternal and tgname = 'on_auth_user_created'
      and tgfoid = 'public.handle_new_user()'::regprocedure and tgenabled <> 'D'
  ) then
    raise exception 'schema 23 verification failed: on_auth_user_created trigger is missing or disabled';
  end if;
  if not exists (
    select 1 from pg_trigger
    where not tgisinternal and tgname = 'profiles_country_change_log'
      and tgfoid = 'public.log_profile_country_change()'::regprocedure and tgenabled <> 'D'
  ) then
    raise exception 'schema 23 verification failed: profiles_country_change_log trigger is missing or disabled';
  end if;
end $$;

commit;
