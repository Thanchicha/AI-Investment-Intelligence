import { articleReadingModel, articleRouteId, articlesForHoldings, latestPriceSnapshot, relatedHeldCompanies } from "./supabase/functions/_shared/news-rules.js";

const config = window.LONGVIEW_CONFIG || {};
const configured = Boolean(config.supabaseUrl && config.supabasePublishableKey && window.supabase);
const db = configured ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey) : null;
const localMode = !configured;

const colors = { GOOGL: "#3d6ea8", NVDA: "#4f8a51", MSFT: "#6d748d", AAPL: "#4e5961", AMZN: "#866338", META: "#496e96" };
const metricLabels = { revenue: "รายได้", net_income: "กำไรสุทธิ", diluted_eps: "EPS ปรับลด" };
const state = { session: null, companies: [], holdings: [], facts: [], sources: [], prices: [], events: [], news: [], newsLinks: [], newsSync: null, loading: true, error: null };

const app = document.querySelector("#app");
const dialog = document.querySelector("#stockDialog");
const tickerSelect = document.querySelector("#tickerSelect");
const toast = document.querySelector("#toast");

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

const newsImageIcons = { earnings: "▥", ai_cloud: "✦", regulation: "⚖", core_business: "◈", company: "◎" };

function newsCategoryMarkup(image) {
  if (!image) return "";
  return `<span class="news-category-card news-category-${esc(image.category)}"><span class="news-image-icon" aria-hidden="true">${newsImageIcons[image.category] || newsImageIcons.company}</span><strong>${esc(image.label)}</strong></span>`;
}

function formatMoney(value, unit) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (unit === "USD/shares") return `$${number.toFixed(2)}`;
  const abs = Math.abs(number);
  if (abs >= 1e12) return `$${(number / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(number / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(number / 1e6).toFixed(1)}M`;
  return `$${number.toLocaleString("en-US")}`;
}

function companyLogo(company, tiny = false) {
  const ticker = company.ticker;
  return `<span class="${tiny ? "tiny-logo" : "ticker-logo"}" style="background:${colors[ticker] || "#355f50"}">${esc(ticker.slice(0, 2))}</span>`;
}

function latestFacts(companyId, preferredForm = null) {
  const rows = state.facts.filter(f => f.company_id === companyId && (!preferredForm || f.form === preferredForm));
  const result = {};
  for (const metric of Object.keys(metricLabels)) {
    const candidates = rows.filter(f => f.metric === metric).sort((a, b) => b.period_end.localeCompare(a.period_end) || b.filed_at.localeCompare(a.filed_at));
    if (candidates[0]) result[metric] = candidates[0];
  }
  return result;
}

function sourceFor(fact) {
  return fact ? state.sources.find(source => source.id === fact.source_document_id) : null;
}

function statusFor(company) {
  const facts = latestFacts(company.id, "10-K");
  const revenueRows = state.facts.filter(f => f.company_id === company.id && f.metric === "revenue" && f.form === "10-K")
    .sort((a, b) => b.period_end.localeCompare(a.period_end));
  if (!facts.revenue || revenueRows.length < 2) return { key: "stable", label: "รอข้อมูลเพิ่ม", note: "ยังมีข้อมูลไม่พอสำหรับเปรียบเทียบแนวโน้ม" };
  const growth = (Number(revenueRows[0].value) - Number(revenueRows[1].value)) / Math.abs(Number(revenueRows[1].value));
  if (growth >= .1) return { key: "improving", label: "กำลังเติบโต", note: `รายได้ปีล่าสุดเพิ่มขึ้น ${new Intl.NumberFormat("th-TH", { style: "percent", maximumFractionDigits: 1 }).format(growth)} จากปีก่อน` };
  if (growth < 0) return { key: "attention", label: "ควรติดตาม", note: `รายได้ปีล่าสุดลดลง ${new Intl.NumberFormat("th-TH", { style: "percent", maximumFractionDigits: 1 }).format(Math.abs(growth))} จากปีก่อน` };
  return { key: "stable", label: "ค่อนข้างมั่นคง", note: "รายได้ปีล่าสุดเปลี่ยนแปลงไม่เกิน 10% จากปีก่อน" };
}

function growthFor(companyId) {
  const rows = state.facts.filter(f => f.company_id === companyId && f.metric === "revenue" && f.form === "10-K")
    .sort((a, b) => b.period_end.localeCompare(a.period_end));
  if (rows.length < 2 || Number(rows[1].value) === 0) return null;
  return (Number(rows[0].value) - Number(rows[1].value)) / Math.abs(Number(rows[1].value));
}

function badge(status) { return `<span class="badge ${status.key}">${esc(status.label)}</span>`; }
function holdingCompanies() { return state.holdings.map(h => state.companies.find(c => c.id === h.company_id)).filter(Boolean); }
function holdingIds() { return state.holdings.map(holding => holding.company_id); }
function portfolioNews() { return articlesForHoldings(state.news, state.newsLinks, holdingIds()); }

function loadingView(message = "กำลังโหลดข้อมูลจาก Supabase…") {
  app.innerHTML = `<div class="page"><div class="empty-state"><span class="live-dot" style="display:inline-block;margin-right:10px"></span>${message}</div></div>`;
}

