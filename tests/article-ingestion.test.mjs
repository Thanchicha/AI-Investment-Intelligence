import test from "node:test";
import assert from "node:assert/strict";
import { createIngestionHandler } from "../supabase/functions/_shared/news-ingestion.js";
import { SUPPORTED_COMPANIES } from "../supabase/functions/_shared/news-rules.js";

const SECRET = "article-ingestion-secret";
const NOW = new Date("2026-09-06T12:00:00.000Z");

function request() {
  return new Request("http://localhost/ingest-news", {
    method: "POST",
    headers: { "x-ingest-secret": SECRET },
  });
}

function rssItem({ title, url, summary = "RSS excerpt", guid = url }) {
  return `<item><title><![CDATA[${title}]]></title><link>${url}</link><guid>${guid}</guid><description><![CDATA[${summary}]]></description><pubDate>Sun, 06 Sep 2026 10:00:00 GMT</pubDate><source>Example Publisher</source></item>`;
}

function rss(items = []) {
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items.map(rssItem).join("")}</channel></rss>`;
}

function companies() {
  return SUPPORTED_COMPANIES.map((company, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ticker: company.ticker,
  }));
}

function fakeDatabase(overrides = {}) {
  const calls = { articleRows: [], finalized: [] };
  let identifier = 1;
  return {
    calls,
    database: {
      async startRun() { return 41; },
      async findCompanies() { return companies(); },
      async findCachedArticles() { return []; },
      async upsertArticles(rows) {
        calls.articleRows.push(...rows);
        return rows.map((row) => ({ id: `news-${identifier++}`, external_id: row.external_id }));
      },
      async mergeLinks(rows) { return rows.length; },
      async finalizeRun(_id, values) { calls.finalized.push(values); },
      ...overrides,
    },
  };
}

function handlerFor({ database, fetchImpl, fetchArticlePage, ...settings }) {
  return createIngestionHandler({
    createDatabase: () => database,
    fetchImpl,
    fetchArticlePage,
    getSecret: () => SECRET,
    now: () => new Date(NOW),
    logger: { error() {} },
    feedTimeoutMs: 30,
    articlePageTimeoutMs: 30,
    translationTimeoutMs: 30,
    translationConcurrency: 2,
    translationBudget: 20,
    ...settings,
  });
}

function longArticle(company = "Google") {
  return `<article><p>${company} reported revenue of $10 billion in the latest quarter. The company confirmed the figures in a public filing and described the current operating performance in detail.</p><p>Management said the new cloud service launches in October 2026. The publisher reported the schedule as a confirmed company announcement without offering an investment recommendation.</p></article>`;
}

test("stores an extracted publisher-page summary without persisting the article HTML", async () => {
  const { database, calls } = fakeDatabase();
  const sourceUrl = "https://publisher.example.com/google-results";
  const pageRequests = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.mymemory")) {
      const text = new URL(value).searchParams.get("q");
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: `ไทย: ${text}` } }));
    }
    const ticker = new URL(value).searchParams.get("s");
    return new Response(rss(ticker === "GOOGL" ? [{
      title: "Google reports cloud results",
      url: sourceUrl,
      summary: "Google published a short RSS excerpt.",
    }] : []), { headers: { "Content-Type": "application/xml" } });
  };
  const fetchArticlePage = async (url, options) => {
    pageRequests.push({ url: String(url), options });
    return new Response(longArticle(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  };

  const response = await handlerFor({ database, fetchImpl, fetchArticlePage })(request());
  const payload = await response.json();
  const row = calls.articleRows[0];

  assert.equal(response.status, 200);
  assert.equal(pageRequests.length, 1);
  assert.equal(pageRequests[0].url, sourceUrl);
  assert.equal(pageRequests[0].options.redirect, "manual");
  assert.equal(row.content_scope, "article_page");
  assert.equal(row.content_status, "extracted");
  assert.ok(row.source_evidence.length > 0 && row.source_evidence.length <= 3);
  assert.ok(row.source_evidence.every((fragment) => fragment.text.length <= 200));
  assert.equal(JSON.stringify(row).includes("<article>"), false);
  assert.equal(JSON.stringify(row).includes("public filing and described"), false);
  assert.match(row.what_happened_th, /^ไทย:/);
  assert.equal(payload.articlePagesExtracted, 1);
  assert.ok(payload.translationAttempts >= 2);
  assert.equal(calls.finalized.at(-1).detail.articlePagesExtracted, 1);
});

test("uses RSS fallback per article for blocked, invalid redirect, and non-HTML publisher pages", async () => {
  const { database, calls } = fakeDatabase();
  const urls = {
    blocked: "https://publisher.example.com/blocked",
    redirect: "https://publisher.example.com/redirect",
    document: "https://publisher.example.com/document.pdf",
  };
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.mymemory")) {
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: "คำแปล RSS" } }));
    }
    const ticker = new URL(value).searchParams.get("s");
    return new Response(rss(ticker === "GOOGL" ? Object.values(urls).map((url, index) => ({
      title: `Google update ${index + 1}`,
      url,
      summary: "Google published an RSS excerpt for readers.",
    })) : []), { headers: { "Content-Type": "application/xml" } });
  };
  const fetchArticlePage = async (url) => {
    if (String(url) === urls.blocked) return new Response("Access denied", { status: 403 });
    if (String(url) === urls.redirect) return new Response("", { status: 302, headers: { Location: "http://127.0.0.1/private" } });
    return new Response("%PDF-1.7", { headers: { "Content-Type": "application/pdf" } });
  };

  const response = await handlerFor({ database, fetchImpl, fetchArticlePage })(request());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(new Set(calls.articleRows.map((row) => row.content_status)), new Set(["blocked", "invalid"]));
  assert.ok(calls.articleRows.every((row) => row.content_scope === "rss_excerpt"));
  assert.ok(calls.articleRows.every((row) => row.source_evidence.length <= 3));
  assert.equal(payload.blockedPages, 1);
  assert.equal(payload.invalidPages, 2);
  assert.equal(payload.rssFallbacks, 3);
});

test("validates publisher URLs before fetching and falls back when a page times out or exceeds its byte limit", async () => {
  const { database, calls } = fakeDatabase();
  const safeTimeoutUrl = "https://publisher.example.com/timeout";
  const safeLargeUrl = "https://publisher.example.com/large";
  const privateUrl = "http://127.0.0.1/private";
  const pageRequests = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.mymemory")) throw new Error("translation unavailable");
    const ticker = new URL(value).searchParams.get("s");
    return new Response(rss(ticker === "GOOGL" ? [safeTimeoutUrl, safeLargeUrl, privateUrl].map((url, index) => ({
      title: `Google fallback ${index + 1}`,
      url,
      summary: "Google published a short RSS excerpt.",
    })) : []), { headers: { "Content-Type": "application/xml" } });
  };
  const fetchArticlePage = (url, options) => {
    pageRequests.push(String(url));
    if (String(url) === safeTimeoutUrl) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
      });
    }
    return Promise.resolve(new Response(longArticle(), {
      headers: { "Content-Type": "text/html", "Content-Length": "10000" },
    }));
  };

  const response = await handlerFor({
    database,
    fetchImpl,
    fetchArticlePage,
    articlePageTimeoutMs: 10,
    articlePageMaxBytes: 100,
  })(request());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(pageRequests, [safeTimeoutUrl, safeLargeUrl]);
  assert.ok(calls.articleRows.every((row) => row.content_scope === "rss_excerpt"));
  assert.ok(calls.articleRows.every((row) => row.content_status === "rss_fallback" || row.content_status === "invalid"));
  assert.equal(payload.rssFallbacks, 3);
  assert.equal(payload.invalidPages, 1);
});

test("does not refetch a cached extracted article and writes a fallback-shaped update that preserves it in the RPC", async () => {
  const sourceUrl = "https://publisher.example.com/cached";
  const cached = {
    id: "news-cached",
    external_id: "cached-external-id",
    source_url: sourceUrl,
    title_th: "ชื่อเดิม",
    summary_th: "สรุปเดิม",
    translated_at: "2026-09-05T00:00:00.000Z",
    translation_provider: "MyMemory",
    content_scope: "article_page",
    content_status: "extracted",
  };
  const { database, calls } = fakeDatabase({ async findCachedArticles() { return [cached]; } });
  let pageFetches = 0;
  const fetchImpl = async (url) => {
    const ticker = new URL(String(url)).searchParams.get("s");
    return new Response(rss(ticker === "GOOGL" ? [{ title: "Google cached update", url: sourceUrl }] : []), {
      headers: { "Content-Type": "application/xml" },
    });
  };
  const fetchArticlePage = async () => { pageFetches += 1; throw new Error("must not fetch cached article"); };

  const response = await handlerFor({ database, fetchImpl, fetchArticlePage })(request());
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(pageFetches, 0);
  assert.equal(calls.articleRows[0].external_id, cached.external_id);
  assert.equal(calls.articleRows[0].content_scope, "rss_excerpt");
  assert.equal(calls.articleRows[0].content_status, "rss_fallback");
  assert.equal(payload.rssFallbacks, 1);
});
