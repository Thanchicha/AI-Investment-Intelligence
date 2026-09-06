import test from "node:test";
import assert from "node:assert/strict";
import {
  articlesForHoldings,
  relatedHeldCompanies,
} from "../supabase/functions/_shared/news-rules.js";

const companies = [
  { id: "googl", ticker: "GOOGL" },
  { id: "msft", ticker: "MSFT" },
  { id: "nvda", ticker: "NVDA" },
];

const news = [
  { id: "old-google", company_id: "googl", published_at: "2026-09-01T10:00:00.000Z" },
  { id: "new-google-microsoft", company_id: "googl", published_at: "2026-09-03T10:00:00.000Z" },
  { id: "nvidia-only", company_id: "nvda", published_at: "2026-09-04T10:00:00.000Z" },
  { id: "legacy-only", company_id: "googl", published_at: "2026-09-05T10:00:00.000Z" },
  { id: "rss-discovery-only", company_id: "nvda", published_at: "2026-09-06T10:00:00.000Z" },
];

const links = [
  { news_id: "old-google", company_id: "googl" },
  { news_id: "new-google-microsoft", company_id: "googl" },
  { news_id: "new-google-microsoft", company_id: "msft" },
  { news_id: "nvidia-only", company_id: "nvda" },
  { news_id: "rss-discovery-only", company_id: "nvda", explicit_mention: false },
];

test("shows only linked articles for held companies in newest-first order", () => {
  const visible = articlesForHoldings(news, links, ["googl", "msft"]);

  assert.deepEqual(visible.map((article) => article.id), ["new-google-microsoft", "old-google"]);
});

test("returns no global news when the portfolio is empty", () => {
  assert.deepEqual(articlesForHoldings(news, links, []), []);
});

test("does not show an article from the legacy stock_news company_id alone", () => {
  const visible = articlesForHoldings(news, links, ["googl"]);

  assert.equal(visible.some((article) => article.id === "legacy-only"), false);
});

test("does not show a discovery-only RSS link without an explicit company mention", () => {
  const visible = articlesForHoldings(news, links, ["nvda"]);

  assert.equal(visible.some((article) => article.id === "rss-discovery-only"), false);
});

test("returns each held related company once and excludes non-held linked companies", () => {
  assert.deepEqual(
    relatedHeldCompanies("new-google-microsoft", links, ["googl"], companies).map((company) => company.ticker),
    ["GOOGL"],
  );
  assert.deepEqual(
    relatedHeldCompanies("new-google-microsoft", links, ["googl", "msft"], companies).map((company) => company.ticker),
    ["GOOGL", "MSFT"],
  );
});