function setupView() {
  app.innerHTML = `<div class="page">
    <div class="company-hero"><span class="eyebrow" style="color:#9bc9b4">SETUP REQUIRED</span><h1>เชื่อมต่อ Supabase เพื่อเริ่มใช้ข้อมูลจริง</h1><p style="color:#c5d9d0;max-width:650px">เว็บถูกเปลี่ยนเป็น Supabase + SEC EDGAR แล้ว และจะไม่แสดงตัวเลขจำลองเมื่อยังไม่ได้ตั้งค่า</p></div>
    <div class="content-grid"><section class="panel"><h2>ขั้นตอนเปิดใช้งาน</h2><ol class="prose">
      <li>สร้าง Supabase project และเปิด Anonymous Sign-ins</li>
      <li>ใส่ Project URL และ Publishable key ใน <code>config.js</code></li>
      <li>รัน migration ในโฟลเดอร์ <code>supabase/migrations</code></li>
      <li>ตั้งค่า Edge Function secrets แล้ว deploy <code>ingest-sec</code></li>
      <li>เรียกฟังก์ชันหนึ่งครั้งเพื่อดึงงบจาก SEC</li>
    </ol></section><aside class="panel"><span class="eyebrow">SECURITY</span><h2>ข้อมูลลับอยู่ที่ไหน</h2><p class="prose">หน้าเว็บใช้เฉพาะ publishable key ที่ทำงานร่วมกับ RLS ส่วน service-role และรหัส ingestion จะอยู่ใน Edge Function เท่านั้น</p><div class="source-card">ดูคำสั่งแบบละเอียดใน README.md</div></aside></div>
  </div>`;
}

function errorView() {
  app.innerHTML = `<div class="page"><div class="empty-state"><h2>เชื่อมต่อข้อมูลไม่สำเร็จ</h2><p>${esc(state.error || "Unknown error")}</p><button class="primary-button" onclick="loadData()">ลองอีกครั้ง</button></div></div>`;
}

