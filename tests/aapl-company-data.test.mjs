import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/202609100001_aapl_company_events.sql", import.meta.url));

test("seeds Apple turning points with primary sources", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /aapl-services-2019/);
  assert.match(migration, /aapl-covid-2020/);
  assert.match(migration, /aapl-silicon-2020/);
  assert.match(migration, /www\.sec\.gov\/Archives\/edgar\/data\/320193/);
  assert.match(migration, /www\.apple\.com\/newsroom/);
});
