import { extractKeyNumbers, SUPPORTED_COMPANIES } from "./news-rules.js";

const MAX_HTML_LENGTH = 2_000_000;
const MIN_ARTICLE_CHARACTERS = 240;
const MIN_PARAGRAPH_CHARACTERS = 40;
const MAX_EVIDENCE_FRAGMENTS = 3;
const MAX_FRAGMENT_CHARACTERS = 200;

const BOILERPLATE_PATTERN = /^(?:advertisement|sponsored|cookie(?: preferences| settings)?|privacy policy|terms of (?:use|service)|all rights reserved|home|menu|share|follow us|sign up|log in|subscribe(?: to (?:our|the) newsletter)?|newsletter)$/i;
const BOILERPLATE_PROSE_PATTERNS = Object.freeze([
  /^(?:we|this (?:website|site)) (?:and our partners )?use(?:s)? cookies(?: and (?:similar|other) technologies)?\b/i,
  /^by (?:clicking|selecting|choosing) .{0,50}\bcookies?\b.*\byou (?:agree|consent)\b/i,
  /\byou (?:agree|consent) to (?:the )?(?:storing|use) of cookies? on your device\b/i,
  /^manage (?:your )?(?:cookie|consent) (?:preferences|settings)\b/i,
  /^(?:sign up|subscribe) (?:now )?(?:to|for) (?:our|the) newsletter\b/i,
]);
const RESTRICTED_CONTENT_PATTERN = /subscribe to (?:continue|read|unlock)|already a subscriber|sign in to (?:continue|read)|register to (?:continue|read)|(?:complete|solve) the captcha|access denied|enable (?:javascript|cookies) to continue/i;
const EVENT_VERBS = [
  "announce", "announced", "approve", "approved", "acquire", "acquired", "cut", "expand", "expanded",
  "file", "filed", "launch", "launched", "open", "opened", "report", "reported", "rise", "rose",
  "fall", "fell", "increase", "increased", "decrease", "decreased", "release", "released", "sign", "signed",
  "เปิดตัว", "ประกาศ", "รายงาน", "เพิ่มขึ้น", "ลดลง", "อนุมัติ", "ซื้อกิจการ",
];
const RAW_TEXT_ELEMENTS = Object.freeze(["script", "style", "noscript", "template", "textarea", "title", "xmp", "noembed"]);

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function decodeHtmlEntities(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", hellip: "…", lt: "<", nbsp: " ", ndash: "–", mdash: "—",
    quot: '"', rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  };
  return stringValue(value).replace(/&(#x[\da-f]+|#\d+|[a-z][\da-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : " ";
    }
    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : " ";
    }
    return named[lower] ?? " ";
  });
}

function removeNonVisibleMarkup(html) {
  const withoutClosedElements = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|textarea|title|xmp|noembed|svg|iframe|canvas)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  return withoutClosedElements.replace(
    /<(script|style|noscript|template|textarea|title|xmp|noembed|svg|iframe|canvas)\b[^>]*>[\s\S]*$/gi,
    " ",
  );
}

