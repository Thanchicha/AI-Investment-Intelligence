# Portfolio Thai News Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Thai-first news reader that summarizes publisher-page facts for only the companies in each user's portfolio, with transparent RSS fallback and neutral watch points.

**Architecture:** A side-effect-free shared module validates public article URLs, extracts readable factual sentences from bounded HTML, ranks evidence, and produces structured summary inputs. The existing secured Edge ingestion pipeline fetches publisher pages transiently, translates only selected evidence through the free cached MyMemory path, and stores derived summaries plus short evidence—not full articles. The SPA loads normalized company links and applies one shared portfolio filter to dashboard counts, cards, radar, and the internal `#news/<id>` reader.

**Tech Stack:** Vanilla JavaScript SPA, Node.js built-in test runner, Supabase Postgres/RLS, Supabase Edge Functions/Deno, Yahoo Finance RSS, MyMemory free translation API.

**Spec:** `docs/superpowers/specs/2026-09-06-portfolio-thai-news-reader-design.md`

## Global Constraints

- Dashboard and related-news page show only articles linked through `news_company_links` to the signed-in user's holdings.
- Empty holdings return zero news and never fall back to a global feed.
- Supported tickers remain exactly `GOOGL`, `MSFT`, `AAPL`, `META`, `TSLA`, `NVDA`, and `AMZN`.
- Users choose holdings; the application never auto-adds companies.
- No paid API is introduced.
- Full publisher article bodies and source HTML are never stored.
- Persist at most three source-evidence fragments, each at most 200 characters.
- Do not bypass paywalls, login walls, CAPTCHAs, robots restrictions, or publisher security controls.
- A factual summary may use only facts present in extracted publisher text or the RSS title/excerpt.
- The primary UI uses neutral “สิ่งที่น่าสนใจ/ควรติดตาม”, not buy/sell advice, price targets, return predictions, or a directional risk rating.
- Every visible article retains publisher, publication time, original URL, and `article_page` versus `rss_excerpt` scope disclosure.

---

### Task 1: Safe article extraction and neutral summary rules

**Files:**
- Create: `supabase/functions/_shared/article-content.js`
- Create: `tests/article-content.test.mjs`

**Interfaces:**
- Consumes: `extractKeyNumbers(text)` and `SUPPORTED_COMPANIES` from `news-rules.js`.
- Produces: `isSafePublicArticleUrl(rawUrl)`, `extractArticleText(html)`, `selectSourceEvidence({ title, text, companies, maxFragments })`, and `buildArticleSummaryInput({ title, rssExcerpt, html, companies })`.
- `buildArticleSummaryInput` returns `{ contentScope, contentStatus, evidence, entities, keyNumbers, uncertaintyCode }` with evidence fragments capped to three and 200 characters.

- [ ] **Step 1: Write failing executable tests**

Create fixtures inline in `tests/article-content.test.mjs` and assert:

```js
assert.equal(isSafePublicArticleUrl("http://127.0.0.1/admin"), false);
assert.equal(isSafePublicArticleUrl("http://169.254.169.254/latest/meta-data"), false);
assert.equal(isSafePublicArticleUrl("https://news.example.com/story"), true);

const jsonLd = `<script type="application/ld+json">${JSON.stringify({
  "@type": "NewsArticle",
  articleBody: "Microsoft reported revenue of $10 billion. Management expects the launch in October 2026."
})}</script>`;
assert.match(extractArticleText(jsonLd).text, /\$10 billion/);

const summary = buildArticleSummaryInput({
  title: "Microsoft reports quarterly results",
  rssExcerpt: "Short RSS text.", html: jsonLd,
  companies: SUPPORTED_COMPANIES
});
assert.equal(summary.contentScope, "article_page");
assert.ok(summary.evidence.length <= 3);
assert.ok(summary.evidence.every(row => row.text.length <= 200));
```

