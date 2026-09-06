insert into public.companies (ticker, cik, legal_name, sector, active) values
  ('TSLA', '0001318605', 'Tesla, Inc.', 'Consumer · Electric vehicles and energy', true)
on conflict (ticker) do update set
  cik = excluded.cik,
  legal_name = excluded.legal_name,
  sector = excluded.sector,
  active = excluded.active,
  updated_at = now();

update public.companies
set active = ticker in ('GOOGL', 'MSFT', 'AAPL', 'META', 'TSLA', 'NVDA', 'AMZN');

alter table public.stock_news
  add column if not exists what_happened_th text,
  add column if not exists entities_th jsonb not null default '[]'::jsonb,
  add column if not exists key_points_th jsonb not null default '[]'::jsonb,
  add column if not exists key_numbers jsonb not null default '[]'::jsonb,
  add column if not exists uncertainties_th text,
  add column if not exists source_scope text not null default 'rss_excerpt',
  add column if not exists summary_version text;

create table if not exists public.news_company_links (
  news_id uuid not null references public.stock_news(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  discovery_tickers jsonb not null default '[]'::jsonb,
  explicit_mention boolean not null default false,
  title_mention boolean not null default false,
  relevance_score integer not null default 0 check (relevance_score between 0 and 100),
  matched_aliases jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (news_id, company_id)
);

create index if not exists news_company_links_company_relevance_idx
  on public.news_company_links (company_id, relevance_score desc);

alter table public.news_company_links enable row level security;
revoke all on public.news_company_links from anon, authenticated;
grant select on public.news_company_links to authenticated;

create policy "authenticated users read news company links"
  on public.news_company_links for select to authenticated using (true);

insert into public.news_company_links (news_id, company_id, discovery_tickers)
select sn.id, sn.company_id, jsonb_build_array('GOOGL')
from public.stock_news sn
join public.companies c on c.id = sn.company_id
where c.ticker = 'GOOGL'
on conflict (news_id, company_id) do nothing;