function removeUnsafeAndPeripheralMarkup(html) {
  const withoutNonVisibleMarkup = removeContextualBoilerplate(removeNonVisibleMarkup(html));
  const withoutClosedElements = withoutNonVisibleMarkup.replace(
    /<(form|nav|aside|footer|dialog)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
  return withoutClosedElements.replace(/<(form|nav|aside|footer|dialog)\b[^>]*>[\s\S]*$/gi, " ");
}

function removeContextualBoilerplate(html) {
  return html.replace(/<(div|section)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, (element, _tag, attributes) => {
    const isBoilerplateContainer = /(?:id|class)\s*=\s*["'][^"']*(?:cookie[-_ ]?(?:banner|consent|notice)|consent[-_ ]?(?:banner|manager|notice)|newsletter[-_ ]?(?:signup|modal)|subscription[-_ ]?(?:overlay|modal)|paywall)[^"']*["']/i.test(attributes);
    return isBoilerplateContainer ? " " : element;
  });
}

function hasUnterminatedRawTextElement(html) {
  for (const tag of RAW_TEXT_ELEMENTS) {
    const tokens = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    let isOpen = false;
    let match;
    while ((match = tokens.exec(html)) !== null) {
      if (match[1]) {
        if (isOpen) isOpen = false;
      } else if (!isOpen) {
        isOpen = true;
      }
    }
    if (isOpen) return true;
  }
  return false;
}

function cleanMarkupText(value) {
  return decodeHtmlEntities(
    stringValue(value)
      .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/\s*(?:p|div|section|li|h[1-6])\s*>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeParagraph(value) {
  return cleanMarkupText(value).replace(/\s+/g, " ").trim();
}

function isBoilerplate(paragraph) {
  const normalized = paragraph.replace(/[|•·]+/g, " ").replace(/\s+/g, " ").trim();
  return !normalized
    || BOILERPLATE_PATTERN.test(normalized)
    || BOILERPLATE_PROSE_PATTERNS.some((pattern) => pattern.test(normalized))
    || RESTRICTED_CONTENT_PATTERN.test(normalized);
}

function uniqueParagraphs(paragraphs) {
  const seen = new Set();
  const result = [];
  for (const value of paragraphs) {
    const paragraph = normalizeParagraph(value);
    const key = paragraph.toLocaleLowerCase();
    if (isBoilerplate(paragraph) || seen.has(key)) continue;
    seen.add(key);
    result.push(paragraph);
  }
  return result;
}

function paragraphElements(markup) {
  const paragraphs = [];
  const expression = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi;
  let match;
  while ((match = expression.exec(markup)) !== null) paragraphs.push(match[1]);
  return uniqueParagraphs(paragraphs);
}

function paragraphsFromArticleBody(value) {
  const source = stringValue(value);
  if (!source) return [];
  const sanitized = removeUnsafeAndPeripheralMarkup(source);
  const fromElements = paragraphElements(sanitized);
  if (fromElements.length > 0) return fromElements;
  return uniqueParagraphs(cleanMarkupText(sanitized).split(/\n\s*\n|\n/g));
}

function articleBodies(value, bodies = []) {
  if (Array.isArray(value)) {
    for (const item of value) articleBodies(item, bodies);
    return bodies;
  }
  if (!value || typeof value !== "object") return bodies;
  if (typeof value.articleBody === "string") bodies.push(value.articleBody);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "articleBody") articleBodies(child, bodies);
  }
  return bodies;
}

function jsonLdCandidates(html) {
  const candidates = [];
  const scripts = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = scripts.exec(html)) !== null) {
    if (!/\btype\s*=\s*(?:["']application\/ld\+json["']|application\/ld\+json)(?:\s|$)/i.test(match[1])) continue;
    try {
      const parsed = JSON.parse(match[2].trim());
      for (const body of articleBodies(parsed)) candidates.push(paragraphsFromArticleBody(body));
    } catch {
      // Invalid structured data is ignored in favor of lower-priority semantic content.
    }
  }
  return candidates;
}

function semanticArticleCandidates(html) {
  const candidates = [];
  const articles = /<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi;
  let match;
  while ((match = articles.exec(html)) !== null) {
    const cleaned = removeUnsafeAndPeripheralMarkup(match[1]);
    const paragraphs = paragraphElements(cleaned);
    candidates.push(paragraphs.length > 0 ? paragraphs : uniqueParagraphs(cleanMarkupText(cleaned).split(/\n+/)));
  }
  return candidates;
}

function isMeaningfulParagraph(paragraph) {
  return paragraph.length >= MIN_PARAGRAPH_CHARACTERS && !isBoilerplate(paragraph);
}

function qualifies(paragraphs) {
  const meaningful = paragraphs.filter(isMeaningfulParagraph);
  return meaningful.length >= 2 && meaningful.join("\n\n").length >= MIN_ARTICLE_CHARACTERS;
}

function extractionDetails(html) {
  if (typeof html !== "string") return { text: "", reason: "malformed" };
  if (!html.trim()) return { text: "", reason: "empty" };

  const bounded = html.slice(0, MAX_HTML_LENGTH);
  if (hasUnterminatedRawTextElement(bounded)) return { text: "", reason: "malformed" };
  const restrictionUiText = cleanMarkupText(removeNonVisibleMarkup(bounded));
  if (RESTRICTED_CONTENT_PATTERN.test(restrictionUiText)) return { text: "", reason: "paywall_or_restricted" };

  const withoutPeripheralMarkup = removeUnsafeAndPeripheralMarkup(bounded);
  const candidates = [
    ...jsonLdCandidates(bounded),
    ...semanticArticleCandidates(withoutPeripheralMarkup),
    paragraphElements(withoutPeripheralMarkup),
  ];
  for (const paragraphs of candidates) {
    if (qualifies(paragraphs)) {
      return { text: paragraphs.filter(isMeaningfulParagraph).join("\n\n"), reason: null };
    }
  }
  return { text: "", reason: "insufficient" };
}

function parseIpv4(hostname) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return null;
  const octets = hostname.split(".").map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isNonPublicIpv4(octets) {
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function parseIpv6(hostname) {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const omitted = halves.length === 2 ? 8 - left.length - right.length : 0;
  const parts = [...left, ...Array(omitted).fill("0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[\da-f]{1,4}$/.test(part))) return null;
  return parts.reduce((result, part) => (result << 16n) | BigInt(Number.parseInt(part, 16)), 0n);
}

function ipv6Range(base, prefixLength) {
  return { base: parseIpv6(base), prefixLength: BigInt(prefixLength) };
}

const NON_PUBLIC_IPV6_RANGES = Object.freeze([
  ipv6Range("::", 96),
  ipv6Range("::ffff:0:0", 96),
  ipv6Range("64:ff9b::", 96),
  ipv6Range("64:ff9b:1::", 48),
  ipv6Range("100::", 64),
  ipv6Range("2001::", 23),
  ipv6Range("2001:db8::", 32),
  ipv6Range("2002::", 16),
  ipv6Range("3fff::", 20),
  ipv6Range("fc00::", 7),
  ipv6Range("fe80::", 9),
  ipv6Range("ff00::", 8),
]);
const GLOBAL_UNICAST_IPV6_RANGE = ipv6Range("2000::", 3);

function isInIpv6Range(address, { base, prefixLength }) {
  const shift = 128n - prefixLength;
  return (address >> shift) === (base >> shift);
}

function isNonPublicIpv6(hostname) {
  const address = parseIpv6(hostname);
  if (address === null) return true;
  if (!isInIpv6Range(address, GLOBAL_UNICAST_IPV6_RANGE)) return true;
  return NON_PUBLIC_IPV6_RANGES.some((range) => isInIpv6Range(address, range));
}

function isValidPublicHostname(hostname) {
  if (hostname.endsWith("..")) return false;
  const normalized = hostname.replace(/\.$/, "");
  if (!normalized || normalized.length > 253) return false;
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local") || normalized.endsWith(".internal")) return false;
  const labels = normalized.split(".");
  return labels.length >= 2 && labels.every((label) => (
    label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  ));
}

export function isSafePublicArticleUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim() || rawUrl.includes("\\")) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) return false;
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname) return false;
    const ipv4 = parseIpv4(hostname);
    if (ipv4) return !isNonPublicIpv4(ipv4);
    if (hostname.includes(":")) return !isNonPublicIpv6(hostname);
    return isValidPublicHostname(hostname);
  } catch {
    return false;
  }
}

export function extractArticleText(html) {
  return extractionDetails(html).text;
}

function selectedCompanies(companies) {
  if (!Array.isArray(companies)) return SUPPORTED_COMPANIES;
  const tickers = new Set(companies.flatMap((company) => {
    if (typeof company === "string") return [company];
    if (company && typeof company.ticker === "string") return [company.ticker];
    return [];
  }));
  return SUPPORTED_COMPANIES.filter((company) => tickers.has(company.ticker));
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasMentions(text, companies) {
  const candidates = [];
  for (const company of selectedCompanies(companies)) {
    for (const alias of company.aliases ?? []) {
      const expression = new RegExp(`(^|[^A-Za-z0-9])(${escapeRegularExpression(alias)})(?=$|[^A-Za-z0-9])`, "gi");
      let match;
      while ((match = expression.exec(text)) !== null) {
        const start = match.index + match[1].length;
        candidates.push({ text: match[2], start, end: start + match[2].length });
      }
    }
  }
  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const accepted = [];
  for (const candidate of candidates) {
    if (!accepted.some((mention) => candidate.start < mention.end && candidate.end > mention.start)) accepted.push(candidate);
  }
  const seen = new Set();
  return accepted.map((mention) => mention.text).filter((mention) => {
    const key = mention.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sentenceFragments(text) {
  const source = stringValue(text).replace(/\s+/g, " ").trim();
  if (!source) return [];
  return source
    .split(/(?<=[!?。！？])\s+|(?<=\.)\s+(?=[\p{Lu}\p{Lt}\p{Lo}\d"'“‘])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function titleTokens(title) {
  return new Set(stringValue(title).toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

function fragmentScore(fragment, index, headlineTokens, companies) {
  const lower = fragment.toLocaleLowerCase();
  const words = new Set(lower.match(/[\p{L}\p{N}]{3,}/gu) ?? []);
  let score = Math.max(0, 20 - index);
  for (const token of headlineTokens) if (words.has(token)) score += 12;
  score += aliasMentions(fragment, companies).length * 25;
  score += Math.min(3, extractKeyNumbers(fragment).length) * 18;
  score += EVENT_VERBS.some((verb) => lower.includes(verb)) ? 16 : 0;
  return score;
}

function clipFragment(fragment) {
  if (fragment.length <= MAX_FRAGMENT_CHARACTERS) return fragment;
  return fragment.slice(0, MAX_FRAGMENT_CHARACTERS).trimEnd();
}

export function selectSourceEvidence({ title = "", text = "", companies = SUPPORTED_COMPANIES, maxFragments = 3 } = {}) {
  const limit = Math.max(0, Math.min(MAX_EVIDENCE_FRAGMENTS, Number.isFinite(maxFragments) ? Math.floor(maxFragments) : 3));
  if (limit === 0) return [];
  const headlineTokens = titleTokens(title);
  const candidates = sentenceFragments([stringValue(title), stringValue(text)].filter(Boolean).join(". "));
  const seen = new Set();
  return candidates
    .map((fragment, index) => ({ fragment, index, score: fragmentScore(fragment, index, headlineTokens, companies) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .filter(({ fragment }) => {
      const key = fragment.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ fragment }) => ({ text: clipFragment(fragment) }));
}

function groundedKeyNumbers(text) {
  return extractKeyNumbers(text).map((number) => ({
    ...number,
    context: clipFragment(number.context),
  }));
}

export function buildArticleSummaryInput({ title = "", rssExcerpt = "", html = "", companies = SUPPORTED_COMPANIES } = {}) {
  const extraction = extractionDetails(html);
  const publisherSucceeded = Boolean(extraction.text);
  const sourceText = publisherSucceeded
    ? [stringValue(title), extraction.text].filter(Boolean).join("\n\n")
    : [stringValue(title), stringValue(rssExcerpt)].filter(Boolean).join("\n\n");

  return {
    contentScope: publisherSucceeded ? "publisher_article" : "rss_excerpt",
    contentStatus: publisherSucceeded ? "extracted" : "fallback",
    evidence: selectSourceEvidence({ title, text: publisherSucceeded ? extraction.text : rssExcerpt, companies, maxFragments: 3 }),
    entities: aliasMentions(sourceText, companies),
    keyNumbers: groundedKeyNumbers(sourceText),
    uncertaintyCode: publisherSucceeded
      ? null
      : extraction.reason === "paywall_or_restricted"
        ? "rss_paywall_or_restricted"
        : `rss_${extraction.reason}_article`,
  };
}
