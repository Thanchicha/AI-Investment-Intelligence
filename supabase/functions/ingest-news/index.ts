import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createIngestionHandler,
  createSupabaseNewsRepository,
} from "../_shared/news-ingestion.js";

const handler = createIngestionHandler({
  createDatabase() {
    const client = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    return createSupabaseNewsRepository(client);
  },
  fetchImpl: fetch,
  getSecret: () => Deno.env.get("NEWS_INGEST_SECRET"),
});

Deno.serve(handler);
