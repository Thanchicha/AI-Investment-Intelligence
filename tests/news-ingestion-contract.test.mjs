import test from "node:test";
import assert from "node:assert/strict";
import {
  createIngestionHandler,
  createSupabaseNewsRepository,
} from "../supabase/functions/_shared/news-ingestion.js";
import { SUPPORTED_COMPANIES } from "../supabase/functions/_shared/news-rules.js";

const SECRET = "test-ingestion-secret";
const NOW = new Date("2026-09-05T12:00:00.000Z");

function request(secret = SECRET) {
  return new Request("http://localhost/ingest-news", {
    method: "POST",
    headers: secret === null ? {} : { "x-ingest-secret": secret },
  });
}

function xmlItem({ title, url, summary = "RSS excerpt", published = "Fri, 05 Sep 2026 10:00:00 GMT", source = "Example Publisher", guid = url }) {
  return `<item><title><![CDATA[${title}]]></title><link>${url}</link><guid>${guid}</guid><description><![CDATA[${summary}]]></description><pubDate>${published}</pubDate><source>${source}</source></item>`;
}

function rss(items = []) {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Yahoo Finance</title>${items.map(xmlItem).join("")}</channel></rss>`;
}

function response(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "application/xml" } });
}

function companies() {
  return SUPPORTED_COMPANIES.map((company, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ticker: company.ticker,
  }));
}

function fakeDatabase(overrides = {}) {
  const calls = { candidates: [], articleRows: [], linkRows: [], finalized: [] };
  let nextId = 1;
  const database = {
    async startRun() { return 91; },
    async findCompanies() { return companies(); },
    async findCachedArticles(candidates) { calls.candidates.push(candidates); return []; },
    async upsertArticles(rows) {
      calls.articleRows.push(...rows);
      return rows.map((row) => ({
        id: `10000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
        external_id: row.external_id,
      }));
    },
    async mergeLinks(rows) { calls.linkRows.push(...rows); return rows.length; },
    async finalizeRun(id, values) { calls.finalized.push({ id, values }); },
    ...overrides,
  };
  return { database, calls };
}

function handlerFor({ database, fetchImpl, createDatabase, ...settings }) {
  return createIngestionHandler({
    createDatabase: createDatabase ?? (() => database),
    fetchImpl,
    getSecret: () => SECRET,
    now: () => new Date(NOW),
    logger: { error() {} },
    feedTimeoutMs: 25,
    translationTimeoutMs: 25,
    translationConcurrency: 2,
    translationBudget: 20,
    ...settings,
  });
}

test("rejects callers without the ingestion secret before creating a service-role database", async () => {
  let databaseCreations = 0;
  const handler = handlerFor({
    createDatabase: () => { databaseCreations += 1; },
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  const missing = await handler(request(null));
  const wrong = await handler(request("public-anon-token"));
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(databaseCreations, 0);
});

test("deduplicates normalized URLs, preserves cached translations, and merges multi-company discovery evidence", async () => {
  const sharedUrl = "https://example.com/story?a=1";
  const googlUrl = `${sharedUrl}&utm_source=googl`;
  const msftUrl = `${sharedUrl}&.tsrc=rss`;
  const title = "Microsoft and Google expand AI partnership";
  const summary = "Azure will use Google Cloud systems.";
  const cached = {
    id: "20000000-0000-4000-8000-000000000001",
    external_id: "legacy-external-id",
    source_url: googlUrl,
    title_th: "ชื่อเดิม",
    summary_th: "สรุปเดิม",
    translated_at: "2026-09-04T00:00:00.000Z",
    translation_provider: "MyMemory",
  };
  const { database, calls } = fakeDatabase({
    async findCachedArticles(candidates) { calls.candidates.push(candidates); return [cached]; },
  });
  const feedRequests = [];
  const translationRequests = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.mymemory")) {
      translationRequests.push(value);
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: "ใหม่" } }));
    }
    feedRequests.push(value);
    const ticker = new URL(value).searchParams.get("s");
    if (ticker === "TSLA") throw new Error("feed unavailable");
    if (ticker === "GOOGL") return response(rss([{ title, summary, url: googlUrl, guid: "legacy-guid" }]));
    if (ticker === "MSFT") return response(rss([{ title, summary, url: msftUrl, guid: "other-guid" }]));
    return response(rss());
  };
  const result = await handlerFor({ database, fetchImpl })(request());
  const payload = await result.json();
  assert.equal(result.status, 200);
  assert.equal(payload.status, "partial");
  assert.equal(payload.feeds.length, 7);
  assert.deepEqual(payload.feeds.map((feed) => feed.ticker), SUPPORTED_COMPANIES.map((company) => company.ticker));
  assert.match(payload.feeds.find((feed) => feed.ticker === "TSLA").error, /feed unavailable/);
  assert.equal(feedRequests.length, 7);
  assert.equal(translationRequests.length, 0);
  assert.equal(calls.articleRows.length, 1);
  assert.equal(calls.articleRows[0].external_id, cached.external_id);
  assert.equal(calls.articleRows[0].source_url, sharedUrl);
  assert.equal(calls.articleRows[0].title_th, cached.title_th);
  assert.equal(calls.articleRows[0].summary_th, cached.summary_th);
  assert.equal(calls.articleRows[0].translated_at, cached.translated_at);
  assert.equal(calls.articleRows[0].source_scope, "rss_excerpt");
  assert.deepEqual(new Set(calls.linkRows.map((row) => row.company_id)), new Set(companies().slice(0, 2).map((row) => row.id)));
  assert.ok(calls.linkRows.every((row) => row.discovery_tickers.includes("GOOGL") && row.discovery_tickers.includes("MSFT")));
  assert.equal(calls.finalized.at(-1).values.status, "partial");
});

