import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../supabase/migrations/202609050001_seven_company_news.sql",
  import.meta.url
));
const migration = readFileSync(migrationPath, "utf8");

test("upserts Tesla with its approved identity and limits active companies to seven", () => {
  assert.match(migration, /\('TSLA',\s*'0001318605',\s*'Tesla, Inc\.',\s*'Consumer · Electric vehicles and energy',\s*true\)/);
  assert.match(migration, /set active = ticker in \('GOOGL', 'MSFT', 'AAPL', 'META', 'TSLA', 'NVDA', 'AMZN'\)/);
});

test("adds factual Thai-summary columns to stock news idempotently", () => {
  for (const column of [
    /add column if not exists what_happened_th text/,
    /add column if not exists entities_th jsonb not null default '\[\]'::jsonb/,
    /add column if not exists key_points_th jsonb not null default '\[\]'::jsonb/,
    /add column if not exists key_numbers jsonb not null default '\[\]'::jsonb/,
    /add column if not exists uncertainties_th text/,
    /add column if not exists source_scope text not null default 'rss_excerpt'/,
    /add column if not exists summary_version text/
  ]) {
    assert.match(migration, column);
  }
});

test("defines normalized news-company links with cascading foreign keys and a unique pair", () => {
  assert.match(migration, /create table if not exists public\.news_company_links/);
  assert.match(migration, /news_id uuid not null references public\.stock_news\(id\) on delete cascade/);
  assert.match(migration, /company_id uuid not null references public\.companies\(id\) on delete cascade/);
  assert.match(migration, /unique \(news_id, company_id\)/);
  assert.match(migration, /discovery_tickers jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /explicit_mention boolean not null default false/);
  assert.match(migration, /title_mention boolean not null default false/);
  assert.match(migration, /relevance_score integer not null default 0 check \(relevance_score between 0 and 100\)/);
  assert.match(migration, /matched_aliases jsonb not null default '\[\]'::jsonb/);
  assert.match(migration, /created_at timestamptz not null default now\(\)/);
  assert.match(migration, /updated_at timestamptz not null default now\(\)/);
});

test("indexes company relevance and grants authenticated read access through RLS", () => {
  assert.match(migration, /create index if not exists news_company_links_company_relevance_idx\s+on public\.news_company_links \(company_id, relevance_score desc\)/);
  assert.match(migration, /alter table public\.news_company_links enable row level security/);
  assert.match(migration, /revoke all on public\.news_company_links from anon, authenticated/);
  assert.match(migration, /grant select on public\.news_company_links to authenticated/);
  assert.match(migration, /create policy "authenticated users read news company links"\s+on public\.news_company_links for select to authenticated using \(true\)/);
});

test("backfills existing stock-news company relationships as GOOGL without duplicates", () => {
  assert.match(migration, /insert into public\.news_company_links \(news_id, company_id, discovery_tickers\)/);
  assert.match(migration, /jsonb_build_array\('GOOGL'\)/);
  assert.match(migration, /where c\.ticker = 'GOOGL'/);
  assert.match(migration, /on conflict \(news_id, company_id\) do nothing/);
});
