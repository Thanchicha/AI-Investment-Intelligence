import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../supabase/migrations/202609090002_msft_company_events.sql", import.meta.url));

test("seeds Microsoft turning points with primary sources", () => {
  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /msft-cloud-2014/);
  assert.match(migration, /msft-remote-work-2020/);
  assert.match(migration, /msft-activision-2023/);
  assert.match(migration, /www\.sec\.gov\/Archives\/edgar\/data\/789019/);
  assert.match(migration, /blogs\.microsoft\.com/);
});
