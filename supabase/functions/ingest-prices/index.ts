import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const jsonHeaders = { "Content-Type": "application/json" };
const SUPPORTED_TICKERS = ["GOOGL", "MSFT", "AAPL", "META", "TSLA", "NVDA", "AMZN"] as const;

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const body = await request.json().catch(() => ({}));
    const requestedTicker = String(body?.ticker || "GOOGL").toUpperCase();
    if (!SUPPORTED_TICKERS.includes(requestedTicker as typeof SUPPORTED_TICKERS[number])) {
      return new Response(JSON.stringify({ error: "Unsupported ticker" }), { status: 400, headers: jsonHeaders });
    }
    const ticker = requestedTicker;
    const { data: company, error: companyError } = await db.from("companies")
      .select("id").eq("ticker", ticker).single();
    if (companyError) throw companyError;

    const now = Math.floor(Date.now() / 1000);
    const start = now - (21 * 365 * 24 * 60 * 60);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?period1=${start}&period2=${now}&interval=1mo&events=div%2Csplits&includeAdjustedClose=true`;
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 Longview investment education app" } });
    if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}`);
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error(payload?.chart?.error?.description || "Price series unavailable");

    const quote = result.indicators?.quote?.[0] ?? {};
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
    const dividends = result.events?.dividends ?? {};
    const rows = (result.timestamp ?? []).map((timestamp: number, index: number) => {
      const close = quote.close?.[index];
      if (![quote.open?.[index], quote.high?.[index], quote.low?.[index], close].every(Number.isFinite)) return null;
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
      const dividend = Object.values(dividends).find((item: any) => new Date(item.date * 1000).toISOString().slice(0, 10) === date) as any;
      return {
        company_id: company.id,
        trade_date: date,
        open: quote.open[index], high: quote.high[index], low: quote.low[index], close,
        adjusted_close: Number.isFinite(adjusted[index]) ? adjusted[index] : close,
        volume: Number.isFinite(quote.volume?.[index]) ? quote.volume[index] : 0,
        dividend: Number.isFinite(dividend?.amount) ? dividend.amount : 0,
        source: "yahoo_finance",
        fetched_at: new Date().toISOString(),
      };
    }).filter(Boolean);

    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 20);
    const recentRows = rows.filter((row: any) => row.trade_date >= cutoff.toISOString().slice(0, 10));
    const { error: saveError } = await db.from("stock_prices").upsert(recentRows, {
      onConflict: "company_id,trade_date,source",
    });
    if (saveError) throw saveError;

    const latest = recentRows.at(-1) as any;
    return new Response(JSON.stringify({
      ok: true, ticker, prices: recentRows.length,
      latest: latest ? { date: latest.trade_date, close: latest.close, adjustedClose: latest.adjusted_close } : null,
    }), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), { status: 500, headers: jsonHeaders });
  }
});
