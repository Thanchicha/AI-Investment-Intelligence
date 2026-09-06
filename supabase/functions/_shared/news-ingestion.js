import {
  SUPPORTED_COMPANIES,
  normalizeArticleUrl,
  matchCompanies,
  buildFactualSummary,
} from "./news-rules.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const DEFAULT_FEED_TIMEOUT_MS = 8_000;
const DEFAULT_TRANSLATION_TIMEOUT_MS = 6_000;
const DEFAULT_TRANSLATION_CONCURRENCY = 6;
const DEFAULT_TRANSLATION_BUDGET = 80;
const DEFAULT_CANDIDATE_BATCH_SIZE = 100;
const STALE_RUN_AFTER_MS = 15 * 60 * 1_000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function safeMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 200) || "Unknown error";
}

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let mismatch = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

async function fetchWithDeadline(fetchImpl, url, options, timeoutMs, label, consumeResponse) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => fetchImpl(url, { ...options, signal: controller.signal }))
        .then(consumeResponse),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function decodeXml(value = "") {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeXml(match?.[1]?.trim() ?? "");
}

function plainText(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
}

function categoryFor(title) {
  const text = title.toLowerCase();
  if (/earnings|revenue|profit|quarter|forecast|guidance/.test(text)) return "earnings";
  if (/gemini|artificial intelligence|\bai\b|cloud/.test(text)) return "ai_cloud";
  if (/antitrust|lawsuit|regulat|court|fine/.test(text)) return "regulation";
  if (/advertis|youtube|search/.test(text)) return "core_business";
  return "company";
}

