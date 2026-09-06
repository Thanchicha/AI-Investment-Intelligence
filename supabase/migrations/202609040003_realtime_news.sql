create table public.stock_news (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  external_id text not null unique,
  title text not null,
  summary text,
  source_name text not null,
  source_url text not null,
  published_at timestamptz not null,
  category text not null default 'company',
  fetched_at timestamptz not null default now(),
  unique (source_url)
);

create index stock_news_company_published_idx
  on public.stock_news (company_id, published_at desc);

alter table public.stock_news enable row level security;
revoke all on public.stock_news from anon, authenticated;
grant select on public.stock_news to authenticated;

create policy "authenticated users read stock news"
  on public.stock_news for select to authenticated using (true);

create table public.news_sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'partial', 'failed')),
  articles_found integer not null default 0,
  articles_saved integer not null default 0,
  detail jsonb not null default '{}'::jsonb
);

alter table public.news_sync_runs enable row level security;
revoke all on public.news_sync_runs from anon, authenticated;
grant select on public.news_sync_runs to authenticated;

create policy "authenticated users read news sync status"
  on public.news_sync_runs for select to authenticated using (true);
