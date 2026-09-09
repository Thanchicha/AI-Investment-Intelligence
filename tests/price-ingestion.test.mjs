import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../supabase/functions/ingest-prices/index.ts", import.meta.url), "utf8");

test("price ingestion accepts each supported company ticker", () => {
  assert.match(source, /const SUPPORTED_TICKERS = \["GOOGL", "MSFT", "AAPL", "META", "TSLA", "NVDA", "AMZN"\]/);
  assert.match(source, /body\??\.ticker/);
  assert.doesNotMatch(source, /const TICKER = "GOOGL"/);
});
