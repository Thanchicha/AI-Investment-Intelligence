const TRACKING_PARAMETERS = new Set([".tsrc", "guccounter", "guce_referrer"]);
const SHORT_EXCERPT_LENGTH = 160;
const SUMMARY_VERSION = "deterministic-v1";
const THAI_TRANSLATION_LIMITATION = "ยังไม่มีคำแปลภาษาไทยสำหรับข้อมูล RSS นี้ จึงไม่สามารถสร้างสรุปภาษาไทยได้ โปรดอ่านแหล่งข่าวต้นฉบับเพิ่มเติม";

export const SUPPORTED_COMPANIES = Object.freeze([
  Object.freeze({
    ticker: "GOOGL",
    legalName: "Alphabet Inc.",
    aliases: Object.freeze(["Alphabet", "Google", "Google Cloud", "YouTube", "Waymo", "GOOGL"])
  }),
  Object.freeze({
    ticker: "MSFT",
    legalName: "Microsoft Corporation",
    aliases: Object.freeze(["Microsoft", "Azure", "LinkedIn", "Xbox", "MSFT"])
  }),
  Object.freeze({
    ticker: "AAPL",
    legalName: "Apple Inc.",
    aliases: Object.freeze(["Apple", "iPhone", "iPad", "Mac", "App Store", "AAPL"])
  }),
  Object.freeze({
    ticker: "META",
    legalName: "Meta Platforms, Inc.",
    aliases: Object.freeze(["Meta Platforms", "Meta", "Facebook", "Instagram", "WhatsApp", "META"])
  }),
  Object.freeze({
    ticker: "TSLA",
    legalName: "Tesla, Inc.",
    aliases: Object.freeze(["Tesla", "TSLA"])
  }),
  Object.freeze({
    ticker: "NVDA",
    legalName: "NVIDIA Corporation",
    aliases: Object.freeze(["NVIDIA", "Nvidia", "NVDA"])
  }),
  Object.freeze({
    ticker: "AMZN",
    legalName: "Amazon.com, Inc.",
    aliases: Object.freeze(["Amazon Web Services", "AWS", "Amazon.com", "Amazon", "AMZN"])
  })
]);

