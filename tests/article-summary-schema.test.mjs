import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readMigration = (name) => readFileSync(fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url)), "utf8");
const migration = readMigration("202609060001_article_summary_content.sql");
const newsSchema = readMigration("202609040003_realtime_news.sql");

test("adds article extraction metadata with safe defaults and allowed states", () => {
  for (const column of [
    "content_scope text not null default 'rss_excerpt'",
    "content_status text not null default 'pending'",
    "content_fetched_at timestamptz",
    "source_evidence jsonb not null default '[]'::jsonb",
    "watch_points_th jsonb not null default '[]'::jsonb",
    "summary_method text not null default 'extractive_rules_v1'",
  ]) assert.match(migration, new RegExp(`add column if not exists ${column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));

  assert.match(migration, /content_scope in \('article_page', 'rss_excerpt'\)/i);
  assert.match(migration, /content_status in \('extracted', 'rss_fallback', 'blocked', 'invalid', 'pending'\)/i);
});

test("database constraints keep evidence and watch points as bounded arrays", () => {
  assert.match(migration, /jsonb_typeof\(source_evidence\) = 'array'/i);
  assert.match(migration, /jsonb_array_length\(source_evidence\) <= 3/i);
  assert.match(migration, /jsonb_typeof\(watch_points_th\) = 'array'/i);
});

test("article upsert RPC accepts and writes every new summary field", () => {
  for (const field of [
    "content_scope", "content_status", "content_fetched_at",
    "source_evidence", "watch_points_th", "summary_method",
  ]) {
    assert.match(migration, new RegExp(`\\b${field}\\b`, "i"));
  }
  assert.match(migration, /create or replace function public\.upsert_stock_news_preserving_translations\(p_articles jsonb\)/i);
  assert.match(migration, /on conflict \(external_id\) do update/i);
});

test("a later fallback cannot overwrite an existing extracted article summary", () => {
  assert.match(migration, /stock_news\.content_scope = 'article_page'[\s\S]+stock_news\.content_status = 'extracted'/i);
  assert.match(migration, /excluded\.content_scope = 'article_page'[\s\S]+excluded\.content_status = 'extracted'/i);
  for (const field of [
    "what_happened_th", "entities_th", "key_points_th", "key_numbers",
    "uncertainties_th", "source_evidence", "watch_points_th", "content_scope",
    "content_status", "content_fetched_at", "summary_method",
  ]) {
    assert.match(migration, new RegExp(`${field}\\s*=\\s*case[\\s\\S]+?then stock_news\\.${field}[\\s\\S]+?else excluded\\.${field}[\\s\\S]+?end`, "i"), field);
  }
});

test("the replacement RPC remains service-role only and stock news remains authenticated read-only", () => {
  assert.match(migration, /revoke all on function public\.upsert_stock_news_preserving_translations\(jsonb\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.upsert_stock_news_preserving_translations\(jsonb\) to service_role/i);
  assert.match(newsSchema, /alter table public\.stock_news enable row level security/i);
  assert.match(newsSchema, /grant select on public\.stock_news to authenticated/i);
  assert.match(newsSchema, /create policy "authenticated users read stock news"[\s\S]+on public\.stock_news for select to authenticated using \(true\)/i);
});