function pageHeader(eyebrow, title, copy) {
  const newsContext = eyebrow.includes("NEWS");
  const latest = newsContext ? state.newsSync?.finished_at : state.companies.map(c => c.last_sec_sync_at).filter(Boolean).sort().pop();
  const asOf = latest ? new Date(latest).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : newsContext ? "กำลังรอรอบแรก" : "ยังไม่เคยซิงก์ SEC";
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${copy}</p></div><span class="as-of">${newsContext ? "อัปเดตข่าว" : "ข้อมูล SEC"} · ${esc(asOf)}</span></div>`;
}

function firstStockPrompt() {
  return `<div class="empty-state first-stock-prompt"><span class="eyebrow">FIRST STEP</span><h2>เริ่มติดตามหุ้นตัวแรกของคุณ</h2><p>เลือกหุ้นที่สนใจ แล้ว Longview จะรวมข่าวและข้อมูลสำคัญของหุ้นนั้นไว้ให้</p><button class="primary-button" onclick="openStockDialog()">＋ เพิ่มหุ้นตัวแรก</button></div>`;
}

function portfolioRows() {
  const companies = holdingCompanies();
  if (!companies.length) return firstStockPrompt();
  return companies.map(company => {
    const facts = latestFacts(company.id, "10-K");
    const growth = growthFor(company.id);
    const status = statusFor(company);
    return `<div class="company-row" onclick="location.hash='company/${esc(company.ticker)}'">
      <div class="company-name">${companyLogo(company)}<div><strong>${esc(company.ticker)}</strong><small>${esc(company.legal_name)}</small></div></div>
      <div class="metric"><small>รายได้ปีล่าสุด</small><strong>${formatMoney(facts.revenue?.value, facts.revenue?.unit)}</strong></div>
      <div class="metric"><small>เติบโต YoY</small><strong class="${growth !== null && growth < 0 ? "trend-down" : "trend-up"}">${growth === null ? "—" : new Intl.NumberFormat("th-TH", { style: "percent", maximumFractionDigits: 1, signDisplay: "always" }).format(growth)}</strong></div>
      <div>${badge(status)}</div><span class="chevron">›</span>
    </div>`;
  }).join("");
}

const companyAliases = {
  GOOGL: ["google", "alphabet", "googl", "youtube", "gemini"],
  NVDA: ["nvidia", "nvda", "geforce", "cuda"],
  MSFT: ["microsoft", "msft", "azure", "copilot"],
  AAPL: ["apple", "aapl", "iphone", "macbook"],
  AMZN: ["amazon", "amzn", "aws"],
  META: ["meta", "facebook", "instagram", "whatsapp"]
};

function analyzeNews(article) {
  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  const related = relatedHeldCompanies(article.id, state.newsLinks, holdingIds(), state.companies);
  const primary = related[0] || null;

  const riskTerms = ["antitrust", "lawsuit", "decline", "drop", "slowing", "shrink", "loss", "fine", "ban", "investigation", "competition", "pressure", "risk", "sell", "collapse", "cut", "weaken"];
  const positiveTerms = ["growth", "win", "approval", "partnership", "expand", "record", "beat", "profit", "launch", "contract", "validation", "benefit"];
  const riskHits = riskTerms.filter(term => text.includes(term));
  const positiveHits = positiveTerms.filter(term => text.includes(term));
  const primaryAliases = primary ? (companyAliases[primary.ticker] || [primary.ticker.toLowerCase()]) : [];
  const titleMentionsPrimary = primaryAliases.some(alias => (article.title || "").toLowerCase().includes(alias));
  const score = titleMentionsPrimary ? Math.max(-2, Math.min(2, riskHits.length - positiveHits.length)) : 0;
  const impact = score > 0
    ? { key: "increase", label: "เพิ่มความเสี่ยง", headline: "สมมติฐานการลงทุนถูกกดดัน", reason: "ข่าวมีสัญญาณด้านการแข่งขัน กฎหมาย หรือการชะลอตัว ซึ่งอาจกระทบรายได้ ต้นทุน หรือความเชื่อมั่น" }
    : score < 0
      ? { key: "decrease", label: "ลดความเสี่ยง", headline: "มีหลักฐานสนับสนุนโอกาสเติบโต", reason: "ข่าวมีสัญญาณด้านการเติบโต ความร่วมมือ หรือความสำเร็จทางธุรกิจ ซึ่งช่วยเพิ่มความแข็งแรงของสมมติฐานระยะยาว" }
      : { key: "monitor", label: "ผลกระทบยังไม่ชัด", headline: "ควรติดตามหลักฐานเพิ่มเติม", reason: "ข่าวยังไม่มีสัญญาณบวกหรือลบที่แรงพอ และอาจเป็นเพียงเหตุการณ์ระยะสั้น" };
  const nextStep = score > 0
    ? "ยังไม่ควรรีบตัดสินใจจากพาดหัว ให้ตรวจว่างบไตรมาสถัดไปยืนยันผลกระทบต่อรายได้ อัตรากำไร หรือส่วนแบ่งตลาดหรือไม่"
    : score < 0
      ? "ตรวจว่าข่าวนี้สร้างรายได้หรือกำไรที่วัดผลได้จริงหรือยัง ก่อนเพิ่มน้ำหนักการลงทุน และเปรียบเทียบมูลค่าหุ้นกับการเติบโตที่คาดหวัง"
      : "เก็บไว้ในรายการติดตาม แล้วรอข้อมูลจากงบ บริษัท หรือหน่วยงานกำกับดูแลที่ยืนยันผลกระทบเชิงตัวเลข";
  return { ...impact, score, related, nextStep, evidence: [...riskHits, ...positiveHits].slice(0, 4) };
}

function newsAnalysisCards(limit = 8, articles = portfolioNews()) {
  const categoryLabels = { earnings: "งบและคาดการณ์", ai_cloud: "AI และ Cloud", regulation: "กฎหมาย", core_business: "ธุรกิจหลัก", company: "บริษัท" };
  if (!articles.length) {
    if (!holdingIds().length) return firstStockPrompt();
    return `<div class="empty-state"><h3>ยังไม่มีข่าวล่าสุดสำหรับหุ้นที่คุณติดตาม</h3></div>`;
  }
  return articles.slice(0, limit).map(article => {
    const model = articleReadingModel(article, state.newsLinks, holdingIds(), state.companies);
    if (!model) return "";
    const related = model.relatedCompanies.map(company => `<a class="ticker-pill" href="#company/${esc(company.ticker)}">${esc(company.ticker)}</a>`).join("");
    return `<article class="analysis-card news-card">
      <div class="analysis-card-top"><div class="news-meta">${newsCategoryMarkup(model.image)}<span>${esc(model.publisher)}</span><span>·</span><time datetime="${esc(model.publishedAt || "")}">${model.publishedAt ? new Date(model.publishedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "ไม่ระบุเวลา"}</time></div><span class="scope-badge">${esc(model.scope.label)}</span></div>
      <h2><a href="#news/${encodeURIComponent(model.id)}">${esc(model.title)}</a></h2>
      <p class="article-summary">${esc(model.whatHappened)}</p>
      <div class="related-row"><strong>เกี่ยวข้องกับพอร์ต</strong><div>${related}</div></div>
      <a class="reader-link" href="#news/${encodeURIComponent(model.id)}">อ่านสรุปภาษาไทยและแหล่งอ้างอิง →</a>
    </article>`;
  }).join("");
}

function dashboard() {
  const companies = holdingCompanies();
  if (!companies.length) {
    app.innerHTML = `<div class="page">${pageHeader("PORTFOLIO NEWS INTELLIGENCE", "เริ่มสร้างพอร์ตข่าวของคุณ", "เพิ่มหุ้นตัวแรกเพื่อรับสรุปข่าวภาษาไทยและติดตามข้อมูลสำคัญของบริษัทนั้น")}${firstStockPrompt()}</div>`;
    return;
  }
  const articles = portfolioNews();
  const analyzed = articles.map(analyzeNews);
  const increased = analyzed.filter(item => item.key === "increase").length;
  const impacted = new Set(analyzed.flatMap(item => item.related.map(company => company.ticker)));
  const latest = state.newsSync?.finished_at ? new Date(state.newsSync.finished_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "กำลังรอรอบแรก";
  app.innerHTML = `<div class="page">
    ${pageHeader("PORTFOLIO NEWS INTELLIGENCE", "วันนี้มีอะไรเปลี่ยนความเสี่ยงในพอร์ต", "ข่าวล่าสุดพร้อมวิเคราะห์ความเกี่ยวข้อง ผลกระทบต่อความเสี่ยง และประเด็นที่ควรตรวจสอบก่อนตัดสินใจ")}
    <div class="summary-grid">
      <div class="summary-card"><div class="label">ข่าวที่วิเคราะห์ <span class="mini-icon">◉</span></div><div class="value">${articles.length}</div><div class="detail">อัปเดตล่าสุด ${esc(latest)}</div></div>
      <div class="summary-card"><div class="label">สัญญาณเพิ่มความเสี่ยง <span class="mini-icon">!</span></div><div class="value">${increased}</div><div class="detail">ควรเปิดอ่านหลักฐานและติดตามตัวเลขยืนยัน</div></div>
      <div class="summary-card"><div class="label">หุ้นในพอร์ตที่เกี่ยวข้อง <span class="mini-icon">◫</span></div><div class="value">${impacted.size}/${companies.length}</div><div class="detail">จับคู่จากบริษัท ผลิตภัณฑ์ และธุรกิจที่กล่าวถึง</div></div>
    </div>
    <div class="intelligence-layout"><div class="analysis-feed"><div class="section-title"><div><span class="eyebrow">LATEST ANALYSIS</span><h2>ข่าวที่กระทบพอร์ตล่าสุด</h2></div><a class="text-link" href="#news">ดูข่าวทั้งหมด →</a></div>${newsAnalysisCards(6, articles)}</div>
      <aside class="panel risk-radar"><span class="eyebrow">PORTFOLIO RADAR</span><h2>หุ้นที่ข่าวกำลังกล่าวถึง</h2><div class="radar-list">${companies.map(company => { const count = analyzed.filter(item => item.related.some(row => row.id === company.id)).length; const risk = analyzed.filter(item => item.key === "increase" && item.related.some(row => row.id === company.id)).length; return `<a href="#company/${esc(company.ticker)}" class="radar-item"><div>${companyLogo(company, true)}<strong>${esc(company.ticker)}</strong></div><span>${count} ข่าว · ${risk} เสี่ยงเพิ่ม</span></a>`; }).join("")}</div><div class="source-card">สัญญาณข่าวเป็นจุดเริ่มต้นของการค้นคว้า ควรยืนยันกับงบ SEC และแหล่งข่าวต้นฉบับเสมอ</div></aside>
    </div>
  </div>`;
}

function filingList(filings) {
  if (!filings.length) return `<div class="empty-state">ยังไม่มีเอกสาร SEC ในฐานข้อมูล<br>${localMode ? "กดปุ่มซิงก์ข้อมูลจาก SEC เพื่อเริ่มต้น" : "เรียก Edge Function ingest-sec เพื่อซิงก์ครั้งแรก"}</div>`;
  return `<div class="reference-list">${filings.map(f => {
    const company = state.companies.find(c => c.id === f.company_id);
    const insight = filingInsight(f);
    return `<details class="reference-card"><summary><span class="importance ${f.form === "10-K" ? "high" : "medium"}"></span><div class="reference-heading"><div class="news-meta"><span class="topic">${esc(f.form)}</span><span>${esc(company?.ticker || "")}</span><span>·</span><span>ยื่น ${new Date(f.filed_at).toLocaleDateString("th-TH")}</span></div><h3>${esc(f.title)}</h3><p>${esc(insight.intro)}</p></div><span class="expand-icon">⌄</span></summary><div class="reference-body"><div class="reference-summary"><span class="eyebrow">สรุปเบื้องต้น</span><p>${esc(insight.summary)}</p></div><div><span class="eyebrow">ตัวเลขสำคัญในอ้างอิงนี้</span>${insight.items.length ? `<ul class="key-facts">${insight.items.map(item => `<li><span>${esc(item.label)}</span><strong>${esc(item.value)}</strong></li>`).join("")}</ul>` : `<p class="prose">ไม่มี financial facts ที่ระบบเลือกไว้จากเอกสารฉบับนี้</p>`}</div><div class="why-important"><strong>ทำไมเอกสารนี้สำคัญ</strong><p>${esc(insight.important)}</p></div><div class="reference-footer"><span>สรุปจาก SEC XBRL facts · ยังไม่ครอบคลุมข้อความทุกส่วนในเอกสาร</span><a href="${esc(f.original_url)}" target="_blank" rel="noopener noreferrer">เปิดต้นฉบับบน SEC ↗</a></div></div></details>`;
  }).join("")}</div>`;
}

function filingInsight(filing) {
  const type = filing.form === "10-K" ? "รายงานประจำปี" : "รายงานรายไตรมาส";
  const facts = state.facts.filter(fact => fact.source_document_id === filing.id);
  const latestEnd = facts.map(fact => fact.period_end).sort().at(-1);
  const periodFacts = facts.filter(fact => fact.period_end === latestEnd);
  const items = Object.keys(metricLabels).map(metric => periodFacts.find(fact => fact.metric === metric)).filter(Boolean)
    .map(fact => ({ label: metricLabels[fact.metric] || fact.metric, value: formatMoney(fact.value, fact.unit) }));
  const periodText = latestEnd ? new Date(latestEnd).toLocaleDateString("th-TH", { day:"numeric", month:"short", year:"numeric" }) : null;
  const revenue = periodFacts.find(fact => fact.metric === "revenue");
  let comparison = null;
  if (revenue) {
    const duration = revenue.period_start ? new Date(revenue.period_end) - new Date(revenue.period_start) : null;
    const candidates = state.facts.filter(fact => fact.company_id === revenue.company_id && fact.metric === "revenue" && fact.form === revenue.form && fact.period_end < revenue.period_end && fact.period_start);
    const comparable = candidates.filter(fact => {
      const gap = (new Date(revenue.period_end) - new Date(fact.period_end)) / 86400000;
      const otherDuration = new Date(fact.period_end) - new Date(fact.period_start);
      return gap >= 330 && gap <= 400 && (duration === null || Math.abs(otherDuration - duration) <= 15 * 86400000);
    }).sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
    if (comparable && Number(comparable.value) !== 0) comparison = (Number(revenue.value) - Number(comparable.value)) / Math.abs(Number(comparable.value));
  }
  const intro = `${type}${periodText ? ` ครอบคลุมงวดสิ้นสุด ${periodText}` : ""}`;
  const summary = filing.form === "10-K"
    ? `เอกสารหลักสำหรับทำความเข้าใจผลประกอบการทั้งปี ธุรกิจ ความเสี่ยง และฐานะการเงินของบริษัท${periodText ? ` ณ งวด ${periodText}` : ""}`
    : `เอกสารอัปเดตผลประกอบการระหว่างปี ใช้ดูว่ารายได้ กำไร และความเสี่ยงเปลี่ยนจากรายงานประจำปีล่าสุดอย่างไร${periodText ? ` ณ งวด ${periodText}` : ""}`;
  const important = comparison === null
    ? (filing.form === "10-K" ? "เป็น baseline สำคัญสำหรับเปรียบเทียบการเติบโตและความเสี่ยงกับปีถัดไป" : "ช่วยตรวจว่าทิศทางธุรกิจระหว่างปียังสอดคล้องกับแนวโน้มระยะยาวหรือไม่")
    : `รายได้ในบริบทที่เปรียบเทียบได้${comparison >= 0 ? "เพิ่มขึ้น" : "ลดลง"}ประมาณ ${new Intl.NumberFormat("th-TH", { style:"percent", maximumFractionDigits:1 }).format(Math.abs(comparison))} จากช่วงเดียวกันของปีก่อน จึงควรอ่าน MD&A เพื่อหาสาเหตุประกอบ`;
  return { intro, summary, items, important };
}

function priceAnalysis(companyId) {
  const prices = state.prices.filter(p => p.company_id === companyId).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  if (prices.length < 2) return { prices, cagr: null, maxDrawdown: null, recoveryMonths: null };
  const first = Number(prices[0].adjusted_close), last = Number(prices.at(-1).adjusted_close);
  const years = (new Date(prices.at(-1).trade_date) - new Date(prices[0].trade_date)) / 31557600000;
  let peak = first, peakDate = prices[0].trade_date, maxDrawdown = 0, troughDate = null, recoveryDate = null, peakBeforeTrough = first;
  for (const row of prices) {
    const price = Number(row.adjusted_close);
    if (price > peak) { peak = price; peakDate = row.trade_date; }
    const drawdown = price / peak - 1;
    if (drawdown < maxDrawdown) { maxDrawdown = drawdown; troughDate = row.trade_date; peakBeforeTrough = peak; recoveryDate = null; }
  }
  if (troughDate) {
    const recovery = prices.find(row => row.trade_date > troughDate && Number(row.adjusted_close) >= peakBeforeTrough);
    recoveryDate = recovery?.trade_date || null;
  }
  const recoveryMonths = recoveryDate ? Math.round((new Date(recoveryDate) - new Date(troughDate)) / 2629800000) : null;
  return { prices, cagr: years > 0 ? Math.pow(last / first, 1 / years) - 1 : null, maxDrawdown, recoveryMonths, peakDate, troughDate, recoveryDate };
}

function priceChart(company) {
  const analysis = priceAnalysis(company.id), prices = analysis.prices;
  if (prices.length < 2) return `<div class="empty-state price-empty"><h3>รอข้อมูลราคาย้อนหลัง</h3><p>${localMode ? "เพิ่ม Alpha Vantage API key แล้วซิงก์ GOOGL" : "ระบบกำลังรอข้อมูลราคาจาก Yahoo Finance"} เพื่อแสดงกราฟ adjusted price 20 ปี</p>${localMode ? `<button class="primary-button" onclick="syncPrice('${esc(company.ticker)}')">ดึงราคาย้อนหลัง</button>` : ""}</div>`;
  const width = 760, height = 220, padding = 18;
  const values = prices.map(p => Number(p.adjusted_close));
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const coords = prices.map((p, index) => ({
    x: padding + index / (prices.length - 1) * (width - padding * 2),
    y: height - padding - (Number(p.adjusted_close) - min) / span * (height - padding * 2), row: p
  }));
  const path = coords.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${path} L${coords.at(-1).x.toFixed(1)},${height - padding} L${coords[0].x.toFixed(1)},${height - padding} Z`;
  const companyEvents = state.events.filter(event => event.company_id === company.id);
  const markers = companyEvents.map(event => {
    const nearest = coords.reduce((best, point) => Math.abs(new Date(point.row.trade_date) - new Date(event.event_date)) < Math.abs(new Date(best.row.trade_date) - new Date(event.event_date)) ? point : best, coords[0]);
    return `<circle cx="${nearest.x}" cy="${nearest.y}" r="5" class="event-dot"><title>${esc(event.title_th)}</title></circle>`;
  }).join("");
  const sourceLabel = prices.at(-1)?.source === "yahoo_finance" ? "Yahoo Finance" : "Alpha Vantage";
  const points = coords.map(point => `<circle class="price-point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${esc(point.row.trade_date)} · $${Number(point.row.adjusted_close).toFixed(2)}</title></circle>`).join("");
  return `<div class="price-chart-wrap"><svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="กราฟราคาปรับปรุงย้อนหลัง 20 ปีของ ${esc(company.ticker)}"><defs><linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa47d" stop-opacity=".28"/><stop offset="1" stop-color="#5aa47d" stop-opacity="0"/></linearGradient></defs><path d="${area}" fill="url(#chartFill)"/><path d="${path}" class="price-line"/>${points}${markers}</svg><div class="chart-axis"><span>${esc(prices[0].trade_date.slice(0,4))}</span><span>เลื่อนเมาส์ดูราคา · Adjusted monthly close · ${esc(sourceLabel)}</span><span>${esc(prices.at(-1).trade_date.slice(0,4))}</span></div></div>`;
}

function eventTimeline(company) {
  const events = state.events.filter(event => event.company_id === company.id);
  if (!events.length) return `<div class="empty-state">ยังไม่มีเหตุการณ์ที่ผ่านการคัดเลือก</div>`;
  const labels = { structural_change: "การเปลี่ยนโครงสร้าง", crisis: "วิกฤต", slowdown: "การชะลอตัว", growth_engine: "เครื่องยนต์การเติบโต" };
  return `<div class="timeline">${events.map(event => `<article class="timeline-item"><div class="timeline-rail"><span></span></div><div class="timeline-content"><div class="news-meta"><span class="topic">${esc(labels[event.event_type] || event.event_type)}</span><span>${new Date(event.event_date).toLocaleDateString("th-TH", { year:"numeric", month:"short" })}</span></div><h3>${esc(event.title_th)}</h3><p>${esc(event.summary_th)}</p><div class="lesson"><strong>บทเรียนสำหรับนักลงทุนระยะยาว</strong>${esc(event.lesson_th)}</div><a class="source-line" href="${esc(event.source_url)}" target="_blank" rel="noopener noreferrer">${esc(event.source_title)} ↗</a></div></article>`).join("")}</div>`;
}

function portfolioPage() {
  const companies = holdingCompanies();
  app.innerHTML = `<div class="page">${pageHeader("MY PORTFOLIO", "พอร์ตของฉัน", "เพิ่มหรือลบบริษัท ข้อมูลพอร์ตแยกตามบัญชีด้วย Row Level Security")}
    <div class="panel-heading"><h2>${companies.length} บริษัท</h2><button class="add-button" onclick="openStockDialog()">＋ เพิ่มหุ้น</button></div>
    <div class="portfolio-grid">${companies.length ? companies.map(company => {
      const status = statusFor(company), facts = latestFacts(company.id, "10-K");
      return `<article class="portfolio-card" onclick="location.hash='company/${esc(company.ticker)}'"><div class="portfolio-card-head"><div class="company-name">${companyLogo(company)}<div><strong>${esc(company.ticker)}</strong><small>${esc(company.legal_name)}</small></div></div><button class="remove-stock" aria-label="ลบ ${esc(company.ticker)}" onclick="removeStock(event,'${company.id}')">×</button></div><p>${esc(company.sector || "ยังไม่มีข้อมูลหมวดธุรกิจ")}</p><div class="status-strip">${badge(status)}<span class="badge stable">รายได้ ${formatMoney(facts.revenue?.value, facts.revenue?.unit)}</span></div></article>`;
    }).join("") : `<div class="empty-state">พอร์ตของคุณยังว่างอยู่<br><button class="text-link" onclick="openStockDialog()">+ เพิ่มหุ้นตัวแรก</button></div>`}</div></div>`;
}

function companyPage(ticker) {
  const company = state.companies.find(c => c.ticker === ticker);
  if (!company) { location.hash = "dashboard"; return; }
  const facts = latestFacts(company.id, "10-K");
  const status = statusFor(company);
  const filings = state.sources.filter(s => s.company_id === company.id).sort((a, b) => b.filed_at.localeCompare(a.filed_at));
  const priceStats = priceAnalysis(company.id);
  const latestPrice = latestPriceSnapshot(priceStats.prices);
  const latestPeriod = facts.revenue?.period_end || facts.net_income?.period_end || facts.diluted_eps?.period_end;
  app.innerHTML = `<div class="page"><section class="company-hero"><a class="back-link" href="#portfolio">← กลับไปที่พอร์ต</a><div class="company-title">${companyLogo(company)}<div><h1>${esc(company.legal_name)}</h1><p>${esc(company.ticker)} · ${esc(company.sector || "")}</p></div></div></section>
    <section class="panel price-section"><div class="panel-heading"><div><span class="eyebrow">20 YEAR VIEW</span><h2>เส้นทางราคาหุ้นและเหตุการณ์สำคัญ</h2></div><span class="as-of">ข้อมูลล่าสุด · ไม่ใช่เรียลไทม์</span></div>${latestPrice ? `<div class="latest-price"><div><small>ราคาล่าสุดที่มีในระบบ</small><strong>$${latestPrice.price.toFixed(2)}</strong></div><span>${new Date(latestPrice.tradeDate).toLocaleDateString("th-TH")} · ${esc(latestPrice.source === "yahoo_finance" ? "Yahoo Finance" : "Alpha Vantage")}</span></div>` : ""}${priceChart(company)}
      <div class="price-stats"><div><small>CAGR</small><strong>${priceStats.cagr === null ? "—" : new Intl.NumberFormat("th-TH", { style:"percent", maximumFractionDigits:1 }).format(priceStats.cagr)}</strong></div><div><small>Maximum drawdown</small><strong class="trend-down">${priceStats.maxDrawdown === null ? "—" : new Intl.NumberFormat("th-TH", { style:"percent", maximumFractionDigits:1 }).format(priceStats.maxDrawdown)}</strong></div><div><small>ระยะเวลาฟื้นจากจุดต่ำสุด</small><strong>${priceStats.recoveryMonths === null ? "ยังไม่ฟื้น/ไม่มีข้อมูล" : `${priceStats.recoveryMonths} เดือน`}</strong></div></div></section>
    <div class="company-overview-grid"><div>
      <section class="panel"><div class="panel-heading"><div><span class="eyebrow">FINANCIAL STATUS</span><h2>สถานการณ์จากงบล่าสุด</h2></div>${badge(status)}</div><p class="prose">${esc(status.note)}</p><div class="source-card">สถานะนี้ใช้กฎเปรียบเทียบรายได้ 10-K ล่าสุดกับปีก่อน ไม่ใช่คำแนะนำซื้อหรือขาย</div></section>
      <section class="panel"><div class="panel-heading"><div><span class="eyebrow">TURNING POINTS</span><h2>เหตุการณ์ที่เปลี่ยนเส้นทางบริษัท</h2></div></div>${eventTimeline(company)}</section>
      <section class="panel"><div class="panel-heading"><h2>เอกสารอ้างอิง</h2></div>${filingList(filings)}</section>
    </div><aside><section class="panel"><div class="panel-heading"><h2>ภาพรวมการเงิน</h2><span class="as-of">งวดสิ้นสุด ${latestPeriod ? new Date(latestPeriod).toLocaleDateString("th-TH") : "—"}</span></div><div class="financial-grid">
      ${Object.entries(metricLabels).map(([metric, label]) => { const fact = facts[metric], source = sourceFor(fact); return `<div class="financial-box"><small>${label}</small><strong>${formatMoney(fact?.value, fact?.unit)}</strong>${source ? `<a class="source-line" href="${esc(source.original_url)}" target="_blank" rel="noopener noreferrer">${esc(fact.form)} · SEC ↗</a>` : ""}</div>`; }).join("")}
    </div>${!Object.keys(facts).length ? `<div class="source-card">ยังไม่มีข้อมูลการเงิน กรุณารัน SEC ingestion</div>` : `<div class="source-card">ค่ามาจาก SEC XBRL Company Facts และคำนวณรูปแบบการแสดงผลในเบราว์เซอร์</div>`}</section></aside></div></div>`;
}

function newsPage() {
  const latest = state.newsSync?.finished_at ? new Date(state.newsSync.finished_at) : null;
  const status = latest ? `อัปเดตล่าสุด ${latest.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} · ระบบตรวจทุก 30 นาที` : "กำลังรอการอัปเดตข่าวรอบแรก";
  app.innerHTML = `<div class="page">${pageHeader("LIVE NEWS ANALYSIS", "วิเคราะห์ข่าวที่เกี่ยวข้องกับพอร์ต", "เชื่อมข่าวกับบริษัทที่คุณถืออยู่ พร้อมประเมินทิศทางความเสี่ยงและคำถามที่ต้องหาคำตอบต่อ")}
    <section class="analysis-feed"><div class="section-title"><div><span class="eyebrow">AUTO REFRESH</span><h2>ข่าวและบทวิเคราะห์ล่าสุด</h2></div><span class="as-of">${esc(status)}</span></div>${newsAnalysisCards(100, portfolioNews())}</section></div>`;
}

function articleReaderPage(articleId) {
  const article = state.news.find(item => item.id === articleId);
  const model = articleReadingModel(article, state.newsLinks, holdingIds(), state.companies);
  if (!model) {
    app.innerHTML = `<div class="page"><div class="empty-state"><h2>ไม่พบข่าวนี้</h2><p>ข่าวนี้อาจไม่อยู่ในพอร์ตของคุณ หรือไม่มีข้อมูลที่อนุญาตให้แสดง</p><a class="primary-button inline-button" href="#news">กลับไปหน้าข่าว</a></div></div>`;
    return;
  }
  const facts = [
    ...model.keyNumbers.map(item => `<li><strong>${esc(item.value || "")}</strong>${item.context ? `<span>${esc(item.context)}</span>` : ""}</li>`),
    ...model.entities.map(item => `<li><strong>${esc(item)}</strong></li>`),
  ];
  const keyPoints = model.keyPoints.length ? `<ul>${model.keyPoints.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>ยังไม่มีประเด็นสรุปเพิ่มเติมจากแหล่งข่าว</p>`;
  const watchPoints = model.watchPoints.length ? `<ul>${model.watchPoints.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : `<p>ติดตามรายละเอียดเพิ่มเติมจากแหล่งข่าวต้นฉบับและเอกสารบริษัท</p>`;
  const evidence = model.evidence.length ? `<details class="reader-evidence"><summary>ดูข้อความอ้างอิงที่ระบบใช้สรุป</summary><ul>${model.evidence.map(item => `<li lang="en">${esc(item.text)}</li>`).join("")}</ul></details>` : "";
  const related = model.relatedCompanies.map(company => `<a class="ticker-pill" href="#company/${esc(company.ticker)}">${esc(company.ticker)}</a>`).join("");
  const original = model.originalUrl
    ? `<a class="primary-button inline-button" href="${esc(model.originalUrl)}" target="_blank" rel="noopener noreferrer">เปิดข่าวต้นฉบับ ↗</a>`
    : "";
  app.innerHTML = `<div class="page reader-page">
    <a class="back-link reader-back" href="#news">← กลับไปหน้าข่าว</a>
    <article class="reader-card">
      <header class="reader-header"><span class="eyebrow">THAI NEWS SUMMARY</span><div>${newsCategoryMarkup(model.image)}</div><h1>${esc(model.title)}</h1><div class="news-meta"><span>${esc(model.publisher)}</span><span>·</span><time datetime="${esc(model.publishedAt || "")}">${model.publishedAt ? new Date(model.publishedAt).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "ไม่ระบุเวลา"}</time></div></header>
      <section><h2>เกิดอะไรขึ้น</h2><p>${esc(model.whatHappened)}</p></section>
      <section><h2>ประเด็นสำคัญ</h2>${keyPoints}</section>
      <section><h2>ตัวเลขและบริษัทที่ถูกกล่าวถึง</h2>${facts.length ? `<ul class="reader-facts">${facts.join("")}</ul>` : `<p>ยังไม่มีตัวเลขหรือชื่อหน่วยงานที่ระบบคัดจากแหล่งข่าว</p>`}</section>
      <section><h2>หุ้นในพอร์ตที่เกี่ยวข้อง</h2><div class="reader-tickers">${related}</div></section>
      <section><h2>สิ่งที่น่าสนใจ/ควรติดตาม</h2>${watchPoints}</section>
      <section class="reader-scope"><h2>${esc(model.scope.label)}</h2><p>${esc(model.scope.limitation)}</p>${evidence}</section>
      <footer class="reader-footer">${original}<details class="original-news"><summary>ดูหัวข้อและบทคัดย่อภาษาอังกฤษ</summary><p lang="en"><strong>${esc(model.originalTitle)}</strong></p>${model.rssExcerpt ? `<p lang="en">${esc(model.rssExcerpt)}</p>` : ""}</details></footer>
    </article>
  </div>`;
}

function render() {
  const pipelineStatus = document.querySelector("#pipelineStatus");
  if (pipelineStatus) pipelineStatus.textContent = state.loading ? "กำลังอ่านฐานข้อมูล" : state.error ? "การเชื่อมต่อมีปัญหา" : localMode ? "SQLite Local mode" : "Supabase production mode";
  if (state.loading) return loadingView();
  if (state.error) return errorView();
  const route = (location.hash || "#dashboard").slice(1);
  document.querySelectorAll(".main-nav a").forEach(a => a.classList.toggle("active", route.startsWith(a.dataset.route)));
  const readerId = articleRouteId(route);
  if (route === "portfolio") portfolioPage();
  else if (readerId) articleReaderPage(readerId);
  else if (route === "news") newsPage();
  else if (route.startsWith("company/")) companyPage(route.split("/")[1]);
  else dashboard();
  document.querySelector(".sidebar").classList.remove("open");
  window.scrollTo(0, 0);
}

window.loadData = async function () {
  state.loading = true; state.error = null; render();
  try {
    if (localMode) {
      const response = await fetch("/api/bootstrap", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Local API ไม่ทำงาน กรุณาเปิดเว็บด้วย server.py แทน http.server");
      const payload = await response.json();
      state.companies = payload.companies || [];
      state.holdings = payload.holdings || [];
      state.facts = payload.facts || [];
      state.sources = payload.sources || [];
      state.prices = payload.prices || [];
      state.events = payload.events || [];
      state.news = payload.news || [];
      state.newsLinks = payload.newsLinks || [];
      state.newsSync = payload.newsSync || null;
      return;
    }
    let { data: sessionData } = await db.auth.getSession();
    if (!sessionData.session) {
      const { data, error } = await db.auth.signInAnonymously();
      if (error) throw new Error(`Anonymous sign-in failed: ${error.message}. Enable Anonymous Sign-Ins in Supabase Auth.`);
      state.session = data.session;
    } else state.session = sessionData.session;

    const [companiesResult, holdingsResult, factsResult, sourcesResult, pricesResult, eventsResult, newsResult, newsLinksResult, newsSyncResult] = await Promise.all([
      db.from("companies").select("id,ticker,cik,legal_name,sector,last_sec_sync_at").eq("active", true).order("ticker"),
      db.from("portfolio_holdings").select("id,company_id,user_id").order("created_at"),
      db.from("financial_facts").select("id,company_id,source_document_id,metric,value,unit,period_start,period_end,form,filed_at,accession_number,taxonomy_concept").order("filed_at", { ascending: false }).limit(1000),
      db.from("source_documents").select("id,company_id,form,title,original_url,filed_at,fiscal_year,fiscal_period").order("filed_at", { ascending: false }).limit(200),
      db.from("stock_prices").select("company_id,trade_date,open,high,low,close,adjusted_close,volume,source").order("trade_date").limit(5000),
      db.from("company_events").select("id,company_id,event_date,event_type,title_th,summary_th,lesson_th,source_title,source_url").order("event_date"),
      db.from("stock_news").select("*").order("published_at", { ascending: false }).limit(100),
      db.from("news_company_links").select("news_id,company_id,discovery_tickers,explicit_mention,title_mention,relevance_score,matched_aliases"),
      db.from("news_sync_runs").select("finished_at,status,articles_found,articles_saved").order("started_at", { ascending: false }).limit(1).maybeSingle()
    ]);
    const failed = [companiesResult, holdingsResult, factsResult, sourcesResult, pricesResult, eventsResult, newsResult, newsLinksResult, newsSyncResult].find(result => result.error);
    if (failed) throw failed.error;
    state.companies = companiesResult.data || [];
    state.holdings = holdingsResult.data || [];
    state.facts = factsResult.data || [];
    state.sources = sourcesResult.data || [];
    state.prices = pricesResult.data || [];
    state.events = eventsResult.data || [];
    state.news = newsResult.data || [];
    state.newsLinks = newsLinksResult.data || [];
    state.newsSync = newsSyncResult.data || null;
  } catch (error) {
    state.error = error.message || String(error);
  } finally {
    state.loading = false; render();
  }
};

function updateStockOptions() {
  const held = new Set(state.holdings.map(h => h.company_id));
  const available = state.companies.filter(c => !held.has(c.id));
  tickerSelect.innerHTML = available.length ? available.map(c => `<option value="${c.id}">${esc(c.ticker)} — ${esc(c.legal_name)}</option>`).join("") : `<option value="">เพิ่มครบทุกบริษัทแล้ว</option>`;
  tickerSelect.disabled = !available.length;
  document.querySelector("#stockForm .primary-button").disabled = !available.length;
}

window.openStockDialog = function () { if (state.loading) return; updateStockOptions(); dialog.showModal(); };
window.removeStock = async function (event, companyId) {
  event.stopPropagation();
  const holding = state.holdings.find(h => h.company_id === companyId);
  if (!holding) return;
  if (localMode) {
    const company = state.companies.find(c => c.id === companyId);
    const response = await fetch(`/api/portfolio/${encodeURIComponent(company.ticker)}`, { method: "DELETE" });
    if (!response.ok) return showToast("ลบไม่สำเร็จ");
  } else {
    const { error } = await db.from("portfolio_holdings").delete().eq("id", holding.id);
    if (error) return showToast(`ลบไม่สำเร็จ: ${error.message}`);
  }
  state.holdings = state.holdings.filter(h => h.id !== holding.id); showToast("ลบออกจากพอร์ตแล้ว"); render();
};

document.querySelector("#openAddStock").addEventListener("click", openStockDialog);
document.querySelector("#menuButton").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
document.querySelector("#stockForm").addEventListener("submit", async event => {
  if (event.submitter?.value === "cancel" || !tickerSelect.value) return;
  event.preventDefault();
  let data;
  if (localMode) {
    const company = state.companies.find(c => c.id === tickerSelect.value);
    const response = await fetch("/api/portfolio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: company.ticker }) });
    if (!response.ok) return showToast("เพิ่มไม่สำเร็จ");
    data = await response.json();
  } else {
    const result = await db.from("portfolio_holdings").insert({ user_id: state.session.user.id, company_id: tickerSelect.value }).select("id,company_id,user_id").single();
    if (result.error) return showToast(`เพิ่มไม่สำเร็จ: ${result.error.message}`);
    data = result.data;
  }
  state.holdings.push(data); dialog.close(); showToast("เพิ่มเข้าพอร์ตแล้ว"); render();
});
window.addEventListener("hashchange", render);

let toastTimer;
function showToast(message) { toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2800); }

window.syncSec = async function () {
  if (!localMode) return;
  const button = document.querySelector(".sync-button");
  if (button) { button.disabled = true; button.textContent = "กำลังดึงข้อมูล…"; }
  try {
    const tickers = holdingCompanies().map(company => company.ticker);
    const response = await fetch("/api/sec/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "SEC sync failed");
    const succeeded = payload.results.filter(result => result.ok).length;
    const failed = payload.results.length - succeeded;
    showToast(`ซิงก์สำเร็จ ${succeeded} บริษัท${failed ? ` · ล้มเหลว ${failed}` : ""}`);
    await loadData();
  } catch (error) {
    showToast(`ซิงก์ไม่สำเร็จ: ${error.message}`);
    if (button) { button.disabled = false; button.textContent = "↻ ซิงก์ข้อมูลจาก SEC"; }
  }
};

window.syncPrice = async function (ticker) {
  showToast(`กำลังดึงราคา ${ticker}…`);
  try {
    const response = await fetch("/api/prices/sync", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ticker }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Price sync failed");
    showToast(`บันทึกราคา ${payload.prices} เดือนแล้ว`);
    await loadData();
  } catch (error) { showToast(error.message); }
};

loadData();
