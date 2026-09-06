# Seven-Company Thai News Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Longview into a free, seven-company news system with portfolio filtering, structured Thai factual summaries, internal article-reading pages, and clearly separated rule-based risk analysis.

**Architecture:** A shared deterministic JavaScript module owns alias matching, numeric extraction, factual-summary construction, and risk rules so browser behavior and Edge ingestion use the same logic. Supabase stores each article once and joins it to every related company through `news_company_links`; the existing Edge Function polls seven Yahoo Finance RSS feeds independently and records partial failures. The static SPA loads articles plus links, filters the dashboard by holdings, and routes `#news/<uuid>` to a Thai reading view.

**Tech Stack:** Vanilla JavaScript SPA, Node.js built-in test runner, Supabase Postgres/RLS, Supabase Edge Functions/Deno, Yahoo Finance RSS, MyMemory free translation API.

**Spec:** `docs/superpowers/specs/2026-09-05-seven-company-thai-news-design.md`

## Global Constraints

- Supported tickers are exactly `GOOGL`, `MSFT`, `AAPL`, `META`, `TSLA`, `NVDA`, and `AMZN`.
- Users choose holdings themselves; the application never auto-adds all supported companies.
- The system uses no paid API.
- Stored publisher content is limited to RSS title and excerpt; it is never presented as a complete translated article.
- Factual summaries may only use facts present in the RSS title or excerpt.
- Risk analysis remains educational, rule-based, and visually separated from factual content.
- Each article retains its original source URL, publisher/feed attribution, and publication time.

---

### Task 1: Shared deterministic news rules

