create extension if not exists pgcrypto;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique check (ticker = upper(ticker)),
  cik text not null unique check (length(cik) = 10),
  legal_name text not null,
  sector text,
  active boolean not null default true,
  last_sec_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, company_id)
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_type text not null check (source_type in ('sec_filing')),
  external_id text not null,
  form text not null,
  title text not null,
  original_url text not null,
  filed_at date not null,
  fiscal_year integer,
  fiscal_period text,
  raw_metadata jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  unique (source_type, external_id)
);

create table public.financial_facts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  source_document_id uuid not null references public.source_documents(id) on delete cascade,
  metric text not null check (metric in ('revenue', 'net_income', 'diluted_eps')),
  taxonomy_concept text not null,
  value numeric not null,
  unit text not null,
  period_start date,
  period_end date not null,
  fiscal_year integer,
  fiscal_period text,
  form text not null,
  filed_at date not null,
  accession_number text not null,
  frame text,
  created_at timestamptz not null default now(),
  unique (company_id, metric, period_end, form, accession_number)
);

create index financial_facts_company_metric_idx
  on public.financial_facts (company_id, metric, filed_at desc);
create index source_documents_company_filed_idx
  on public.source_documents (company_id, filed_at desc);

alter table public.companies enable row level security;
alter table public.portfolio_holdings enable row level security;
alter table public.source_documents enable row level security;
alter table public.financial_facts enable row level security;

revoke all on public.companies, public.portfolio_holdings,
  public.source_documents, public.financial_facts from anon, authenticated;
grant select on public.companies, public.source_documents, public.financial_facts to authenticated;
grant select, insert, delete on public.portfolio_holdings to authenticated;

create policy "authenticated users read companies"
  on public.companies for select to authenticated using (true);
create policy "authenticated users read source documents"
  on public.source_documents for select to authenticated using (true);
create policy "authenticated users read financial facts"
  on public.financial_facts for select to authenticated using (true);
create policy "users read own holdings"
  on public.portfolio_holdings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users insert own holdings"
  on public.portfolio_holdings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "users delete own holdings"
  on public.portfolio_holdings for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into public.companies (ticker, cik, legal_name, sector) values
  ('GOOGL', '0001652044', 'Alphabet Inc.', 'Technology · Digital advertising'),
  ('NVDA',  '0001045810', 'NVIDIA Corporation', 'Semiconductors · AI infrastructure'),
  ('MSFT',  '0000789019', 'Microsoft Corporation', 'Technology · Cloud software'),
  ('AAPL',  '0000320193', 'Apple Inc.', 'Technology · Consumer electronics'),
  ('AMZN',  '0001018724', 'Amazon.com, Inc.', 'Consumer · Cloud infrastructure'),
  ('META',  '0001326801', 'Meta Platforms, Inc.', 'Technology · Digital advertising')
on conflict (ticker) do update set
  cik = excluded.cik,
  legal_name = excluded.legal_name,
  sector = excluded.sector,
  updated_at = now();
