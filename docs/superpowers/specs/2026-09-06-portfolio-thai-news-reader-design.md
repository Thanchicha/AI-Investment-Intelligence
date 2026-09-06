# Portfolio Thai News Reader — Design Specification

**Date:** 2026-09-06  
**Status:** Awaiting user review  
**Product:** Longview — Investment Intelligence

## 1. Objective

Turn Longview into a Thai-first news reader for long-term investors. A user should open the app and understand the important news affecting companies they personally hold without searching across multiple publisher sites.

The product is primarily a factual news-tracking and comprehension tool. It is not primarily a risk-scoring or trading-advice product.

## 2. Binding product behavior

- Dashboard and the related-news page show only articles linked to at least one company in the signed-in user's portfolio.
- An empty portfolio never falls back to the global news feed. It shows an invitation to add a company.
- Each news card begins with a useful Thai factual summary, not only a translated headline.
- Information order is: what happened, key points, key entities/numbers, things worth watching, information limitations, original source.
- Heavy directional risk analysis is removed from the primary reading flow. Neutral observations use the label “สิ่งที่น่าสนใจ/ควรติดตาม”.
- Every article keeps the publisher name, publication time, original URL, and a transparent indication of whether the summary came from the article page or only the RSS excerpt.
- The application does not present generated content as a complete translation of the publisher's article.
- Supported companies remain exactly GOOGL, MSFT, AAPL, META, TSLA, NVDA, and AMZN.
- Users choose their own holdings; the application never auto-adds companies.
- No paid API is introduced.

## 3. Recommended architecture

Use a hybrid extractive pipeline:

1. Fetch Yahoo Finance RSS independently for each supported ticker.
2. Normalize and deduplicate article URLs as in the current ingestion pipeline.
3. Fetch each original publisher page server-side with strict time, content-type, redirect, and body-size limits.
4. Extract readable article text using deterministic strategies in priority order:
   - structured article data such as JSON-LD `articleBody`;
   - semantic `<article>` content;
   - clean paragraph content from the main page region.
5. Reject navigation, cookie notices, subscription prompts, repeated boilerplate, scripts, styles, and unsafe markup.
6. Rank source sentences using deterministic signals: headline similarity, explicit supported-company mentions, numbers/dates, event verbs, and paragraph position.
7. Translate only the selected factual sentences through the existing free MyMemory path with cache, timeout, concurrency, and per-run limits.
8. Build the structured Thai summary only from extracted source sentences. Never infer an unstated cause, outcome, or financial impact.
9. If source-page extraction fails, is blocked, or returns insufficient text, fall back to the RSS title/excerpt and state that limitation visibly.

The ingestion Edge Function remains responsible for fetching and persistence. The browser only reads authenticated Supabase rows and does not fetch publisher pages directly.

## 4. Content and copyright boundary

- Original full article bodies are processed transiently and are not stored in Supabase.
- Persist only the application's structured Thai summary, extraction metadata, and at most three short supporting source fragments.
- Each supporting fragment is capped at 200 characters and exists to show why a factual point was selected, not to reconstruct the article.
- Do not bypass paywalls, login walls, CAPTCHAs, robots restrictions, or publisher security controls.
- A blocked source is a normal fallback condition, not an ingestion failure for the whole run.
- The UI always links to the publisher's original article and labels the internal page as a summary.

## 5. Data model

Extend `stock_news` with:

- `content_scope text not null default 'rss_excerpt'` — `article_page` or `rss_excerpt`.
- `content_status text not null default 'pending'` — `extracted`, `rss_fallback`, `blocked`, `invalid`, or `pending`.
- `content_fetched_at timestamptz`.
- `source_evidence jsonb not null default '[]'` — up to three short source fragments plus their source kind.
- `watch_points_th jsonb not null default '[]'` — neutral, source-grounded follow-up points.
- `summary_method text not null default 'extractive_rules_v1'`.

Continue using existing fields:

- `what_happened_th`
- `entities_th`
- `key_points_th`
- `key_numbers`
- `uncertainties_th`
- `source_scope`
- `summary_version`

`news_company_links` remains the authoritative article-to-company relationship table used for portfolio filtering. The legacy `stock_news.company_id` may remain for compatibility but must not be used to decide whether a user sees an article.

## 6. Extraction and summarization rules

### Minimum viable article text

- At least two meaningful paragraphs and at least 240 cleaned characters.
- A page with only a headline, navigation text, or subscription message is insufficient and falls back to RSS.

### Factual summary

- `what_happened_th`: one concise Thai overview built from the strongest translated source sentence(s).
- `key_points_th`: two to five non-duplicative factual bullets.
- `entities_th`: only entities explicitly found in source text.
- `key_numbers`: only number/date phrases copied from source text with nearby context.
- `uncertainties_th`: explains missing details, blocked source, short article, translation failure, or RSS-only scope.