**Files:**
- Create: `supabase/functions/_shared/news-rules.js`
- Create: `tests/news-rules.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `SUPPORTED_COMPANIES`, `normalizeArticleUrl(url)`, `matchCompanies(title, excerpt, companies)`, `extractKeyNumbers(text)`, `buildFactualSummary(article, matches)`, and `analyzeRisk(article, primaryTicker)`.
- `matchCompanies` returns `{ ticker, aliases, inTitle, relevance }[]`.
- `buildFactualSummary` returns `{ whatHappenedTh, entitiesTh, keyPointsTh, keyNumbers, uncertaintiesTh, sourceScope, summaryVersion }`.
- `analyzeRisk` returns `{ key, labelTh, headlineTh, reasonTh, nextStepTh, evidence }` where `key` is `increase`, `decrease`, or `monitor`.

- [ ] **Step 1: Add the test command and failing tests**

Add `"test": "node --test tests/*.test.mjs"` to `package.json`. Create tests that assert:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_COMPANIES, normalizeArticleUrl, matchCompanies,
  extractKeyNumbers, buildFactualSummary, analyzeRisk
} from "../supabase/functions/_shared/news-rules.js";

test("supports exactly the seven approved tickers", () => {
  assert.deepEqual(SUPPORTED_COMPANIES.map(row => row.ticker),
    ["GOOGL", "MSFT", "AAPL", "META", "TSLA", "NVDA", "AMZN"]);
});

test("matches more than one company and gives title mentions greater relevance", () => {
  const matches = matchCompanies(
    "Microsoft and Nvidia expand AI partnership",
    "Azure will use NVIDIA systems.", SUPPORTED_COMPANIES);
  assert.deepEqual(matches.map(row => row.ticker), ["MSFT", "NVDA"]);
  assert.equal(matches[0].inTitle, true);
  assert.ok(matches[0].relevance >= 80);
});

test("normalizes tracking parameters without changing the article path", () => {
  assert.equal(normalizeArticleUrl("https://example.com/story?a=1&utm_source=rss&.tsrc=rss"),
    "https://example.com/story?a=1");
});

test("extracts only numeric phrases present in source text", () => {
  const values = extractKeyNumbers("Revenue rose 12% to $9.2 billion on September 4, 2026.");
  assert.ok(values.some(row => row.value.includes("12%")));
  assert.ok(values.some(row => row.value.includes("$9.2 billion")));
  assert.ok(values.some(row => row.value.includes("September 4, 2026")));
  assert.equal(values.some(row => row.value.includes("15%")), false);
});

test("short RSS excerpts explicitly report uncertainty", () => {
  const summary = buildFactualSummary({ titleTh: "Google เปิดตัวบริการใหม่", summaryTh: "เริ่มเปิดให้ทดลอง", title: "Google launches service", summary: "A trial begins." }, []);
  assert.match(summary.uncertaintiesTh, /บทคัดย่อ|ข้อมูล.*จำกัด/);
  assert.equal(summary.sourceScope, "rss_excerpt");
});

test("incidental company mention does not produce a directional risk claim", () => {
  const result = analyzeRisk({ title: "Adobe faces new competition risk", summary: "Alphabet was mentioned for comparison." }, "GOOGL");
  assert.equal(result.key, "monitor");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: FAIL because `supabase/functions/_shared/news-rules.js` does not exist.

- [ ] **Step 3: Implement the shared rule module**

Create a side-effect-free ES module. Define the seven companies and aliases; remove `utm_*`, `.tsrc`, `guccounter`, and `guce_referrer` query parameters; score title aliases at 80 plus 5 per extra match and excerpt-only aliases at 50 plus 5 per extra match. Extract currency, percentage, compact-number, and English date phrases from source text. Build Thai output from translated input and fixed transparency messages. Risk direction must require the primary company alias in the title; otherwise return `monitor`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all `news-rules.test.mjs` tests pass with zero failures.

- [ ] **Step 5: Commit the task when Git becomes available**

```powershell
git add package.json tests/news-rules.test.mjs supabase/functions/_shared/news-rules.js
git commit -m "feat: add deterministic news intelligence rules"
```

If the workspace is still not a Git repository, record the skipped commit and continue without initializing Git.

---

### Task 2: Seven-company relational news schema

**Files:**
- Create: `supabase/migrations/202609050001_seven_company_news.sql`
- Create: `tests/news-schema.test.mjs`

**Interfaces:**
- Produces active company row for `TSLA` with CIK `0001318605`.
- Produces `public.news_company_links(news_id, company_id, discovery_tickers, explicit_mention, title_mention, relevance_score, matched_aliases, created_at, updated_at)`.
- Adds structured fields to `public.stock_news` using the exact names in the design spec.

- [ ] **Step 1: Write a failing schema contract test**

Read the migration text and assert it contains: the TSLA ticker and CIK; every structured summary column; a foreign key to `stock_news`; a foreign key to `companies`; a unique `(news_id, company_id)` constraint; RLS enablement; authenticated select grant; and authenticated select policy.

- [ ] **Step 2: Run the schema test and verify RED**

Run: `npm test -- tests/news-schema.test.mjs`

Expected: FAIL because the migration file is absent.

- [ ] **Step 3: Write the migration**

The migration must:

```sql
insert into public.companies (ticker,cik,legal_name,sector,active)
values ('TSLA','0001318605','Tesla, Inc.','Consumer · Electric vehicles and energy',true)
on conflict (ticker) do update set cik=excluded.cik, legal_name=excluded.legal_name,
  sector=excluded.sector, active=true, updated_at=now();

update public.companies set active = ticker in ('GOOGL','MSFT','AAPL','META','TSLA','NVDA','AMZN');

alter table public.stock_news
  add column if not exists what_happened_th text,
  add column if not exists entities_th jsonb not null default '[]'::jsonb,
  add column if not exists key_points_th jsonb not null default '[]'::jsonb,
  add column if not exists key_numbers jsonb not null default '[]'::jsonb,
  add column if not exists uncertainties_th text,
  add column if not exists source_scope text not null default 'rss_excerpt',
  add column if not exists summary_version text;
