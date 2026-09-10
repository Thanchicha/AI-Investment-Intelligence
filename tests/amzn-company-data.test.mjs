import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/202609100004_amzn_company_events.sql", import.meta.url));

test("seeds Amazon turning points with primary sources", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /amzn-aws-2015/);
  assert.match(migration, /amzn-covid-2020/);
  assert.match(migration, /amzn-aws-ai-2023/);
  assert.match(migration, /www\.sec\.gov\/Archives\/edgar\/data\/1018724/);
  assert.match(migration, /ir\.aboutamazon\.com/);
});
