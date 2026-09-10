import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/202609100002_meta_company_events.sql", import.meta.url));

test("seeds Meta turning points with primary sources", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /meta-att-2021/);
  assert.match(migration, /meta-efficiency-2023/);
  assert.match(migration, /meta-ai-2024/);
  assert.match(migration, /www\.sec\.gov\/Archives\/edgar\/data\/1326801/);
  assert.match(migration, /investor\.atmeta\.com/);
});
