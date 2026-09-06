import test from "node:test";
import assert from "node:assert/strict";
import {
  articleReadingModel,
  articleRouteId,
} from "../supabase/functions/_shared/news-rules.js";

const companies = [
  { id: "googl", ticker: "GOOGL", legal_name: "Alphabet Inc." },
  { id: "nvda", ticker: "NVDA", legal_name: "NVIDIA Corporation" },
];

const article = {
  id: "news-1",
  title: "Google reports quarterly cloud results",
  title_th: "Google รายงานผลประกอบการ Cloud รายไตรมาส",
  summary: "The RSS excerpt is available in English.",
  summary_th: "มีบทคัดย่อ RSS ภาษาไทย",
  what_happened_th: "Google เปิดเผยผลการดำเนินงานของธุรกิจ Cloud ตามรายงานของแหล่งข่าว",
  key_points_th: ["รายได้ Cloud ถูกกล่าวถึงในรายงาน", "บริษัทระบุช่วงเวลาของผลประกอบการ"],
  key_numbers: [{ kind: "currency", value: "$10 billion", context: "Cloud revenue was $10 billion." }],
  entities_th: ["Google", "Google Cloud"],
  watch_points_th: ["ติดตามตัวเลขรายได้ Cloud ในเอกสารบริษัท"],
  source_evidence: [
    { text: "Google reported cloud revenue of $10 billion in the latest quarter." },
    { text: "Management described the planned product launch timeline." },
    { text: "The publisher attributed the figures to the company report." },
    { text: "This fourth fragment must not be shown." },
  ],
  content_scope: "article_page",
  content_status: "extracted",
  source_name: "Example Publisher",
  source_url: "https://publisher.example.com/google-results",
  published_at: "2026-09-06T10:00:00.000Z",
};

const links = [{ news_id: "news-1", company_id: "googl", explicit_mention: true }];

test("parses only an internal news article route", () => {
  assert.equal(articleRouteId("news/news-1"), "news-1");
  assert.equal(articleRouteId("#news/news-1"), "news-1");
  assert.equal(articleRouteId("news"), null);
  assert.equal(articleRouteId("news/news-1/extra"), null);
});

test("builds a factual reader model only for an article linked to a holding", () => {
  const model = articleReadingModel(article, links, ["googl"], companies);

  assert.equal(model.title, article.title_th);
  assert.equal(model.publisher, "Example Publisher");
  assert.equal(model.originalUrl, article.source_url);
  assert.equal(model.scope.key, "article_page");
  assert.equal(model.relatedCompanies[0].ticker, "GOOGL");
  assert.deepEqual(model.sections, ["what_happened", "key_points", "facts", "companies", "watch_points", "scope", "original"]);
  assert.equal(model.evidence.length, 3);
  assert.ok(model.evidence.every((row) => row.text.length <= 200));
  assert.deepEqual(model.watchPoints, ["ติดตามตัวเลขรายได้ Cloud ในเอกสารบริษัท"]);
  assert.equal(Object.hasOwn(model, "risk"), false);
  assert.equal(Object.hasOwn(model, "investmentAction"), false);
});

test("refuses missing, unrelated, or discovery-only articles", () => {
  assert.equal(articleReadingModel(null, links, ["googl"], companies), null);
  assert.equal(articleReadingModel(article, links, ["nvda"], companies), null);
  assert.equal(articleReadingModel(article, [{ ...links[0], explicit_mention: false }], ["googl"], companies), null);
});

test("labels an RSS fallback and keeps English transparency fields", () => {
  const model = articleReadingModel({ ...article, content_scope: "rss_excerpt", source_evidence: [] }, links, ["googl"], companies);

  assert.equal(model.scope.key, "rss_excerpt");
  assert.match(model.scope.label, /RSS/);
  assert.equal(model.originalTitle, article.title);
  assert.equal(model.rssExcerpt, article.summary);
});