Also cover semantic `<article>`, paragraph fallback, boilerplate removal, insufficient/paywall HTML falling back to RSS, no invented entities/numbers, neutral watch-point candidates, malformed URLs, localhost names, private IPv4/IPv6 literals, and unsafe redirect targets.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/article-content.test.mjs`

Expected: FAIL because `article-content.js` does not exist.

- [ ] **Step 3: Implement the pure module**

Use deterministic parsing only. Prefer JSON-LD `articleBody`, then `<article>`, then cleaned paragraphs. Decode common entities, strip tags/boilerplate, require at least two meaningful paragraphs and 240 cleaned characters, rank sentences by headline terms, company aliases, numbers/dates, event verbs, and position, and return RSS fallback metadata when insufficient.

URL safety must accept only HTTP(S), reject credentials, localhost-like names, and private/loopback/link-local/reserved IP literals. Export a redirect-safe validator so every redirect target receives the same check.

- [ ] **Step 4: Run focused and full suites**

Run: `node --test tests/article-content.test.mjs` then `npm test`.

Expected: all tests pass with zero failures.

- [ ] **Step 5: Record task report**

Write `.superpowers/sdd/2026-09-06-portfolio-thai-news-reader/task-1-report.md` with RED/GREEN evidence, touched files, self-review, and concerns. Do not deploy or initialize Git.

---

### Task 2: Article-summary persistence schema

**Files:**
- Create: `supabase/migrations/202609060001_article_summary_content.sql`
- Create: `tests/article-summary-schema.test.mjs`

**Interfaces:**
- Produces exact `stock_news` columns: `content_scope`, `content_status`, `content_fetched_at`, `source_evidence`, `watch_points_th`, and `summary_method`.
- Updates `upsert_stock_news_preserving_translations(jsonb)` so prior successful article-page summaries survive later RSS fallbacks or fetch failures.

- [ ] **Step 1: Write the schema contract test**

Assert all six columns, allowed-value checks, JSON defaults, evidence array-length validation, and RPC preservation clauses exist. Assert read access remains authenticated-only through existing table RLS.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/article-summary-schema.test.mjs`.

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Write the migration**

Add idempotent columns and constraints. Extend the article RPC input record and conflict update. Use SQL conditions so an incoming `rss_fallback`, `blocked`, or `invalid` result cannot replace stored `article_page` evidence/summary fields, while a new successful `article_page` result can refresh them. Keep RPC execution restricted to `service_role`.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/article-summary-schema.test.mjs` then `npm test`.

Expected: zero failures.

- [ ] **Step 5: Controller push after independent review**

Run: `npx supabase db push --linked --include-all --yes`, then `npx supabase migration list --linked`. Confirm `202609060001` exists locally and remotely.

---

### Task 3: Publisher-page ingestion with transparent RSS fallback

**Files:**
- Modify: `supabase/functions/_shared/news-ingestion.js`
- Modify: `supabase/functions/ingest-news/index.ts` only if adapter configuration is required
- Create: `tests/article-ingestion.test.mjs`

**Interfaces:**
- Consumes: Task 1 extraction functions and Task 2 article RPC fields.
- Produces per-run detail fields `{ articlePagesExtracted, rssFallbacks, blockedPages, invalidPages, translationAttempts }` alongside existing feed/article/link counts.

- [ ] **Step 1: Add failing behavioral tests with injected dependencies**

Simulate: extractable JSON-LD page; semantic article page; publisher 403; timeout; oversized response; redirect to private IP; non-HTML response; translation failure; cached article-page summary; and one failed publisher among successful articles.

Assert the publisher page is fetched only after RSS URL validation; redirects are followed manually and revalidated; a blocked page becomes a per-article RSS fallback; no full body/HTML enters article upsert payload; translated evidence alone builds Thai summary fields; and a cached successful article summary is preserved.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/article-ingestion.test.mjs`.

Expected: tests fail because publisher fetching and extraction metadata are not integrated.

- [ ] **Step 3: Implement bounded publisher processing**

Add injected `fetchArticlePage`. Use manual redirects with a small maximum, validate every URL, require HTML content type, read at most the configured byte ceiling, retain the abort deadline through body consumption, and process a bounded number of new pages with bounded concurrency. Treat access blocks and extraction failures as RSS fallbacks, not whole-run failures.

Translate selected evidence with the existing MyMemory budget/cache. Build `what_happened_th`, two-to-five `key_points_th`, `watch_points_th`, entity/number fields, and visible uncertainty. Never call the directional `analyzeRisk` path for the stored reader summary.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/article-ingestion.test.mjs` then `npm test`.

Expected: zero failures.

- [ ] **Step 5: Controller deploy and live verification after review**

Deploy `ingest-news` with JWT verification kept enabled. Invoke once through the existing Vault secret. Verify all seven feed entries, nonzero article/link saves, extraction/fallback counts, and no persisted full article body.

---

### Task 4: Authoritative portfolio-only news filtering

**Files:**
- Modify: `supabase/functions/_shared/news-rules.js`
- Modify: `app-v2.js`
- Create: `tests/portfolio-news-filter.test.mjs`

**Interfaces:**
- Produces `articlesForHoldings(news, links, holdingIds)` and `relatedHeldCompanies(articleId, links, holdingIds, companies)` as pure exported helpers.
- SPA state adds `newsLinks`; Supabase load selects link fields needed by both helpers.

- [ ] **Step 1: Write failing pure behavior tests**

Cover: unrelated articles hidden; empty holdings return `[]`; multi-held-company article appears once; legacy `stock_news.company_id` alone does not make an article visible; newest-first order remains; related chips include only held companies.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/portfolio-news-filter.test.mjs`.

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement shared helpers and SPA data load**