async function defaultDigest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function mergeMatch(matchesByTicker, match) {
  const current = matchesByTicker.get(match.ticker);
  if (!current) {
    matchesByTicker.set(match.ticker, { ...match, aliases: [...match.aliases] });
    return;
  }
  current.aliases = [...new Set([...current.aliases, ...match.aliases])];
  current.inTitle ||= match.inTitle;
  current.relevance = Math.max(current.relevance, match.relevance);
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function fetchFeed(ticker, { fetchImpl, feedTimeoutMs, digestImpl }) {
  const feedUrl = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`;
  const { ok, status, xml } = await fetchWithDeadline(fetchImpl, feedUrl, {
    headers: { "User-Agent": "Longview investment education news reader" },
  }, feedTimeoutMs, `${ticker} feed`, async response => ({
    ok: response.ok,
    status: response.status,
    xml: response.ok ? await response.text() : "",
  }));
  if (!ok) throw new Error(`${ticker} feed returned ${status}`);
  if (!/<rss\b[\s\S]*?<channel\b[\s\S]*?<\/channel>[\s\S]*?<\/rss>/i.test(xml)) {
    throw new Error(`${ticker} feed returned invalid RSS`);
  }

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(match => match[1]).slice(0, 50);
  const articles = [];
  for (const item of items) {
    const title = tag(item, "title");
    const rawSourceUrl = tag(item, "link");
    const published = new Date(tag(item, "pubDate"));
    if (!title || !rawSourceUrl || Number.isNaN(published.getTime())) continue;
    const sourceUrl = normalizeArticleUrl(rawSourceUrl);
    const guid = tag(item, "guid");
    const externalId = await digestImpl(sourceUrl);
    const legacyExternalId = await digestImpl(guid || rawSourceUrl);
    const summary = plainText(tag(item, "description"));
    const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    articles.push({
      discoveryTicker: ticker,
      externalId,
      legacyExternalId,
      title,
      summary,
      sourceName: decodeXml(sourceMatch?.[1]?.trim() ?? "Yahoo Finance"),
      sourceUrl,
      rawSourceUrl,
      publishedAt: published.toISOString(),
      matches: matchCompanies(title, summary, SUPPORTED_COMPANIES),
    });
  }
  return { ticker, found: items.length, articles };
}

async function translateThai(value, { fetchImpl, translationTimeoutMs }) {
  if (!value.trim()) return null;
  const text = value.slice(0, 450);
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en%7Cth`;
  try {
    const { ok, payload } = await fetchWithDeadline(fetchImpl, url, {
      headers: { "User-Agent": "Longview investment education app" },
    }, translationTimeoutMs, "Translation request", async response => ({
      ok: response.ok,
      payload: response.ok ? await response.json() : null,
    }));
    if (!ok) return null;
    return payload?.responseStatus === 200 && payload?.responseData?.translatedText
      ? String(payload.responseData.translatedText) : null;
  } catch {
    return null;
  }
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function throwDatabaseError(error, operation) {
  if (error) throw new Error(`${operation} failed: ${error.message ?? "database error"}`);
}

export function createSupabaseNewsRepository(client, options = {}) {
  const candidateBatchSize = options.candidateBatchSize ?? DEFAULT_CANDIDATE_BATCH_SIZE;
  return {
    async startRun(staleBefore) {
      const { data, error } = await client.rpc("start_news_sync_run", { p_stale_before: staleBefore });
      throwDatabaseError(error, "Starting news sync run");
      return data ?? null;
    },

    async findCompanies(tickers) {
      const { data, error } = await client.from("companies").select("id,ticker").in("ticker", tickers);
      throwDatabaseError(error, "Loading companies");
      return data ?? [];
    },

    async findCachedArticles(candidates) {
      const rowsById = new Map();
      const select = "id,external_id,source_url,title_th,summary_th,translated_at,translation_provider";
      for (const batch of chunks([...new Set(candidates.externalIds)], candidateBatchSize)) {
        const { data, error } = await client.from("stock_news").select(select).in("external_id", batch);
        throwDatabaseError(error, "Loading cached articles by id");
        for (const row of data ?? []) rowsById.set(row.id, row);
      }
      for (const batch of chunks([...new Set(candidates.sourceUrls)], candidateBatchSize)) {
        const { data, error } = await client.from("stock_news").select(select).in("source_url", batch);
        throwDatabaseError(error, "Loading cached articles by URL");
        for (const row of data ?? []) rowsById.set(row.id, row);
      }
      return [...rowsById.values()];
    },

    async upsertArticles(rows) {
      const { data, error } = await client.rpc("upsert_stock_news_preserving_translations", { p_articles: rows });
      throwDatabaseError(error, "Upserting articles");
      return data ?? [];
    },

    async mergeLinks(rows) {
      const { data, error } = await client.rpc("merge_news_company_links", { p_links: rows });
      throwDatabaseError(error, "Merging company links");
      return typeof data === "number" ? data : rows.length;
    },

    async finalizeRun(id, values) {
      const { error } = await client.from("news_sync_runs").update(values).eq("id", id);
      throwDatabaseError(error, "Finalizing news sync run");
    },
  };
}

function basePayload(status, feeds, articlesSaved, linksSaved) {
  return { ok: status !== "failed", status, feeds, articlesSaved, linksSaved };
}

export function createIngestionHandler(options) {
  const {
    createDatabase,
    fetchImpl,
    getSecret,
    now = () => new Date(),
    logger = console,
    digestImpl = defaultDigest,
    feedTimeoutMs = DEFAULT_FEED_TIMEOUT_MS,
    translationTimeoutMs = DEFAULT_TRANSLATION_TIMEOUT_MS,
    translationConcurrency = DEFAULT_TRANSLATION_CONCURRENCY,
    translationBudget = DEFAULT_TRANSLATION_BUDGET,
  } = options;

  return async function handleIngestion(request) {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const expectedSecret = getSecret();
    if (!expectedSecret) return jsonResponse({ processingError: "Ingestion secret is not configured" }, 503);
    if (!secureEqual(request.headers.get("x-ingest-secret"), expectedSecret)) {
      return jsonResponse({ processingError: "Unauthorized" }, 401);
    }

    let database;
    let runId;
    try {
      database = createDatabase();
      const staleBefore = new Date(now().getTime() - STALE_RUN_AFTER_MS).toISOString();
      runId = await database.startRun(staleBefore);
    } catch (error) {
      logger.error("Unable to start news ingestion run", error);
      return jsonResponse({ ...basePayload("failed", [], 0, 0), processingError: "Could not start news ingestion run" }, 500);
    }
    if (runId === null) {
      return jsonResponse({ ...basePayload("failed", [], 0, 0), processingError: "News ingestion is already running" }, 409);
    }

    let feeds = [];
    let articlesSaved = 0;
    let linksSaved = 0;
    try {
      const tickers = SUPPORTED_COMPANIES.map(({ ticker }) => ticker);
      const companyRows = await database.findCompanies(tickers);
      const companyIdByTicker = new Map(companyRows.map(row => [row.ticker, row.id]));
      const missingTickers = tickers.filter(ticker => !companyIdByTicker.has(ticker));
      if (missingTickers.length) throw new Error(`Missing company rows: ${missingTickers.join(", ")}`);

      const settledFeeds = await Promise.allSettled(
        SUPPORTED_COMPANIES.map(({ ticker }) => fetchFeed(ticker, { fetchImpl, feedTimeoutMs, digestImpl }))
      );
      const canonicalArticles = new Map();
      const articleIdsByFeed = new Map();
      for (const result of settledFeeds) {
        if (result.status !== "fulfilled") continue;
        const ids = new Set();
        articleIdsByFeed.set(result.value.ticker, ids);
        for (const article of result.value.articles) {
          ids.add(article.externalId);
          const current = canonicalArticles.get(article.externalId);
          if (current) {
            current.discoveryTickers.add(article.discoveryTicker);
            current.legacyExternalIds.add(article.legacyExternalId);
            current.rawSourceUrls.add(article.rawSourceUrl);
            for (const match of article.matches) mergeMatch(current.matchesByTicker, match);
            continue;
          }
          const matchesByTicker = new Map();
          for (const match of article.matches) mergeMatch(matchesByTicker, match);
          canonicalArticles.set(article.externalId, {
            ...article,
            discoveryTickers: new Set([article.discoveryTicker]),
            legacyExternalIds: new Set([article.legacyExternalId]),
            rawSourceUrls: new Set([article.rawSourceUrl]),
            matchesByTicker,
          });
        }
      }

      feeds = settledFeeds.map((result, index) => {
        const ticker = SUPPORTED_COMPANIES[index].ticker;
        if (result.status === "rejected") {
          return { ticker, found: 0, saved: 0, error: safeMessage(result.reason) };
        }
        return { ticker, found: result.value.found, saved: 0 };
      });

      const canonicalList = [...canonicalArticles.values()];
      const cachedRows = canonicalList.length
        ? await database.findCachedArticles({
          externalIds: canonicalList.flatMap(article => [article.externalId, ...article.legacyExternalIds]),
          sourceUrls: canonicalList.flatMap(article => [article.sourceUrl, ...article.rawSourceUrls]),
        })
        : [];
      const cacheByExternalId = new Map(cachedRows.map(row => [row.external_id, row]));
      const cacheBySourceUrl = new Map(cachedRows.map(row => [row.source_url, row]));
      const cacheByNormalizedUrl = new Map(cachedRows.map(row => [normalizeArticleUrl(row.source_url), row]));
      const prepared = canonicalList.map(article => {
        const cached = cacheByExternalId.get(article.externalId)
          ?? [...article.legacyExternalIds].map(id => cacheByExternalId.get(id)).find(Boolean)
          ?? cacheBySourceUrl.get(article.sourceUrl)
          ?? [...article.rawSourceUrls].map(url => cacheBySourceUrl.get(url)).find(Boolean)
          ?? cacheByNormalizedUrl.get(article.sourceUrl);
        return {
          article,
          cached,
          externalId: cached?.external_id ?? article.externalId,
          titleTh: cached?.title_th ?? null,
          summaryTh: cached?.summary_th ?? null,
        };
      });

      const translationTasks = [];
      for (const entry of prepared) {
        if (!entry.titleTh && entry.article.title && translationTasks.length < translationBudget) {
          translationTasks.push({ entry, field: "titleTh", value: entry.article.title });
        }
        if (!entry.summaryTh && entry.article.summary && translationTasks.length < translationBudget) {
          translationTasks.push({ entry, field: "summaryTh", value: entry.article.summary });
        }
      }
      await mapWithConcurrency(translationTasks, translationConcurrency, async task => {
        task.entry[task.field] = await translateThai(task.value, { fetchImpl, translationTimeoutMs });
      });

      const timestamp = now().toISOString();
      const articleRows = prepared.map(entry => {
        const matches = [...entry.article.matchesByTicker.values()];
        const factualSummary = buildFactualSummary({
          title: entry.article.title,
          summary: entry.article.summary,
          titleTh: entry.titleTh,
          summaryTh: entry.summaryTh,
        }, matches);
        return {
          company_id: companyIdByTicker.get(entry.article.discoveryTicker),
          external_id: entry.externalId,
          title: entry.article.title,
          summary: entry.article.summary,
          title_th: entry.titleTh,
          summary_th: entry.summaryTh,
          translated_at: entry.cached?.translated_at ?? (entry.titleTh || entry.summaryTh ? timestamp : null),
          translation_provider: entry.cached?.translation_provider ?? (entry.titleTh || entry.summaryTh ? "MyMemory" : null),
          source_name: entry.article.sourceName,
          source_url: entry.article.sourceUrl,
          published_at: entry.article.publishedAt,
          category: categoryFor(entry.article.title),
          fetched_at: timestamp,
          what_happened_th: factualSummary.whatHappenedTh,
          entities_th: factualSummary.entitiesTh,
          key_points_th: factualSummary.keyPointsTh,
          key_numbers: factualSummary.keyNumbers,
          uncertainties_th: factualSummary.uncertaintiesTh,
          source_scope: factualSummary.sourceScope,
          summary_version: factualSummary.summaryVersion,
        };
      });
      const savedArticleRows = articleRows.length ? await database.upsertArticles(articleRows) : [];
      articlesSaved = articleRows.length;
      for (const feed of feeds) {
        if (!feed.error) feed.saved = articleIdsByFeed.get(feed.ticker)?.size ?? 0;
      }
      const newsIdByExternalId = new Map(savedArticleRows.map(row => [row.external_id, row.id]));
      const linkRows = [];
      for (const entry of prepared) {
        const newsId = newsIdByExternalId.get(entry.externalId);
        if (!newsId) throw new Error(`Missing saved article id for ${entry.externalId}`);
        const linkedTickers = new Set([...entry.article.discoveryTickers, ...entry.article.matchesByTicker.keys()]);
        for (const ticker of linkedTickers) {
          const match = entry.article.matchesByTicker.get(ticker);
          linkRows.push({
            news_id: newsId,
            company_id: companyIdByTicker.get(ticker),
            discovery_tickers: [...entry.article.discoveryTickers],
            explicit_mention: Boolean(match),
            title_mention: match?.inTitle ?? false,
            relevance_score: Math.min(match?.relevance ?? 0, 100),
            matched_aliases: match?.aliases ?? [],
            updated_at: timestamp,
          });
        }
      }
      linksSaved = linkRows.length ? await database.mergeLinks(linkRows) : 0;

      const failedFeedCount = feeds.filter(feed => feed.error).length;
      const status = failedFeedCount === 0 ? "success"
        : failedFeedCount === feeds.length ? "failed" : "partial";
      const runValues = {
        status,
        finished_at: now().toISOString(),
        articles_found: feeds.reduce((total, feed) => total + feed.found, 0),
        articles_saved: articlesSaved,
        detail: { feeds, articlesSaved, linksSaved, feed: "Yahoo Finance RSS" },
      };
      try {
        await database.finalizeRun(runId, runValues);
      } catch (error) {
        logger.error("Unable to finalize news ingestion run", error);
        let finalizationRecorded = false;
        try {
          await database.finalizeRun(runId, {
            ...runValues,
            status: "failed",
            detail: { ...runValues.detail, processing_error: "finalization_failed" },
          });
          finalizationRecorded = true;
        } catch (fallbackError) {
          logger.error("Unable to record failed finalization", fallbackError);
        }
        return jsonResponse({
          ...basePayload("failed", feeds, articlesSaved, linksSaved),
          processingError: "Could not finalize news ingestion run",
          finalizationRecorded,
        }, 500);
      }
      return jsonResponse(basePayload(status, feeds, articlesSaved, linksSaved), status === "failed" ? 502 : 200);
    } catch (error) {
      logger.error("News ingestion processing failed", error);
      let finalizationRecorded = false;
      try {
        await database.finalizeRun(runId, {
          status: "failed",
          finished_at: now().toISOString(),
          articles_found: feeds.reduce((total, feed) => total + feed.found, 0),
          articles_saved: articlesSaved,
          detail: { feeds, articlesSaved, linksSaved, processing_error: "processing_failed" },
        });
        finalizationRecorded = true;
      } catch (finalizationError) {
        logger.error("Unable to record failed ingestion run", finalizationError);
      }
      return jsonResponse({
        ...basePayload("failed", feeds, articlesSaved, linksSaved),
        processingError: "News ingestion processing failed",
        finalizationRecorded,
      }, 500);
    }
  };
}