```

Create the normalized link table, index `(company_id, relevance_score desc)`, RLS policy, and authenticated select grant. Backfill existing GOOGL articles into the link table using their current `company_id`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: schema and news-rules tests pass.

- [ ] **Step 5: Push and verify the migration**

Run: `npx supabase db push --linked --include-all --yes`

Expected: migration `202609050001_seven_company_news.sql` applies successfully. Then run `npx supabase migration list --linked` and confirm local and remote versions match.

- [ ] **Step 6: Commit the task when Git becomes available**

```powershell
git add supabase/migrations/202609050001_seven_company_news.sql tests/news-schema.test.mjs
git commit -m "feat: add seven-company news schema"
```

---

### Task 3: Multi-feed ingestion with partial-failure handling

**Files:**
- Modify: `supabase/functions/ingest-news/index.ts`
- Create: `tests/news-ingestion-contract.test.mjs`

**Interfaces:**
- Consumes: shared rules from `../_shared/news-rules.js`.
- Produces one normalized `stock_news` row per article and one `news_company_links` row per matched/discovery company.
- Response shape: `{ ok, status, feeds: [{ ticker, found, saved, error? }], articlesSaved, linksSaved }`.

- [ ] **Step 1: Write failing ingestion contract tests**

Assert the function imports shared rules, iterates `SUPPORTED_COMPANIES`, creates one Yahoo RSS URL per ticker, uses `Promise.allSettled`, upserts `stock_news`, upserts `news_company_links`, stores structured factual-summary fields, and returns per-feed status.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `npm test -- tests/news-ingestion-contract.test.mjs`

Expected: FAIL because the current function is hard-coded to GOOGL and has no relationship upsert.

- [ ] **Step 3: Refactor ingestion minimally to pass**

Fetch each URL in the form:

```js
`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${ticker}&region=US&lang=en-US`
```

For every article: normalize its URL before hashing, translate only uncached title/excerpt fields, build the structured factual summary, upsert the canonical article, derive all explicit company matches, always include its discovery ticker, and upsert link evidence. Mark the run `success`, `partial`, or `failed` based on feed results. Preserve cached translations and do not delete valid older stories just because they are absent from a later RSS window.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Deploy and invoke one real ingestion**

Run:

```powershell
npx supabase functions deploy ingest-news --project-ref pkxcbbolryyszljcedni --agent no --output-format text
```

Invoke the JWT-protected endpoint once using the project's public legacy anon JWT without printing credentials. Expected response: seven feed entries, at least one successful feed, `status` equal to `success` or `partial`, and nonzero saved links.

- [ ] **Step 6: Commit the task when Git becomes available**

```powershell
git add supabase/functions/ingest-news/index.ts tests/news-ingestion-contract.test.mjs
git commit -m "feat: ingest news for seven companies"
```

---

### Task 4: Portfolio-filtered feed and all-news filters

**Files:**
- Modify: `app-v2.js`
- Modify: `index.html`
- Modify: `styles.css`
- Create: `tests/news-ui-rules.test.mjs`

**Interfaces:**
- Consumes: `state.newsLinks`, holdings, companies, and shared `analyzeRisk`.
- Produces: `articlesForHoldings(news, links, holdingIds)` and `filterArticles(news, links, filters)` as exported pure helpers in the shared rule module.

- [ ] **Step 1: Write failing filter tests**

Cover: dashboard returns only stories linked to holdings; empty holdings return an empty result; all-news ticker filter uses links rather than article primary company; category and risk filters compose; results remain newest-first.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/news-ui-rules.test.mjs`

Expected: FAIL because the filtering helpers and `state.newsLinks` do not exist.

- [ ] **Step 3: Implement data loading and feed rendering**

Load `news_company_links` with `news_id,company_id,discovery_tickers,explicit_mention,title_mention,relevance_score,matched_aliases`. Import shared helpers by changing the app script to `type="module"`; preserve UI-called functions on `window`. Render dashboard cards from portfolio-filtered results and show an actionable empty-portfolio state. Render all-news filter buttons for all seven tickers plus category and risk direction. Card order is factual overview, related companies, then risk analysis.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Browser integration check**

Reload `http://localhost:4175/#dashboard`. Verify a holding sees only linked stories; a non-held ticker story is absent; each card has “เกิดอะไรขึ้น” before “วิเคราะห์ผลกระทบ”; all-news filters update card counts; and browser console has zero errors.

- [ ] **Step 6: Commit the task when Git becomes available**

```powershell
git add app-v2.js index.html styles.css tests/news-ui-rules.test.mjs
git commit -m "feat: filter news by portfolio and company"
```

---

### Task 5: Internal Thai article-reading route

**Files:**
- Modify: `app-v2.js`
- Modify: `styles.css`
- Create: `tests/news-detail-route.test.mjs`

