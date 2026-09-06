import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../supabase/migrations/202609050002_news_ingestion_hardening.sql",
  import.meta.url
));
const migration = readFileSync(migrationPath, "utf8");

test("serializes run claims and rejects overlaps while expiring stale runs", () => {
  assert.match(migration, /create unique index[^;]+where status = 'running'/is);
  assert.match(migration, /create or replace function public\.start_news_sync_run/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /started_at < p_stale_before/);
  assert.match(migration, /if exists[\s\S]+status = 'running'[\s\S]+return null/);
});

test("preserves stored translations when an article upsert supplies null", () => {
  assert.match(migration, /create or replace function public\.upsert_stock_news_preserving_translations/);
  assert.match(migration, /title_th = coalesce\(excluded\.title_th, stock_news\.title_th\)/);
  assert.match(migration, /summary_th = coalesce\(excluded\.summary_th, stock_news\.summary_th\)/);
  assert.match(migration, /translated_at = coalesce\(stock_news\.translated_at, excluded\.translated_at\)/);
  assert.match(migration, /translation_provider = coalesce\(stock_news\.translation_provider, excluded\.translation_provider\)/);
});

test("merges link evidence atomically inside the conflict update", () => {
  assert.match(migration, /create or replace function public\.merge_news_company_links/);
  assert.match(migration, /on conflict \(news_id, company_id\) do update/);
  assert.match(migration, /explicit_mention = news_company_links\.explicit_mention or excluded\.explicit_mention/);
  assert.match(migration, /title_mention = news_company_links\.title_mention or excluded\.title_mention/);
  assert.match(migration, /relevance_score = greatest\(news_company_links\.relevance_score, excluded\.relevance_score\)/);
  assert.match(migration, /jsonb_array_elements_text\(news_company_links\.discovery_tickers \|\| excluded\.discovery_tickers\)/);
  assert.match(migration, /jsonb_array_elements_text\(news_company_links\.matched_aliases \|\| excluded\.matched_aliases\)/);
});

test("restricts hardening RPCs to the service role and schedules with a Vault ingestion secret", () => {
  for (const name of ["start_news_sync_run", "upsert_stock_news_preserving_translations", "merge_news_company_links"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]+to service_role`));
  }
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /name = 'news_ingest_secret'/);
  assert.match(migration, /'x-ingest-secret'/i);
});
