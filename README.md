# Longview — Personal AI Investment Intelligence

Thai-first portfolio intelligence backed by Supabase and official SEC EDGAR data.

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

For scheduled ingestion, store the same secret in Supabase Vault and use Supabase Cron to POST to the function. A daily schedule is sufficient for SEC filings.

## 4. Run locally

```powershell
python -m http.server 4173
```

Open `http://localhost:4173`.

## Data behavior

When Supabase is not configured, the UI shows setup instructions and no demo financial values. After setup, missing SEC data is shown as unavailable until ingestion succeeds.
