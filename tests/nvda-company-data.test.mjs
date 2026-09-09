import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL(
  "../supabase/migrations/202609090001_nvda_company_events.sql",
  import.meta.url
));

test("seeds NVIDIA turning points with primary sources", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /nvda-crypto-2019/);
  assert.match(migration, /nvda-ai-2023/);
  assert.match(migration, /nvda-blackwell-2024/);
  assert.match(migration, /www\.sec\.gov\/Archives\/edgar\/data\/1045810/);
  assert.match(migration, /nvidianews\.nvidia\.com/);
});
