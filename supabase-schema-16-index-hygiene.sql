-- StudyMate AI — schema 16: missing indexes (filename: supabase-schema-16-index-hygiene.sql)
-- PURPOSE  Add the only two missing user_id-leading indexes (needed for fast per-student reads and for fast
--          ON DELETE CASCADE when an account is deleted). Changes no data, no grants, no policies.
-- DEPENDS  Schemas 05 (past_paper_analyses) and 07 (payments). Each index is skipped if its table is absent.
-- SAFE     Yes: additive, idempotent, tiny tables (brief lock only).
begin;

do $$
begin
  if to_regclass('public.past_paper_analyses') is not null then
    create index if not exists past_paper_analyses_user_created_idx
      on public.past_paper_analyses (user_id, created_at desc);
  end if;
  if to_regclass('public.payments') is not null then
    create index if not exists payments_user_idx on public.payments (user_id);
  end if;
end $$;

do $$
begin
  if to_regclass('public.past_paper_analyses') is not null
     and not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.past_paper_analyses_user_created_idx') and i.indisvalid) then
    raise exception 'self-check failed: past_paper_analyses index missing or invalid';
  end if;
  if to_regclass('public.payments') is not null
     and not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.payments_user_idx') and i.indisvalid) then
    raise exception 'self-check failed: payments index missing or invalid';
  end if;
  raise notice 'schema 16 self-check passed';
end $$;

commit;