Load `news_company_links(news_id,company_id,discovery_tickers,explicit_mention,title_mention,relevance_score,matched_aliases)`. Change the app script to a module if needed and expose existing HTML handlers through `window`. Derive dashboard visible articles once and use that same collection for article count, cards, related-company chips, and radar counts.

Dashboard and `#news` both show portfolio-only articles. Empty portfolio and no-matching-news states use the exact copy from the spec. Do not use alias text matching or `stock_news.company_id` as visibility fallbacks.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/portfolio-news-filter.test.mjs` then `npm test`.

Expected: zero failures.

- [ ] **Step 5: Browser verification after review**

Verify one held ticker shows only linked stories; a non-held ticker story is absent from Dashboard, count, radar, and `#news`; empty holdings show no global articles; console has zero errors.

---

### Task 5: Thai summary cards and internal reader

**Files:**
- Modify: `app-v2.js`
- Modify: `styles.css`
- Create: `tests/news-reader-ui.test.mjs`

**Interfaces:**
- Produces `articleRouteId(route)` and `articleReadingModel(article, articleLinks, holdingIds, companies)`.
- Route is `#news/<article-id>` and refuses articles that are not linked to a holding.

- [ ] **Step 1: Write failing model tests**

Assert route parsing, unauthorized/unrelated not-found behavior, section order, publisher metadata, scope label, original URL, evidence fragment limits, neutral watch-point wording, English-title/RSS transparency fields, and absence of directional risk/action labels.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/news-reader-ui.test.mjs`.

Expected: FAIL because route/model helpers are absent.

- [ ] **Step 3: Implement cards and reader UI**

Render card/reader sections in this order: translated title and metadata; “เกิดอะไรขึ้น”; key points; numbers/entities; held-company chips; “สิ่งที่น่าสนใจ/ควรติดตาม”; scope/limitations; original-source button; collapsible English title/RSS excerpt. Remove dominant increase/decrease risk badges and investment-action copy from the primary feed.

Make card titles route internally. Render “ไม่พบข่าวนี้” for missing or unrelated IDs with a button back to `#news`. Keep semantic headings, keyboard-accessible controls, and existing responsive visual language.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/news-reader-ui.test.mjs` then `npm test`.

Expected: zero failures.

- [ ] **Step 5: Browser verification after review**

Open a portfolio-linked card, confirm the internal URL and factual-first order, test original-source link target without submitting data, test fake/unrelated IDs, mobile width, and zero console errors.

---

### Task 6: Final verification and documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents supported tickers, portfolio-only visibility, publisher extraction/fallback, non-storage of full articles, free translation limitations, 30-minute schedule, security controls, tests, and deployment prerequisites.

- [ ] **Step 1: Run the complete suite**

Run: `npm test`.

Expected: zero failures, skips, cancellations, and test warnings.

- [ ] **Step 2: Verify Supabase state**

Run migration and function listings. Confirm local/remote versions match and `ingest-news` is `ACTIVE` with JWT verification enabled.

- [ ] **Step 3: Verify a fresh live ingestion**

Invoke through Vault without exposing credentials. Record actual seven-feed, article, link, extraction, fallback, and blocked counts. Query representative rows to confirm evidence caps and absence of full bodies.

- [ ] **Step 4: Verify browser behavior**

Check Dashboard, `#news`, internal reader, empty portfolio, unrelated article exclusion, source-scope notices, original-source links, mobile layout, and console errors.

- [ ] **Step 5: Update README and rerun tests**

Document actual behavior and limitations, then run `npm test` again with zero failures.

- [ ] **Step 6: Independent whole-feature review**

Review spec compliance, factual-grounding/copyright boundary, SSRF controls, portfolio privacy/visibility, failure behavior, and test quality. Resolve all Critical/Important findings before completion.

If Git remains unavailable, keep complete task reports and review packages instead of initializing a repository or claiming commits.
