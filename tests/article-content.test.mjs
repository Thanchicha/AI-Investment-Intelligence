import test from "node:test";
import assert from "node:assert/strict";
import {
  isSafePublicArticleUrl,
  extractArticleText,
  selectSourceEvidence,
  buildArticleSummaryInput,
} from "../supabase/functions/_shared/article-content.js";
import { SUPPORTED_COMPANIES } from "../supabase/functions/_shared/news-rules.js";

const longParagraph = (subject, detail) =>
  `${subject} ${detail} This paragraph contains confirmed public reporting and enough context to remain meaningful after deterministic cleanup.`;

test("accepts ordinary HTTP(S) publisher URLs", () => {
  assert.equal(isSafePublicArticleUrl("https://news.example.com/markets/story?id=42"), true);
  assert.equal(isSafePublicArticleUrl("http://publisher.example.org:8080/article"), true);
  assert.equal(isSafePublicArticleUrl("https://203.0.114.1/article"), true);
});

test("rejects malformed, credentialed, local, and non-HTTP URLs", () => {
  for (const url of [
    "not a url",
    "ftp://news.example.com/story",
    "https://user:secret@news.example.com/story",
    "http://localhost/story",
    "http://news.localhost/story",
    "http://machine.local/story",
    "https://example.com\\@127.0.0.1/story",
  ]) {
    assert.equal(isSafePublicArticleUrl(url), false, url);
  }
});

test("rejects private, loopback, link-local, and reserved IP literals", () => {
  for (const url of [
    "http://127.0.0.1/story",
    "http://10.1.2.3/story",
    "http://169.254.10.20/story",
    "http://172.20.1.1/story",
    "http://192.168.1.1/story",
    "http://100.64.1.2/story",
    "http://192.0.2.1/story",
    "http://224.0.0.1/story",
    "http://[::1]/story",
    "http://[::ffff:127.0.0.1]/story",
    "http://[fc00::1]/story",
    "http://[fe80::1]/story",
    "http://[fec0::1]/story",
    "http://[2001:db8::1]/story",
  ]) {
    assert.equal(isSafePublicArticleUrl(url), false, url);
  }
  assert.equal(isSafePublicArticleUrl("https://[2606:4700:4700::1111]/story"), true);
});

test("rejects IPv4-compatible, translation, benchmark, and other reserved IPv6 literals", () => {
  for (const url of [
    "http://[1::1]/story",
    "http://[::2]/story",
    "http://[::127.0.0.1]/story",
    "http://[2001:2::1]/story",
    "http://[64:ff9b:1::a00:1]/story",
    "http://[4000::1]/story",
    "http://[f000::1]/story",
  ]) {
    assert.equal(isSafePublicArticleUrl(url), false, url);
  }

  assert.equal(isSafePublicArticleUrl("https://[2001:4860:4860::8888]/story"), true);
  assert.equal(isSafePublicArticleUrl("https://[2606:4700:4700::1111]/story"), true);
});

test("rejects malformed domain labels and localhost-like trailing-dot spellings", () => {
  for (const url of [
    "http://localhost../story",
    "https://news..example.com/story",
    "https://-news.example.com/story",
    "https://news-.example.com/story",
    "https://news_example.com/story",
  ]) {
    assert.equal(isSafePublicArticleUrl(url), false, url);
  }

  assert.equal(isSafePublicArticleUrl("https://news.example.com./story"), true);
});

test("extracts JSON-LD articleBody before other page content", () => {
  const first = longParagraph("NVIDIA reported revenue growth of 18%.", "The filing was released on September 4, 2026.");
  const second = longParagraph("Microsoft expanded its Azure agreement.", "Executives said the rollout starts this quarter.");
  const html = `
    <article><p>${longParagraph("Wrong article copy.", "It must lose to structured article data.")}</p><p>${longParagraph("Wrong second paragraph.", "It is only a semantic fallback.")}</p></article>
    <script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", articleBody: `${first}\n\n${second}` })}</script>`;

  const text = extractArticleText(html);
  assert.match(text, /NVIDIA reported revenue growth/);
  assert.match(text, /Microsoft expanded its Azure agreement/);
  assert.equal(text.includes("Wrong article copy"), false);
});