test("turns a stalled feed into a rejected feed without blocking fulfilled feeds", async () => {
  const { database } = fakeDatabase();
  const fetchImpl = (url, options = {}) => {
    const ticker = new URL(String(url)).searchParams.get("s");
    if (ticker !== "AAPL") return Promise.resolve(response(rss()));
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError")), { once: true });
    });
  };
  const started = Date.now();
  const result = await handlerFor({ database, fetchImpl, feedTimeoutMs: 10 })(request());
  const payload = await result.json();
  assert.equal(payload.status, "partial");
  assert.match(payload.feeds.find((feed) => feed.ticker === "AAPL").error, /timed out/i);
  assert.ok(Date.now() - started < 500);
});

test("keeps the feed deadline active while the RSS response body is being read", async () => {
  const { database } = fakeDatabase();
  const fetchImpl = async (url) => {
    const ticker = new URL(String(url)).searchParams.get("s");
    if (ticker !== "AAPL") return response(rss());
    return {
      ok: true,
      status: 200,
      text: () => new Promise((resolve) => setTimeout(() => resolve(rss()), 80)),
    };
  };
  const started = Date.now();
  const result = await handlerFor({ database, fetchImpl, feedTimeoutMs: 10 })(request());
  const payload = await result.json();
  assert.equal(payload.status, "partial");
  assert.match(payload.feeds.find((feed) => feed.ticker === "AAPL").error, /timed out/i);
  assert.ok(Date.now() - started < 60);
});

test("keeps the translation deadline active while the MyMemory JSON body is being read", async () => {
  const { database, calls } = fakeDatabase();
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.mymemory")) {
      return {
        ok: true,
        status: 200,
        json: () => new Promise((resolve) => setTimeout(() => resolve({
          responseStatus: 200,
          responseData: { translatedText: "late translation" },
        }), 80)),
      };
    }
    const ticker = new URL(value).searchParams.get("s");
    return ticker === "GOOGL"
      ? response(rss([{ title: "Google update", url: "https://example.com/google-body-timeout", summary: "" }]))
      : response(rss());
  };
  const started = Date.now();
  const result = await handlerFor({
    database,
    fetchImpl,
    translationTimeoutMs: 10,
    translationBudget: 1,
  })(request());
  const payload = await result.json();
  assert.equal(payload.status, "success");
  assert.equal(calls.articleRows[0].title_th, null);
  assert.ok(Date.now() - started < 60);
});

test("caps translation work and never exceeds configured translation concurrency", async () => {
  const { database, calls } = fakeDatabase();
  let active = 0;
  let maxActive = 0;
  let translations = 0;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.mymemory")) {
      translations += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: "แปล" } }));
    }
    const ticker = new URL(value).searchParams.get("s");
    return response(rss([
      { title: `${ticker} story one`, url: `https://example.com/${ticker}/1`, summary: "First excerpt" },
      { title: `${ticker} story two`, url: `https://example.com/${ticker}/2`, summary: "Second excerpt" },
    ]));
  };
  const result = await handlerFor({ database, fetchImpl, translationBudget: 5, translationConcurrency: 2 })(request());
  const payload = await result.json();
  assert.equal(payload.status, "success");
  assert.equal(calls.articleRows.length, 14);
  assert.equal(translations, 5);
  assert.ok(maxActive <= 2);
});

test("records failed when every feed rejects", async () => {
  const { database, calls } = fakeDatabase();
  const result = await handlerFor({ database, fetchImpl: async () => { throw new Error("Yahoo unavailable"); } })(request());
  const payload = await result.json();
  assert.equal(result.status, 502);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, "failed");
  assert.equal(payload.feeds.length, 7);
  assert.equal(calls.articleRows.length, 0);
  assert.equal(calls.linkRows.length, 0);
  assert.equal(calls.finalized.at(-1).values.status, "failed");
});

