import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_COMPANIES,
  normalizeArticleUrl,
  matchCompanies,
  extractKeyNumbers,
  buildFactualSummary,
  analyzeRisk
} from "../supabase/functions/_shared/news-rules.js";

test("supports exactly the seven approved tickers", () => {
  assert.deepEqual(SUPPORTED_COMPANIES.map((row) => row.ticker), [
    "GOOGL", "MSFT", "AAPL", "META", "TSLA", "NVDA", "AMZN"
  ]);
});

test("matches more than one company and gives title mentions greater relevance", () => {
  const matches = matchCompanies(
    "Microsoft and Nvidia expand AI partnership",
    "Azure will use NVIDIA systems.",
    SUPPORTED_COMPANIES
  );

  assert.deepEqual(matches.map((row) => row.ticker), ["MSFT", "NVDA"]);
  assert.equal(matches[0].inTitle, true);
  assert.equal(matches[0].relevance, 85);
  assert.equal(matches[1].inTitle, true);
  assert.equal(matches[1].relevance, 85);
});

test("normalizes tracking parameters without changing the article path", () => {
  assert.equal(
    normalizeArticleUrl("https://example.com/story?a=1&utm_source=rss&.tsrc=rss&guccounter=2&guce_referrer=feed&b=2#section"),
    "https://example.com/story?a=1&b=2#section"
  );
});

test("extracts only numeric phrases present in source text", () => {
  const values = extractKeyNumbers("Revenue rose 12% to $9.2 billion on September 4, 2026.");
  assert.ok(values.some((row) => row.value.includes("12%")));
  assert.ok(values.some((row) => row.value.includes("$9.2 billion")));
  assert.ok(values.some((row) => row.value.includes("September 4, 2026")));
  assert.equal(values.some((row) => row.value.includes("15%")), false);
});

test("short RSS excerpts explicitly report uncertainty", () => {
  const summary = buildFactualSummary({
    titleTh: "Google เปิดตัวบริการใหม่",
    summaryTh: "เริ่มเปิดให้ทดลอง",
    title: "Google launches service",
    summary: "A trial begins."
  }, []);

  assert.match(summary.uncertaintiesTh, /บทคัดย่อ|ข้อมูล.*จำกัด/);
  assert.equal(summary.sourceScope, "rss_excerpt");
  assert.equal(summary.summaryVersion, "deterministic-v1");
  assert.deepEqual(summary.keyNumbers, []);
});

test("incidental company mention does not produce a directional risk claim", () => {
  const result = analyzeRisk({
    title: "Adobe faces new competition risk",
    summary: "Alphabet was mentioned for comparison."
  }, "GOOGL");

  assert.equal(result.key, "monitor");
  assert.match(result.reasonTh, /หัวข้อ/);
  assert.equal(result.evidence.titleMention, false);
});

test("uses whole risk keywords instead of substring matches", () => {
  assert.equal(analyzeRisk({
    title: "Microsoft executive appointment announced",
    summary: "Leadership changes were announced."
  }, "MSFT").key, "monitor");
  assert.equal(analyzeRisk({
    title: "Microsoft mission update",
    summary: "The company described its mission."
  }, "MSFT").key, "monitor");

  const bankingResult = analyzeRisk({
    title: "Microsoft expands banking partnership",
    summary: "The companies announced a partnership."
  }, "MSFT");
  assert.equal(bankingResult.key, "decrease");
  assert.equal(bankingResult.evidence.matchedKeywords.includes("ban"), false);
});

test("uses a fixed Thai transparency message when translations are absent", () => {
  const englishTitle = "Microsoft expands cloud services";
  const englishSummary = "Revenue grew 8%.";
  const summary = buildFactualSummary({ title: englishTitle, summary: englishSummary }, []);

  assert.match(summary.whatHappenedTh, /ยังไม่มีคำแปลภาษาไทย/);
  assert.deepEqual(summary.keyPointsTh, ["ยังไม่มีคำแปลภาษาไทยสำหรับข้อมูล RSS นี้ จึงไม่สามารถสร้างสรุปภาษาไทยได้ โปรดอ่านแหล่งข่าวต้นฉบับเพิ่มเติม"]);
  assert.equal(summary.whatHappenedTh.includes(englishTitle), false);
  assert.equal(summary.keyPointsTh.some((point) => point.includes(englishSummary)), false);
});

test("preserves signs in source-present numeric phrases", () => {
  const values = extractKeyNumbers("Losses were -$5 million, margins fell -12%, and revenue rose +8%.");

  assert.ok(values.some((row) => row.value === "-$5 million"));
  assert.ok(values.some((row) => row.value === "-12%"));
  assert.ok(values.some((row) => row.value === "+8%"));
});
