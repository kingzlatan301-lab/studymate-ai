-- Schema 19 -- shared Classroom Notes page cache (server-written, server-read).
-- ADDITIVE ONLY. Rollback: drop table public.cn_shared_pages;
-- One validated, server-generated page per (board, subject, topic, format, language). The first valid page is served to every student,
-- so a cache hit costs no AI call and no student quota. RLS is ON with NO client policies: browsers can neither read nor write this
-- table; only the Vercel API (service role) does. To withdraw a bad page: update public.cn_shared_pages set status='hidden' where cache_key='...';
create table if not exists public.cn_shared_pages (
  cache_key  text primary key check (char_length(cache_key) <= 400),
  board_code text not null check (char_length(board_code) <= 40),
  subject    text not null check (char_length(subject) <= 120),
  topic      text not null check (char_length(topic) <= 160),
  format     text not null check (format in ('notes','glance','examples','practice')),
  lang       text not null default 'en' check (lang ~ '^[a-z]{2}$'),
  content    text not null check (char_length(content) between 80 and 30000),
  tier       text not null check (tier in ('free','premium')),
  status     text not null default 'published' check (status in ('published','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cn_shared_pages_subject_idx on public.cn_shared_pages (board_code, subject, lang, status);
alter table public.cn_shared_pages enable row level security;
revoke all on public.cn_shared_pages from anon, authenticated;
grant select, insert, update on public.cn_shared_pages to service_role;