test("parses JSON-LD before decoding articleBody entities", () => {
  const first = longParagraph("NVIDIA said &quot;demand remains strong&quot;.", "The company reported only confirmed sales information.");
  const second = longParagraph("Revenue was $9.2 billion for the period.", "Management published the result with its scheduled filing.");
  const html = `<script type="application/ld+json">${JSON.stringify({ articleBody: `${first}\n\n${second}` })}</script>`;

  const text = extractArticleText(html);
  assert.match(text, /NVIDIA said “?"?demand remains strong/);
  assert.match(text, /\$9\.2 billion/);
});

test("rejects paragraphs that occur inside an unterminated raw-text element", () => {
  const first = longParagraph("NVIDIA reported revenue of $99 billion.", "This string is JavaScript data rather than readable page copy.");
  const second = longParagraph("Microsoft announced a 40% increase.", "This second string remains inside the same malformed script element.");
  const result = buildArticleSummaryInput({
    title: "Market update",
    rssExcerpt: "The RSS feed contains only a limited market update.",
    html: `<script>window.payload = 'not readable';<p>${first}</p><p>${second}</p>`,
    companies: SUPPORTED_COMPANIES,
  });

  assert.equal(result.contentScope, "rss_excerpt");
  assert.equal(result.contentStatus, "fallback");
  assert.equal(result.uncertaintyCode, "rss_malformed_article");
  assert.equal(result.entities.includes("NVIDIA"), false);
  assert.equal(result.keyNumbers.some((number) => number.value === "$99 billion"), false);
});

test("sanitizes style and script markup from every JSON-LD articleBody branch", () => {
  const first = longParagraph("Microsoft expanded Azure availability.", "The company described regions included in the confirmed rollout.");
  const second = longParagraph("Customers can use the service this month.", "The report made no claim about unrelated companies or forecasts.");
  const body = [
    "<style>NVIDIA reported fictional revenue of $99 billion in stylesheet content.</style>",
    "<script>Apple announced a fictional 80% increase in script content.</script>",
    first,
    second,
  ].join("\n\n");
  const result = buildArticleSummaryInput({
    title: "Microsoft expands Azure availability",
    rssExcerpt: "An unrelated RSS excerpt.",
    html: `<script type="application/ld+json">${JSON.stringify({ articleBody: body }).replaceAll("<", "\\u003c")}</script>`,
    companies: SUPPORTED_COMPANIES,
  });

  assert.equal(result.contentScope, "publisher_article");
  assert.deepEqual(result.entities, ["Microsoft", "Azure"]);
  assert.equal(result.keyNumbers.some((number) => number.value === "$99 billion" || number.value === "80%"), false);
  assert.ok(result.evidence.every((fragment) => !/stylesheet|script content|NVIDIA|Apple/.test(fragment.text)));
});

test("extracts meaningful paragraphs from the semantic article element", () => {
  const first = longParagraph("Apple launched an updated service.", "The release reaches customers in Thailand this month.");
  const second = longParagraph("The company also published pricing details.", "No forecast beyond the announcement was provided.");
  const html = `<nav>Home Markets Subscribe</nav><article><h1>Headline</h1><p>${first}</p><p>${second}</p></article><footer>Privacy</footer>`;

  assert.equal(extractArticleText(html), `${first}\n\n${second}`);
});

test("falls back to cleaned page paragraphs when structured article content is absent", () => {
  const first = longParagraph("Amazon opened a new logistics facility.", "The company gave an opening date of September 8, 2026.");
  const second = longParagraph("The facility will employ 2,000 people.", "The report did not provide a profit estimate.");
  const html = `<main><p>${first}</p><div>advertisement</div><p>${second}</p></main>`;

  assert.equal(extractArticleText(html), `${first}\n\n${second}`);
});

test("removes unsafe markup, boilerplate, and repeated fragments", () => {
  const first = longParagraph("Tesla delivered a product update.", "The announcement described the currently available features.");
  const second = longParagraph("Customers can order the product today.", "The publisher reported only confirmed availability.");
  const html = `<article>
    <script>window.secret = "do not retain"</script><style>.hidden{display:none}</style>
    <nav><p>Home Markets Account</p></nav><p>Subscribe to our newsletter</p>
    <p>${first}</p><p>${first}</p><p>${second}</p><p>Cookie preferences</p>
  </article>`;

  const text = extractArticleText(html);
  assert.equal(text, `${first}\n\n${second}`);
  assert.equal(text.includes("window.secret"), false);
  assert.equal(text.match(/Tesla delivered/g)?.length, 1);
});

test("cookie-consent prose alone cannot qualify as article content", () => {
  const first = "We use cookies and similar technologies to personalise content and advertisements, provide social media features and analyse our traffic.";
  const second = "By clicking Accept all cookies you agree to the storing of cookies on your device to enhance site navigation, analyse site usage and assist in our marketing efforts.";
  const result = buildArticleSummaryInput({
    title: "Publisher page",
    rssExcerpt: "The RSS feed contains a limited publisher update.",
    html: `<main><p>${first}</p><p>${second}</p></main>`,
    companies: SUPPORTED_COMPANIES,
  });

  assert.equal(result.contentScope, "rss_excerpt");
  assert.equal(result.contentStatus, "fallback");
  assert.equal(result.uncertaintyCode, "rss_insufficient_article");
  assert.ok(result.evidence.every((fragment) => !/cookies|advertisements|marketing efforts/i.test(fragment.text)));
});

test("mixed article content keeps reporting and drops full consent notices", () => {
  const consentOne = "We use cookies and similar technologies to personalise content and advertisements, provide social media features and analyse our traffic.";
  const consentTwo = "By clicking Accept all cookies you agree to the storing of cookies on your device to enhance site navigation, analyse site usage and assist in our marketing efforts.";
  const first = longParagraph("Amazon opened a new logistics facility.", "The company confirmed the location and opening schedule in its announcement.");
  const second = longParagraph("The facility begins operating this month.", "The publisher did not report an earnings forecast or investment recommendation.");
  const html = `<article><p>${consentOne}</p><p>${first}</p><p>${consentTwo}</p><p>${second}</p></article>`;
  const result = buildArticleSummaryInput({
    title: "Amazon opens a logistics facility",
    rssExcerpt: "A limited RSS excerpt.",
    html,
    companies: SUPPORTED_COMPANIES,
  });

  assert.equal(extractArticleText(html), `${first}\n\n${second}`);
  assert.equal(result.contentScope, "publisher_article");
  assert.ok(result.evidence.every((fragment) => !/cookies|advertisements|marketing efforts/i.test(fragment.text)));
});

test("falls back to RSS with explicit limitation codes for insufficient and paywalled pages", () => {
  const insufficient = buildArticleSummaryInput({
    title: "Microsoft announces a cloud update",
    rssExcerpt: "Microsoft said Azure revenue rose 12% in the latest report.",
    html: "<article><p>Too short.</p></article>",
    companies: SUPPORTED_COMPANIES,
  });
  assert.equal(insufficient.contentScope, "rss_excerpt");
  assert.equal(insufficient.contentStatus, "fallback");
  assert.equal(insufficient.uncertaintyCode, "rss_insufficient_article");
  assert.ok(insufficient.evidence.every((fragment) => !fragment.text.includes("Too short")));

  const paywall = buildArticleSummaryInput({
    title: "Apple reports product launch",
    rssExcerpt: "Apple launched the service on September 4, 2026.",
    html: "<html><body><p>Subscribe to continue reading this article.</p><p>Already a subscriber? Sign in to read.</p></body></html>",
    companies: SUPPORTED_COMPANIES,
  });
  assert.equal(paywall.contentScope, "rss_excerpt");
  assert.equal(paywall.contentStatus, "fallback");
  assert.equal(paywall.uncertaintyCode, "rss_paywall_or_restricted");
});

test("restriction UI vetoes otherwise qualifying structured and semantic article content", () => {
  const first = longParagraph("NVIDIA reported quarterly results.", "The public filing described revenue and operating performance.");
  const second = longParagraph("Management announced its current outlook.", "The article otherwise contains enough readable publisher content.");
  const structured = `<script type="application/ld+json">${JSON.stringify({ articleBody: `${first}\n\n${second}` })}</script>`;
  const semantic = `<article><p>${first}</p><p>${second}</p></article>`;
  const pages = [
    `${structured}<dialog open>Subscribe to continue reading this article.</dialog>`,
    `${semantic}<aside>Already a subscriber? Sign in to read.</aside>`,
    `${semantic}<form>Register to continue reading.</form>`,
  ];

  for (const html of pages) {
    const result = buildArticleSummaryInput({
      title: "NVIDIA quarterly update",
      rssExcerpt: "The RSS excerpt provides a limited NVIDIA update.",
      html,
      companies: SUPPORTED_COMPANIES,
    });
    assert.equal(result.contentScope, "rss_excerpt");
    assert.equal(result.contentStatus, "fallback");
    assert.equal(result.uncertaintyCode, "rss_paywall_or_restricted");
  }
});

test("handles malformed and empty article input without throwing", () => {
  const malformed = buildArticleSummaryInput({
    title: "Meta update",
    rssExcerpt: "Meta announced an update.",
    html: { unexpected: true },
    companies: SUPPORTED_COMPANIES,
  });
  const empty = buildArticleSummaryInput({
    title: "Meta update",
    rssExcerpt: "Meta announced an update.",
    html: "",
    companies: SUPPORTED_COMPANIES,
  });

  assert.equal(extractArticleText(null), "");
  assert.equal(extractArticleText("<not-closed><script>bad()"), "");
  assert.equal(malformed.uncertaintyCode, "rss_malformed_article");
  assert.equal(empty.uncertaintyCode, "rss_empty_article");
});

test("selects at most three source fragments of at most 200 characters", () => {
  const veryLong = `NVIDIA announced revenue of $30 billion on September 4, 2026, ${"with confirmed operational detail ".repeat(12)}`;
  const evidence = selectSourceEvidence({
    title: "NVIDIA announces revenue",
    text: `${veryLong}. Microsoft expanded Azure capacity by 15%. Apple released a product. Meta announced another service.`,
    companies: SUPPORTED_COMPANIES,
    maxFragments: 99,
  });

  assert.ok(evidence.length > 0 && evidence.length <= 3);
  assert.ok(evidence.every((fragment) => typeof fragment.text === "string" && fragment.text.length <= 200));
});

test("ranks headline-relevant factual evidence ahead of incidental prose", () => {
  const evidence = selectSourceEvidence({
    title: "NVIDIA revenue rises 18%",
    text: "The weather was calm outside the office. NVIDIA reported that revenue rose 18% on September 4, 2026. Staff later left the building.",
    companies: SUPPORTED_COMPANIES,
    maxFragments: 1,
  });

  assert.match(evidence[0].text, /NVIDIA.*18%/);
});

test("keeps decimal numeric phrases intact in evidence and returns unique entities", () => {
  const evidence = selectSourceEvidence({
    title: "NVIDIA reports quarterly revenue",
    text: "NVIDIA reported quarterly revenue of $9.2 billion. NVIDIA executives announced the result.",
    companies: SUPPORTED_COMPANIES,
    maxFragments: 1,
  });
  const result = buildArticleSummaryInput({
    title: "NVIDIA reports quarterly revenue",
    rssExcerpt: "NVIDIA reported quarterly revenue of $9.2 billion.",
    html: "",
    companies: SUPPORTED_COMPANIES,
  });

  assert.match(evidence[0].text, /\$9\.2 billion/);
  assert.deepEqual(result.entities, ["NVIDIA"]);
});

test("publisher summary metadata is grounded only in extracted source text", () => {
  const first = longParagraph("NVIDIA reported revenue of $30 billion.", "The result was published on September 4, 2026.");
  const second = longParagraph("Microsoft expanded Azure capacity by 15%.", "The announcement gave no estimate for Apple or Tesla.");
  const result = buildArticleSummaryInput({
    title: "NVIDIA and Microsoft publish AI infrastructure update",
    rssExcerpt: "Amazon expects revenue of $99 billion, according to an unrelated feed excerpt.",
    html: `<article><p>${first}</p><p>${second}</p></article>`,
    companies: SUPPORTED_COMPANIES,
  });

  assert.equal(result.contentScope, "publisher_article");
  assert.equal(result.contentStatus, "extracted");
  assert.equal(result.uncertaintyCode, null);
  assert.ok(result.entities.includes("NVIDIA"));
  assert.ok(result.entities.includes("Microsoft"));
  assert.equal(result.entities.includes("Amazon"), false);
  assert.ok(result.keyNumbers.some((number) => number.value === "$30 billion"));
  assert.ok(result.keyNumbers.some((number) => number.value === "15%"));
  assert.equal(result.keyNumbers.some((number) => number.value === "$99 billion"), false);
  assert.ok(result.entities.every((entity) => `${result.evidence.map((row) => row.text).join(" ")} ${first} ${second} NVIDIA Microsoft`.includes(entity)));
});

test("RSS fallback entities and numbers are grounded in RSS metadata", () => {
  const result = buildArticleSummaryInput({
    title: "Google Cloud expands capacity",
    rssExcerpt: "Google said capacity increased 10% on September 5, 2026.",
    html: "",
    companies: SUPPORTED_COMPANIES,
  });

  assert.deepEqual(result.entities, ["Google Cloud", "Google"]);
  assert.ok(result.keyNumbers.some((number) => number.value === "10%"));
  assert.equal(result.entities.includes("Alphabet"), false);
  assert.equal(result.keyNumbers.some((number) => number.value === "12%"), false);
});

test("honors the supplied supported-company subset and ignores unsupported definitions", () => {
  const result = buildArticleSummaryInput({
    title: "NVIDIA, Microsoft, and OpenAI publish updates",
    rssExcerpt: "NVIDIA reported the first update, Microsoft reported the second, and OpenAI reported the third.",
    html: "",
    companies: [
      SUPPORTED_COMPANIES.find((company) => company.ticker === "NVDA"),
      { ticker: "FAKE", aliases: ["OpenAI"] },
    ],
  });

  assert.deepEqual(result.entities, ["NVIDIA"]);
});
