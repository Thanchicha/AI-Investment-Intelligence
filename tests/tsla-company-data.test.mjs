import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/202609100003_tsla_company_events.sql", import.meta.url));

test("seeds Tesla turning points with primary sources", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /tsla-model3-2018/);
  assert.match(migration, /tsla-profitability-2020/);
  assert.match(migration, /tsla-energy-2024/);
  assert.match(migration, /www\.sec\.gov\/Archives\/edgar\/data\/1318605/);
  assert.match(migration, /ir\.tesla\.com/);
});
