import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-secret",
};

type Company = { id: string; ticker: string; cik: string; legal_name: string };
type SecUnit = {
  start?: string; end: string; val: number; accn: string; fy?: number;
  fp?: string; form: string; filed: string; frame?: string;
};

const concepts = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  net_income: ["NetIncomeLoss", "ProfitLoss"],
  diluted_eps: ["EarningsPerShareDiluted"],
} as const;

function accessionUrl(cik: string, accession: string) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replaceAll("-", "")}/${accession}-index.html`;
}

function selectFacts(companyFacts: any) {
  const usGaap = companyFacts?.facts?.["us-gaap"] ?? {};
  const selected: Array<SecUnit & { metric: keyof typeof concepts; concept: string; unit: string }> = [];

  for (const [metric, candidates] of Object.entries(concepts) as Array<[keyof typeof concepts, readonly string[]]>) {
    const preferredUnit = metric === "diluted_eps" ? "USD/shares" : "USD";
    const facts: Array<SecUnit & { concept: string; unit: string; conceptRank: number }> = [];
    candidates.forEach((concept, conceptRank) => {
      const units = usGaap[concept]?.units ?? {};
      const unit = units[preferredUnit] ? preferredUnit : Object.keys(units)[0];
      if (!unit) return;
      facts.push(...(units[unit] ?? [])
        .filter((fact: SecUnit) => ["10-K", "10-Q"].includes(fact.form) && Number.isFinite(fact.val))
        .map((fact: SecUnit) => ({ ...fact, concept, unit, conceptRank })));
    });
    facts.sort((a, b) => b.filed.localeCompare(a.filed) || a.conceptRank - b.conceptRank);

    // Retain recent distinct reporting periods; amendments naturally win by filed date.
    const seen = new Set<string>();
    for (const fact of facts) {
      const key = `${fact.end}:${fact.form}:${fact.fp ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ ...fact, metric, concept: fact.concept, unit: fact.unit });
      if (seen.size >= 12) break;
    }
  }
  return selected;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const expectedSecret = Deno.env.get("SEC_INGEST_SECRET");
  if (!expectedSecret || request.headers.get("x-ingest-secret") !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const body = await request.json().catch(() => ({}));
  let query = db.from("companies").select("id,ticker,cik,legal_name").eq("active", true);
  if (Array.isArray(body.tickers) && body.tickers.length) query = query.in("ticker", body.tickers.map((value: string) => value.toUpperCase()));
  const { data: companies, error: companyError } = await query;
  if (companyError) return new Response(JSON.stringify({ error: companyError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const results = [];
  for (const company of companies as Company[]) {
    try {
      const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`, {
        headers: {
          "User-Agent": Deno.env.get("SEC_USER_AGENT") ?? "Longview personal-investment-app admin@example.com",
          "Accept-Encoding": "gzip, deflate",
        },
      });
      if (!response.ok) throw new Error(`SEC returned ${response.status}`);
      const payload = await response.json();
      const facts = selectFacts(payload);

      for (const fact of facts) {
        const url = accessionUrl(company.cik, fact.accn);
        const { data: document, error: documentError } = await db.from("source_documents").upsert({
          company_id: company.id,
          source_type: "sec_filing",
          external_id: fact.accn,
          form: fact.form,
          title: `${company.legal_name} ${fact.form} filing`,
          original_url: url,
          filed_at: fact.filed,
          fiscal_year: fact.fy ?? null,
          fiscal_period: fact.fp ?? null,
          raw_metadata: { accession_number: fact.accn },
          fetched_at: new Date().toISOString(),
        }, { onConflict: "source_type,external_id" }).select("id").single();
        if (documentError) throw documentError;

        const { error: factError } = await db.from("financial_facts").upsert({
          company_id: company.id,
          source_document_id: document.id,
          metric: fact.metric,
          taxonomy_concept: fact.concept,
          value: fact.val,
          unit: fact.unit,
          period_start: fact.start ?? null,
          period_end: fact.end,
          fiscal_year: fact.fy ?? null,
          fiscal_period: fact.fp ?? null,
          form: fact.form,
          filed_at: fact.filed,
          accession_number: fact.accn,
          frame: fact.frame ?? null,
        }, { onConflict: "company_id,metric,period_end,form,accession_number" });
        if (factError) throw factError;
      }

      await db.from("companies").update({ last_sec_sync_at: new Date().toISOString() }).eq("id", company.id);
      results.push({ ticker: company.ticker, ok: true, facts: facts.length });
    } catch (error) {
      results.push({ ticker: company.ticker, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return new Response(JSON.stringify({ results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