function textValue(value) {
  return typeof value === "string" ? value : "";
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWordCharacter(character) {
  return Boolean(character) && /[A-Za-z0-9]/.test(character);
}

function findAliasMentions(text, aliases = []) {
  const source = textValue(text);
  const candidates = [];

  for (const alias of aliases) {
    if (!alias) continue;
    const expression = new RegExp(escapeRegularExpression(alias), "gi");
    let match;
    while ((match = expression.exec(source)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!isWordCharacter(source[start - 1]) && !isWordCharacter(source[end])) {
        candidates.push({ alias, start, end });
      }
    }
  }

  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const mentions = [];
  for (const candidate of candidates) {
    const overlaps = mentions.some((mention) => candidate.start < mention.end && candidate.end > mention.start);
    if (!overlaps) mentions.push(candidate);
  }
  return mentions;
}

function unique(values) {
  return [...new Set(values)];
}

function cleanText(value) {
  return textValue(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceContext(text, start, end) {
  const before = text.lastIndexOf(".", start - 1);
  const after = text.indexOf(".", end);
  return text.slice(before === -1 ? 0 : before + 1, after === -1 ? text.length : after + 1).trim();
}

function collectPhrases(text, expression, kind) {
  const values = [];
  let match;
  while ((match = expression.exec(text)) !== null) {
    values.push({
      kind,
      value: match[0],
      start: match.index,
      end: match.index + match[0].length,
      context: sentenceContext(text, match.index, match.index + match[0].length)
    });
  }
  return values;
}

function templateForRisk(key, evidence) {
  if (key === "increase") {
    return {
      labelTh: "ความเสี่ยงเพิ่มขึ้น",
      headlineTh: "มีประเด็นความเสี่ยงที่ควรติดตาม",
      reasonTh: `พบคำที่เกี่ยวกับความเสี่ยงในข่าวที่พาดหัวถึงบริษัท: ${evidence.matchedKeywords.join(", ")}`,
      nextStepTh: "ตรวจสอบรายละเอียดจากแหล่งข่าวต้นฉบับและข้อมูลบริษัทก่อนตีความผลกระทบ"
    };
  }
  if (key === "decrease") {
    return {
      labelTh: "ความเสี่ยงลดลง",
      headlineTh: "มีสัญญาณเชิงบวกที่ควรตรวจสอบ",
      reasonTh: `พบคำเชิงบวกในข่าวที่พาดหัวถึงบริษัท: ${evidence.matchedKeywords.join(", ")}`,
      nextStepTh: "ตรวจสอบว่าข้อมูลเชิงบวกมีรายละเอียดและความต่อเนื่องเพียงพอหรือไม่"
    };
  }
  return {
    labelTh: "ผลกระทบยังไม่ชัดเจน",
    headlineTh: "ยังไม่ควรสรุปทิศทางความเสี่ยง",
    reasonTh: evidence.titleMention
      ? "หัวข้อข่าวกล่าวถึงบริษัท แต่ยังไม่พบคำตามกฎที่บ่งชี้ทิศทางความเสี่ยง"
      : "ชื่อบริษัทไม่ได้ปรากฏในหัวข้อข่าว จึงเป็นเพียงการกล่าวถึงประกอบและยังสรุปทิศทางไม่ได้",
    nextStepTh: "ติดตามรายละเอียดจากแหล่งข่าวต้นฉบับก่อนประเมินผลกระทบ"
  };
}

function hasWholeKeyword(source, keyword) {
  return new RegExp(`\\b${escapeRegularExpression(keyword)}\\b`, "i").test(source);
}

export function normalizeArticleUrl(url) {
  const value = textValue(url).trim();
  if (!value) return value;

  try {
    const normalized = new URL(value);
    for (const key of [...normalized.searchParams.keys()]) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || TRACKING_PARAMETERS.has(lowerKey)) {
        normalized.searchParams.delete(key);
      }
    }
    return normalized.toString();
  } catch {
    return value;
  }
}

export function matchCompanies(title, excerpt, companies = SUPPORTED_COMPANIES) {
  const titleText = textValue(title);
  const excerptText = textValue(excerpt);

  return companies.flatMap((company) => {
    const titleMentions = findAliasMentions(titleText, company.aliases);
    const excerptMentions = findAliasMentions(excerptText, company.aliases);
    const mentions = [...titleMentions, ...excerptMentions];
    if (mentions.length === 0) return [];

    const inTitle = titleMentions.length > 0;
    return [{
      ticker: company.ticker,
      aliases: unique(mentions.map((mention) => mention.alias)),
      inTitle,
      relevance: (inTitle ? 80 : 50) + Math.max(0, mentions.length - 1) * 5
    }];
  });
}

export function articlesForHoldings(news = [], links = [], holdingIds = []) {
  const heldCompanyIds = new Set(holdingIds);
  if (heldCompanyIds.size === 0) return [];
  const visibleNewsIds = new Set(
    links
      .filter((link) => heldCompanyIds.has(link.company_id) && link.explicit_mention !== false)
      .map((link) => link.news_id),
  );
  return news
    .filter((article) => visibleNewsIds.has(article.id))
    .sort((left, right) => String(right.published_at ?? "").localeCompare(String(left.published_at ?? "")));
}

export function relatedHeldCompanies(articleId, links = [], holdingIds = [], companies = []) {
  const heldCompanyIds = new Set(holdingIds);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const seen = new Set();
  return links
    .filter((link) => link.news_id === articleId && heldCompanyIds.has(link.company_id) && link.explicit_mention !== false)
    .map((link) => companyById.get(link.company_id))
    .filter((company) => company && !seen.has(company.id) && (seen.add(company.id), true));
}

export function articleRouteId(route = "") {
  const match = String(route).replace(/^#/, "").match(/^news\/([^/?#]+)$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function readerTextList(value, limit = 5) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()).slice(0, limit);
}

function readerEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => typeof item === "string" ? { text: item } : item)
    .filter((item) => item && typeof item.text === "string" && item.text.trim())
    .slice(0, 3)
    .map((item) => ({ text: item.text.trim().slice(0, 200) }));
}