### Things worth watching

`watch_points_th` contains zero to three neutral prompts based on facts in the article. Examples include watching for an announced launch date, reported financial result, regulatory decision, or management follow-up. It must not produce buy/sell advice, price targets, predicted returns, or a confident directional risk rating.

## 7. Portfolio visibility rules

Let `holdingIds` be company IDs from the current authenticated user's `portfolio_holdings` rows.

- An article is visible only when a `news_company_links` row exists where `company_id` is in `holdingIds`.
- A story related to multiple held companies appears once, with all related held companies shown.
- A story related only to a non-held company is hidden from both Dashboard and the related-news page.
- Empty holdings return zero visible articles.
- Filtering happens through a shared pure helper covered by automated tests, then is applied consistently to summary counts, cards, and the portfolio radar.

## 8. User interface

### Dashboard

- Lead with “ข่าวล่าสุดในพอร์ตของคุณ”.
- Summary count reflects visible portfolio-linked news only.
- Card hierarchy:
  1. translated headline;
  2. publisher and publication time;
  3. “เกิดอะไรขึ้น” factual summary;
  4. key points and detected numbers;
  5. related held-company chips;
  6. “สิ่งที่น่าสนใจ/ควรติดตาม”;
  7. scope/limitation notice and original-source link.
- Remove the visually dominant increase/decrease risk badge and investment-action language.

### Internal reading page

- Route: `#news/<article-id>`.
- Shows the same factual sections in a more readable layout.
- Includes collapsible English headline and RSS excerpt for transparency.
- Clearly labels itself as a Thai summary, not a full article translation.
- A missing or unauthorized article renders a recoverable “ไม่พบข่าวนี้” state without exposing global news.

### Empty states

- Empty portfolio: “เพิ่มหุ้นในพอร์ตเพื่อรับข่าวที่เกี่ยวข้อง”.
- Portfolio has no current articles: “ยังไม่มีข่าวล่าสุดสำหรับหุ้นที่คุณติดตาม”.
- Article-page extraction unavailable: show the RSS-based summary with a visible limitation notice.

## 9. Error handling and operational limits

- Publisher requests use redirect, deadline, response-size, and HTML content-type checks.
- One blocked or stalled publisher must not block other articles or feeds.
- Bound source-page concurrency and the number of new pages processed per run.
- Preserve previously successful article-page summaries when a later refresh cannot re-fetch the publisher.
- Preserve cached translations and retry only missing fields.
- Record per-run counts for article-page extraction, RSS fallback, blocked pages, translation attempts, and saved articles/links.
- Keep the existing ingestion secret, overlap lock, JWT verification, and 30-minute schedule.

## 10. Security

- Perform all publisher fetching in the Edge Function.
- Accept only `http:` and `https:` article URLs, then require `https:` after redirects when the publisher supports it.
- Block localhost, private-network, link-local, loopback, and non-public destination addresses to prevent SSRF.
- Validate every redirect target using the same outbound URL policy.
- Never execute source-page scripts or store source HTML.
- Keep ingestion RPCs restricted to `service_role`; authenticated users receive read-only access through RLS.

## 11. Testing and review

Development follows TDD and subagent review gates.

Required automated coverage:

- portfolio-only filtering, including empty portfolio and multi-company stories;
- dashboard counts and radar derived from filtered articles;
- article extraction from JSON-LD, semantic article, and paragraph fallback fixtures;
- removal of boilerplate and rejection of insufficient content;
- RSS fallback for paywall/blocked/timeout/malformed responses;
- URL and redirect SSRF protection;
- factual summaries containing no number/entity absent from source;
- preservation of cached article summaries and translations;
- neutral watch points with no buy/sell or return prediction;
- internal route, not-found state, and factual-before-observation ordering.

After implementation, verify the full automated suite, Supabase migrations/functions, one live ingestion, Dashboard and news routes, empty states, mobile layout, and zero browser console errors.

## 12. Delivery sequence

1. Shared article-extraction and summarization rules with executable fixtures.
2. Schema migration for extraction metadata and watch points.
3. Hardened source-page ingestion with RSS fallback and live deployment verification.
4. Portfolio-linked query/filter behavior across Dashboard and related-news page.
5. Thai summary cards and internal reading route.
6. Browser verification, documentation, and independent final review.

## 13. Success criteria

- A signed-in user never sees an article unrelated to all of their holdings.
- A typical extractable article provides a Thai overview plus two or more useful factual points without opening the publisher page.
- RSS-only or blocked-source stories remain usable and visibly disclose their limited scope.
- No complete publisher article is stored or represented as translated in full.
- The primary UI helps users understand news; it does not pressure them toward a trading decision.
- The feature continues to operate without paid APIs.