test("rejects malformed 200 responses while accepting valid empty RSS channels", async () => {
  const { database } = fakeDatabase();
  const fetchImpl = async (url) => {
    const ticker = new URL(String(url)).searchParams.get("s");
    return ticker === "META" ? response("<html>proxy error</html>") : response(rss());
  };
  const result = await handlerFor({ database, fetchImpl })(request());
  const payload = await result.json();
  assert.equal(payload.status, "partial");
  assert.match(payload.feeds.find((feed) => feed.ticker === "META").error, /invalid rss/i);
  assert.equal(payload.feeds.find((feed) => feed.ticker === "AMZN").found, 0);
});

test("blocks overlapping runs before external requests", async () => {
  const { database } = fakeDatabase({ async startRun() { return null; } });
  let fetches = 0;
  const result = await handlerFor({ database, fetchImpl: async () => { fetches += 1; return response(rss()); } })(request());
  const payload = await result.json();
  assert.equal(result.status, 409);
  assert.equal(payload.processingError, "News ingestion is already running");
  assert.equal(fetches, 0);
});

test("returns a structured safe failure when database construction throws", async () => {
  const handler = handlerFor({
    createDatabase: () => { throw new Error("SUPABASE_SERVICE_ROLE_KEY=secret-value"); },
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  const result = await handler(request());
  const text = await result.text();
  const payload = JSON.parse(text);
  assert.equal(result.status, 500);
  assert.equal(payload.status, "failed");
  assert.equal(payload.processingError, "Could not start news ingestion run");
  assert.equal(text.includes("secret-value"), false);
});

test("returns a safe processing error and records a failed run after persistence errors", async () => {
  const { database, calls } = fakeDatabase({ async upsertArticles() { throw new Error("database password leaked-internal-detail"); } });
  const fetchImpl = async (url) => {
    const ticker = new URL(String(url)).searchParams.get("s");
    return ticker === "GOOGL"
      ? response(rss([{ title: "Google update", url: "https://example.com/google" }]))
      : response(rss());
  };
  const result = await handlerFor({ database, fetchImpl, translationBudget: 0 })(request());
  const text = await result.text();
  const payload = JSON.parse(text);
  assert.equal(result.status, 500);
  assert.equal(payload.status, "failed");
  assert.equal(payload.processingError, "News ingestion processing failed");
  assert.equal(text.includes("password"), false);
  assert.equal(payload.feeds.find((feed) => feed.ticker === "GOOGL").saved, 0);
  assert.equal(calls.finalized.at(-1).values.detail.feeds.find((feed) => feed.ticker === "GOOGL").saved, 0);
  assert.equal(calls.finalized.at(-1).values.status, "failed");
});

test("reports sync-run finalization failure and attempts a failed-status fallback", async () => {
  let finalizeAttempts = 0;
  const { database } = fakeDatabase({
    async finalizeRun() { finalizeAttempts += 1; throw new Error("finalize unavailable"); },
  });
  const result = await handlerFor({ database, fetchImpl: async () => response(rss()) })(request());
  const payload = await result.json();
  assert.equal(result.status, 500);
  assert.equal(payload.status, "failed");
  assert.equal(payload.processingError, "Could not finalize news ingestion run");
  assert.equal(payload.finalizationRecorded, false);
  assert.equal(finalizeAttempts, 2);
});

test("Supabase repository bounds candidate queries and delegates writes to atomic RPCs", async () => {
  const inCalls = [];
  const rpcCalls = [];
  const client = {
    from(table) {
      assert.equal(table, "stock_news");
      return { select() { return { async in(column, values) { inCalls.push({ column, values }); return { data: [], error: null }; } }; } };
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      if (name === "start_news_sync_run") return { data: 123, error: null };
      return { data: [], error: null };
    },
  };
  const repository = createSupabaseNewsRepository(client, { candidateBatchSize: 3 });
  await repository.findCachedArticles({
    externalIds: ["1", "2", "3", "4", "5", "6", "7"],
    sourceUrls: ["a", "b", "c", "d"],
  });
  await repository.upsertArticles([{ external_id: "1" }]);
  await repository.mergeLinks([{ news_id: "n", company_id: "c" }]);
  assert.ok(inCalls.length > 2);
  assert.ok(inCalls.every((call) => call.values.length <= 3));
  assert.deepEqual(new Set(inCalls.map((call) => call.column)), new Set(["external_id", "source_url"]));
  assert.deepEqual(rpcCalls.slice(-2).map((call) => call.name), [
    "upsert_stock_news_preserving_translations",
    "merge_news_company_links",
  ]);
});

test("Supabase repository surfaces a rejected sync-run finalization", async () => {
  const client = {
    from(table) {
      assert.equal(table, "news_sync_runs");
      return {
        update() {
          return {
            async eq() {
              return { data: null, error: { message: "write denied" } };
            },
          };
        },
      };
    },
  };
  const repository = createSupabaseNewsRepository(client);
  await assert.rejects(
    repository.finalizeRun(91, { status: "success" }),
    /Finalizing news sync run failed/
  );
});