const NEWS_IMAGE_FALLBACKS = Object.freeze({
  earnings: "งบและคาดการณ์",
  ai_cloud: "AI และ Cloud",
  regulation: "กฎระเบียบ",
  core_business: "ธุรกิจหลัก",
  company: "ข่าวบริษัท",
});

export function newsImageModel(article = {}) {
  const category = Object.hasOwn(NEWS_IMAGE_FALLBACKS, article.category) ? article.category : "company";
  return { category, label: NEWS_IMAGE_FALLBACKS[category] };
}

export function latestPriceSnapshot(prices = []) {
  const rows = Array.isArray(prices) ? prices.filter(row => row && row.trade_date && Number.isFinite(Number(row.adjusted_close))).sort((a, b) => String(a.trade_date).localeCompare(String(b.trade_date))) : [];
  const latest = rows.at(-1);
  return latest ? { price: Number(latest.adjusted_close), tradeDate: latest.trade_date, source: latest.source || null } : null;
}

export function articleReadingModel(article, articleLinks = [], holdingIds = [], companies = []) {
  if (!article?.id) return null;
  const relatedCompanies = relatedHeldCompanies(article.id, articleLinks, holdingIds, companies);
  if (!relatedCompanies.length) return null;
  const articlePage = article.content_scope === "article_page";
  const title = String(article.title_th || article.title || "ข่าวที่ไม่มีหัวข้อ").trim();
  return {
    id: article.id,
    title,
    publisher: String(article.source_name || "ไม่ระบุแหล่งข่าว"),
    publishedAt: article.published_at || null,
    originalUrl: article.source_url || null,
    image: newsImageModel(article),
    whatHappened: String(article.what_happened_th || article.summary_th || article.summary || "ยังไม่มีบทสรุปจากแหล่งข่าว").trim(),
    keyPoints: readerTextList(article.key_points_th),
    keyNumbers: Array.isArray(article.key_numbers) ? article.key_numbers.slice(0, 6) : [],
    entities: readerTextList(article.entities_th, 8),
    relatedCompanies,
    watchPoints: readerTextList(article.watch_points_th),
    evidence: readerEvidence(article.source_evidence),
    scope: articlePage
      ? { key: "article_page", label: "สรุปจากหน้าเว็บต้นฉบับ", limitation: "สรุปจากข้อความบางส่วนของบทความ ไม่ใช่คำแปลฉบับเต็ม" }
      : { key: "rss_excerpt", label: "สรุปจาก RSS", limitation: "ข้อมูลอ้างอิงหัวข้อและบทคัดย่อ RSS ซึ่งอาจมีรายละเอียดจำกัด" },
    originalTitle: String(article.title || "").trim(),
    rssExcerpt: String(article.summary || "").trim(),
    sections: ["what_happened", "key_points", "facts", "companies", "watch_points", "scope", "original"],
  };
}

export function extractKeyNumbers(text) {
  const source = cleanText(text);
  if (!source) return [];

  const month = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)";
  const candidates = [
    ...collectPhrases(source, /[+-]?(?:US\$|USD\s?|\$|€|£|¥)\s?\d+(?:,\d{3})*(?:\.\d+)?(?:\s?(?:trillion|billion|million|thousand|[KMBT]))?/gi, "currency"),
    ...collectPhrases(source, /(?<![A-Za-z0-9])[+-]?\d+(?:\.\d+)?\s?%/g, "percentage"),
    ...collectPhrases(source, /(?<![A-Za-z0-9])[+-]?\d+(?:,\d{3})*(?:\.\d+)?\s?(?:trillion|billion|million|thousand|[KMBT])\b/gi, "compact_number"),
    ...collectPhrases(source, new RegExp(`\\b${month}\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b|\\b\\d{1,2}\\s+${month}(?:\\s+\\d{4})?\\b`, "gi"), "date")
  ];

  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const results = [];
  for (const candidate of candidates) {
    if (!results.some((result) => candidate.start < result.end && candidate.end > result.start)) {
      results.push(candidate);
    }
  }
  return results.map(({ kind, value, context }) => ({ kind, value, context }));
}

