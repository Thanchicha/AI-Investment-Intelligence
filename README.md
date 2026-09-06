# Longview — Personal AI Investment Intelligence

Thai-first portfolio intelligence backed by Supabase and official SEC EDGAR data.

## News reader (seven-company scope)

The news experience is portfolio-first: Dashboard and `#news` show only stories
linked to the signed-in user's holdings through `news_company_links`. The supported
company universe is `GOOGL`, `MSFT`, `AAPL`, `META`, `TSLA`, `NVDA`, and `AMZN`.
An empty portfolio intentionally shows no global news.

Each story has an internal `#news/<article-id>` reader with a factual Thai summary,
key points, grounded numbers, related held companies, source evidence, and a direct
link to the original publisher. The app stores short derived fields and evidence,
not full publisher article bodies. If a publisher page cannot be read, the system
labels the result as an RSS excerpt and keeps the limitation visible.
The reader is an educational reference, not a buy/sell recommendation; any optional
rule-based signals are kept separate from the factual summary and should be checked
against the original source and company filings.

News ingestion runs through the secured `ingest-news` Edge Function. It reads Yahoo
Finance RSS feeds for the seven tickers every 30 minutes, attempts bounded public
publisher-page extraction, and translates only selected fields through the free
MyMemory path. Translation is best-effort and may be unavailable or rate-limited.
Category cards are rendered locally; the app does not download or store news images.

## Local mode (recommended while Supabase is unavailable)

The app automatically uses SQLite when `config.js` does not contain Supabase credentials.
No third-party Python packages are required.

Set a real contact address in the SEC User-Agent before syncing:

```powershell
$env:SEC_USER_AGENT = "Longview your-email@example.com"
& "C:\Users\15123\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" server.py
```

Open `http://localhost:4173`, then press **ซิงก์ข้อมูลจาก SEC**. The local database is created at `data/longview.db` and is excluded from Git.

You can also sync from the terminal and exit:

```powershell
$env:SEC_USER_AGENT = "Longview your-email@example.com"
python server.py --sync GOOGL NVDA MSFT AAPL
```

The frontend uses the same record shapes in both modes. Adding Supabase values to `config.js` switches the app back to production mode without changing UI code.

## GOOGL 20-year learning view

The GOOGL company page includes:

- A 20-year split/dividend-adjusted monthly price chart
- CAGR, maximum drawdown, and recovery-time calculations
- Four manually curated turning points with primary-source links
- Event markers overlaid on the chart after price data is loaded

Add an Alpha Vantage key to the git-ignored `local_settings.json`:

```json
{
  "sec_user_agent": "Longview your-email@example.com",
  "alpha_vantage_api_key": "YOUR_ALPHA_VANTAGE_KEY"
}
```

Restart `server.py`, open GOOGL, and press **ดึงราคาย้อนหลัง**. The server calls `TIME_SERIES_MONTHLY_ADJUSTED`; the key is never sent to the browser.

## Architecture

- Static Thai frontend using the Supabase browser client
- Anonymous Supabase Auth for a frictionless personal session
- Row Level Security isolates each user's portfolio
- Public-company financial data is readable only by authenticated users
- `ingest-sec` Edge Function fetches SEC Company Facts and writes with service-role access
- Every financial fact points to its original SEC filing
- News records are visible only through authenticated portfolio-linked rows
- Ingestion uses bounded fetches, public-URL validation, and no stored full article HTML

## 1. Create and configure Supabase

Create a Supabase project, then enable **Authentication → Providers → Anonymous Sign-Ins**.

Copy `config.example.js` values into `config.js`:

```js
window.LONGVIEW_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabasePublishableKey: "YOUR_PUBLISHABLE_OR_ANON_KEY"
};
```

The publishable/anon key is safe in the browser only because all exposed tables use RLS. Never add a secret or service-role key to this file.

## 2. Apply the database migration

Using the Supabase CLI:

```powershell
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

## 3. Configure and deploy SEC ingestion

SEC requests must identify the application owner. Use a real contact email:

```powershell
supabase secrets set SEC_USER_AGENT="Longview your-email@example.com"
supabase secrets set SEC_INGEST_SECRET="A_LONG_RANDOM_VALUE"
supabase functions deploy ingest-sec --no-verify-jwt
```

Invoke the first sync from a trusted terminal. Do not put the ingestion secret in frontend code:

```powershell
$headers = @{
  "x-ingest-secret" = "A_LONG_RANDOM_VALUE"
  "Content-Type" = "application/json"
}
Invoke-RestMethod `
  -Method Post `
  -Uri "https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-sec" `
  -Headers $headers `
  -Body '{"tickers":["GOOGL","NVDA","MSFT","AAPL"]}'
```

For scheduled ingestion, store the news secret in Supabase Vault and use Supabase Cron
to POST to `ingest-news` every 30 minutes. Keep the ingestion function protected by
its configured secret; never place that secret in `config.js` or frontend code.

The SEC function can use a daily schedule because filings are not real-time. The news
function uses the seven-company schedule created by the news migrations.

## Verification

Run the complete local suite after changes:

```powershell
npm test
```

Expected result: zero failures, skips, cancellations, or warnings. Before production
release, also confirm that the latest migrations are applied, `ingest-news` is active
with its intended JWT setting, the Vault secret exists, and one trusted invocation
returns seven feed entries with article/link and extraction/fallback counts. Inspect
representative `stock_news` rows to confirm evidence is bounded and no full article
body is persisted.

Current linked-project check (2026-09-06): local and remote migrations match through
`202609060001`; `ingest-sec`, `ingest-news`, and `ingest-prices` are `ACTIVE` with JWT
verification enabled. A live news invocation is intentionally not included here because
it requires the private Vault ingestion secret.

## 4. Run locally

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`.

## Data behavior

When Supabase is not configured, the UI shows setup instructions and no demo financial values. After setup, missing SEC data is shown as unavailable until ingestion succeeds.
