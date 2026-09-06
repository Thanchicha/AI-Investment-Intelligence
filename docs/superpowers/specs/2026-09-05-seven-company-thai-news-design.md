# Seven-Company Thai News Intelligence — Design

## Objective

Turn Longview into a news-first investment education site for seven US companies: Alphabet (`GOOGL`), Microsoft (`MSFT`), Apple (`AAPL`), Meta (`META`), Tesla (`TSLA`), Nvidia (`NVDA`), and Amazon (`AMZN`). Users choose which companies to add to their own portfolio. The home page shows news related to those holdings, first explains what happened, and only then presents rule-based investment-risk analysis.

## Product principles

- Facts and analysis must be visually and semantically separate.
- The system must not invent facts that are absent from the RSS title or excerpt.
- It must label incomplete source material as an RSS excerpt, not a translated full article.
- Every item must retain publication time, publisher/feed attribution, and a link to the original article.
- Risk analysis is educational and must not issue buy or sell instructions.
- The first implementation must use no paid APIs.

## Data sources and refresh

`ingest-news` will poll Yahoo Finance RSS separately for all seven tickers every 30 minutes. It will normalize URLs and stable identifiers so one story discovered in several feeds is stored once. Each feed occurrence creates a relationship between the article and the ticker that surfaced it.

The ingestion run continues when an individual ticker feed fails. Its run record stores per-ticker counts and errors. A total outage produces a failed run; a subset failure produces a partial run. Existing articles remain readable during failures.

## Data model

### Companies

The existing `companies` table will contain all seven companies. `TSLA` is added with its SEC CIK and company metadata. Existing seeded companies outside the seven-company product scope are made inactive rather than deleted.

### Articles

The existing `stock_news` table remains the canonical article table and gains structured factual-reading fields:

- `what_happened_th`: concise factual overview based only on title and RSS excerpt.
- `entities_th`: named organizations or people that can be identified from the source text.
- `key_points_th`: short ordered factual points.
- `key_numbers`: numbers and dates extracted from source text with their surrounding phrase.
- `uncertainties_th`: what cannot be concluded from the excerpt.
- `source_scope`: fixed value describing whether the stored material is an RSS excerpt.
- `summary_version`: identifies the deterministic summarizer version.

The current translated title and summary remain available as fallbacks. No full publisher article body is copied into Supabase.

### Article-to-company relationships

A normalized `news_company_links` table connects one article to one or more companies. It records:

- discovery ticker;
- whether the company is explicitly mentioned in the title or excerpt;
- deterministic relevance score;
- matched aliases used as evidence.

The `(news_id, company_id)` pair is unique. Read access follows the existing authenticated-user RLS pattern. Writes remain restricted to the service-role Edge Function.

## Deterministic factual summary

The summarizer operates only on the English title and RSS excerpt. It:

1. Cleans markup and repeated title text.
2. Splits the excerpt into usable sentences.
3. Detects companies using explicit aliases.
4. Extracts dates, percentages, currency values, and other numeric phrases.
5. Classifies the event into earnings, AI/cloud, regulation, core business, partnership, leadership, or general company news.
6. Builds Thai factual sections from bounded templates and the existing machine-translated text.

When the excerpt is too short, the detail page states that the source supplied only limited information and directs the reader to the original article. The summarizer never fills missing causes, outcomes, or financial impact from assumptions.

## Analysis boundary

Rule-based risk analysis remains a separate stage and section. It uses English keywords, category, title prominence, and related-company evidence. Its output has three possible states:

- increased risk;
- reduced risk;
- impact not yet clear.

The analysis includes why the rule fired and what evidence the investor should verify next. If a company appears only incidentally in an excerpt, the impact defaults to “not yet clear.”

## User experience

### Home page

The default dashboard is a portfolio news feed. It includes:

- last successful refresh time and partial-failure notice;
- filter chips for holdings;
- latest cards limited to articles related to current holdings;
- factual “what happened” summary before the analysis block;
- related holding tickers and risk-direction badge;
- link to the internal Thai reading page.

If the portfolio is empty, the home page explains that no holding filter can be applied and offers the stock picker. It does not auto-add companies.

### All-news page

The all-news page contains news for all seven supported companies. Users can filter by ticker, category, and risk direction. Each card shows the source scope so users know it is based on an RSS excerpt.

### Thai reading page

Route `#news/<article-id>` displays, in order:

1. translated title, source, publication time, and related companies;
2. “เกิดอะไรขึ้น” factual overview;
3. key factual points;
4. detected numbers and dates;
5. what remains uncertain or absent from the excerpt;
6. a prominent button to read the publisher original;
7. a visually separate risk-analysis section;
8. the original English title and excerpt in a collapsible panel.

The page is an expanded Thai explanation of available RSS facts, not a full translated reproduction.

### Stock picker

The add-stock dialog gains a search input matching ticker and legal name. Only the seven active companies appear. Users select and add companies themselves; none are automatically added.

## Error handling

- Per-feed fetch failures are recorded and do not discard successful ticker results.
- Translation failures fall back to English and remain eligible for translation on a later run.
- Duplicate URLs or external IDs update relationships without duplicating the article.
- Missing structured-summary fields fall back to the translated RSS summary.
- Unknown or malformed article routes show a recoverable “article not found” state.
- Empty portfolios and empty feeds have explicit, actionable empty states.

## Testing

Automated tests cover:

- alias matching and multi-company relationships;
- duplicate stories found under multiple ticker feeds;
- number/date extraction without adding absent facts;
- short-excerpt uncertainty output;
- risk analysis defaulting to unclear for incidental mentions;
- portfolio-only filtering versus all-news filtering;
- ticker/name search in the stock picker;
- article-detail route and missing-article fallback.

Integration verification will push migrations, deploy `ingest-news`, run one ingestion, verify all seven ticker results and database relationships, then test dashboard, filters, detail route, and console errors in the local browser.

## Out of scope

- Paid news or translation APIs.
- Copying and republishing complete publisher articles.
- Personalized trade recommendations or automated orders.
- Semantic LLM analysis, embeddings, sentiment models, and historical-similarity matching.
- Stocks outside the seven approved companies.