export function buildFactualSummary(article = {}, matches = []) {
  const originalTitle = cleanText(article.title);
  const originalSummary = cleanText(article.summary ?? article.excerpt);
  const translatedTitle = cleanText(article.titleTh);
  let translatedSummary = cleanText(article.summaryTh) || cleanText(article.excerptTh);
  if (translatedSummary === translatedTitle) translatedSummary = "";
  const hasThaiTranslation = Boolean(translatedTitle || translatedSummary);

  const relatedCompanies = matches.length > 0
    ? matches
    : matchCompanies(originalTitle, originalSummary, SUPPORTED_COMPANIES);
  const sourceText = [originalTitle, originalSummary].filter(Boolean).join(" ");
  const shortExcerpt = originalSummary.length < SHORT_EXCERPT_LENGTH;

  return {
    whatHappenedTh: !hasThaiTranslation
      ? THAI_TRANSLATION_LIMITATION
      : translatedSummary
      ? `สรุปจาก RSS: ${translatedTitle} — ${translatedSummary}`
      : `สรุปจาก RSS: ${translatedTitle}`,
    entitiesTh: relatedCompanies.map((company) => company.aliases[0] || company.ticker),
    keyPointsTh: hasThaiTranslation
      ? [
        translatedTitle && `หัวข้อข่าว: ${translatedTitle}`,
        translatedSummary && `บทคัดย่อ RSS: ${translatedSummary}`
      ].filter(Boolean)
      : [THAI_TRANSLATION_LIMITATION],
    keyNumbers: extractKeyNumbers(sourceText),
    uncertaintiesTh: shortExcerpt
      ? "ข้อมูลจากบทคัดย่อ RSS มีจำกัด จึงไม่สามารถยืนยันสาเหตุ ผลลัพธ์ หรือผลกระทบทั้งหมดได้ โปรดอ่านแหล่งข่าวต้นฉบับเพิ่มเติม"
      : "เนื้อหานี้อ้างอิงเฉพาะหัวข้อและบทคัดย่อ RSS ไม่ใช่บทความฉบับเต็ม",
    sourceScope: "rss_excerpt",
    summaryVersion: SUMMARY_VERSION
  };
}

export function analyzeRisk(article = {}, primaryTicker) {
  const company = SUPPORTED_COMPANIES.find((candidate) => candidate.ticker === primaryTicker);
  const title = cleanText(article.title);
  const summary = cleanText(article.summary ?? article.excerpt);
  const titleMentions = company ? findAliasMentions(title, company.aliases) : [];
  const evidence = {
    primaryTicker: primaryTicker || null,
    titleMention: titleMentions.length > 0,
    matchedAliases: unique(titleMentions.map((mention) => mention.alias)),
    matchedKeywords: []
  };

  if (!evidence.titleMention) {
    const template = templateForRisk("monitor", evidence);
    return { key: "monitor", ...template, evidence };
  }

  const source = `${title} ${summary}`.toLowerCase();
  const increaseKeywords = ["risk", "lawsuit", "antitrust", "probe", "investigation", "fine", "recall", "delay", "warning", "decline", "cut", "miss", "ban"];
  const decreaseKeywords = ["beat", "growth", "record", "profit", "approval", "launch", "partnership", "expand", "surge"];
  const increaseMatches = increaseKeywords.filter((keyword) => hasWholeKeyword(source, keyword));
  const decreaseMatches = decreaseKeywords.filter((keyword) => hasWholeKeyword(source, keyword));
  const key = increaseMatches.length > 0 ? "increase" : decreaseMatches.length > 0 ? "decrease" : "monitor";
  evidence.matchedKeywords = key === "increase" ? increaseMatches : key === "decrease" ? decreaseMatches : [];
  const template = templateForRisk(key, evidence);
  return { key, ...template, evidence };
}