**Interfaces:**
- Produces: `articleRouteId(route)` and `articleReadingModel(article, links, companies)` pure helpers.
- Route: `#news/<article-id>`.

- [ ] **Step 1: Write failing detail-model tests**

Assert a valid route returns the UUID, an invalid route returns `null`, reading sections preserve the required factual-before-analysis ordering, the model includes original URL/title/excerpt, and a missing ID produces a recoverable not-found model.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/news-detail-route.test.mjs`

Expected: FAIL because the helpers and detail route are absent.

- [ ] **Step 3: Implement the route and reading page**

Make each card title link to `#news/<id>`. Render translated title and metadata; “เกิดอะไรขึ้น”; factual bullet points; detected numbers and dates; uncertainty/source-scope notice; original-article button; separately styled risk analysis; and collapsible English title/excerpt. For a missing article, show “ไม่พบข่าวนี้” with a button back to `#news`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Browser integration check**

Open one article from dashboard, verify the URL changes to `#news/<uuid>`, sections appear in the specified order, the publisher URL is preserved, back navigation returns to the feed, a fake UUID renders the not-found state, and console errors remain zero.

- [ ] **Step 6: Commit the task when Git becomes available**

```powershell
git add app-v2.js styles.css tests/news-detail-route.test.mjs
git commit -m "feat: add Thai news reading pages"
```

---

### Task 6: Searchable seven-company stock picker

**Files:**
- Modify: `index.html`
- Modify: `app-v2.js`
- Modify: `styles.css`
- Create: `tests/stock-search.test.mjs`

**Interfaces:**
- Produces: `searchCompanies(companies, heldIds, query)` pure helper.
- Search matches ticker and legal name case-insensitively and excludes held or inactive companies.

- [ ] **Step 1: Write failing stock-search tests**

Assert `tes` finds TSLA/Tesla, `micro` finds MSFT/Microsoft, lowercase `amzn` finds AMZN, held IDs are excluded, inactive companies are excluded, and blank search returns all available supported companies.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/stock-search.test.mjs`

Expected: FAIL because `searchCompanies` does not exist.

- [ ] **Step 3: Implement search UI and helper**

Add an accessible search input above the ticker select. Update select options on `input`; show “ไม่พบบริษัท” when no match exists; disable submit in that state; clear search whenever the dialog opens or closes. Do not auto-add any company.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 5: Browser integration check**

Search each of the seven tickers, add one previously unheld company, verify it appears in the portfolio and news dashboard filter, then remove it through the existing flow only if that record was created specifically for this test. Verify keyboard focus and empty search behavior.

- [ ] **Step 6: Commit the task when Git becomes available**

```powershell
git add index.html app-v2.js styles.css tests/stock-search.test.mjs
git commit -m "feat: add searchable seven-company picker"
```

---

### Task 7: Full verification and documentation

**Files:**
- Modify: `README.md`

**Interfaces:**
- Documents the seven supported companies, RSS excerpt limitation, 30-minute ingestion schedule, structured factual summary, risk-analysis boundary, and local test command.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: zero failures and zero test warnings.

- [ ] **Step 2: Verify Supabase state**

Run: `npx supabase migration list --linked` and `npx supabase functions list --project-ref pkxcbbolryyszljcedni --output json`.

Expected: local/remote migrations match; `ingest-news` is `ACTIVE` with JWT verification enabled.

- [ ] **Step 3: Verify product requirements in browser**

Check dashboard, empty portfolio behavior, portfolio filtering, all-news filters, Thai detail route, original-source link, factual/analysis separation, stock search, mobile-width layout, and console logs. Record exact article and relationship counts from the latest ingestion rather than assuming a fixed count.

- [ ] **Step 4: Update README**

Document setup, data flow, supported tickers, limitations, tests, deploy command, and that the internal Thai page summarizes RSS material rather than reproducing a full publisher article.

- [ ] **Step 5: Re-run complete verification after documentation changes**

Run: `npm test`

Expected: zero failures.

- [ ] **Step 6: Commit the task when Git becomes available**

```powershell
git add README.md
git commit -m "docs: explain seven-company news intelligence"
```

If Git is unavailable, report that all file changes remain uncommitted in the workspace.
