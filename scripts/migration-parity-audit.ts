/**
 * Static migration parity audit (repo-side).
 *
 * Verifies:
 * - migrations are contiguous (001..N)
 * - critical migration files exist for known production fixes
 *
 * Usage:
 *   npx tsx scripts/migration-parity-audit.ts
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, "packages", "db", "migrations");

type Check = { name: string; ok: boolean; detail: string };

function listMigrationFiles(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}_.+\.ts$/.test(f))
    .sort();
}

function expectedSequence(max: number): string[] {
  return Array.from({ length: max }, (_, i) => String(i + 1).padStart(3, "0"));
}

function run(): void {
  const checks: Check[] = [];
  const files = listMigrationFiles();
  if (files.length === 0) {
    console.error("No migration files found.");
    process.exit(1);
  }

  const numbers = files.map((f) => Number(f.slice(0, 3)));
  const max = Math.max(...numbers);
  const expected = new Set(expectedSequence(max));
  const actual = new Set(files.map((f) => f.slice(0, 3)));
  const missing = [...expected].filter((n) => !actual.has(n));
  const duplicateCount = numbers.length - new Set(numbers).size;

  checks.push({
    name: "contiguous-sequence",
    ok: missing.length === 0,
    detail: missing.length === 0 ? `001..${String(max).padStart(3, "0")} present` : `missing=${missing.join(",")}`,
  });
  checks.push({
    name: "no-duplicate-prefixes",
    ok: duplicateCount === 0,
    detail: `duplicates=${duplicateCount}`,
  });

  const requiredFiles = [
    "007_release_filtered_perf_indexes.ts",
    "008_release_master_index.ts",
    "012_seo_cohort_indexes.ts",
    "013_seo_cohort_outer_indexes.ts",
    "014_artist_credits_indexes.ts",
    "015_entity_quality.ts",
  ];
  for (const file of requiredFiles) {
    checks.push({
      name: `required-file:${file}`,
      ok: files.includes(file),
      detail: files.includes(file) ? "present" : "missing",
    });
  }

  const summaryFailed = checks.filter((c) => !c.ok);
  const passed = checks.length - summaryFailed.length;
  console.log(`Migration parity audit: ${passed}/${checks.length} passed`);
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} :: ${check.detail}`);
  }

  console.log("\nRepo migration files:");
  for (const file of files) console.log(`- ${file}`);

  console.log("\nProd verification SQL (run against target DB):");
  console.log(
    [
      "SELECT name, timestamp FROM kysely_migration ORDER BY timestamp;",
      "SELECT indexname FROM pg_indexes WHERE schemaname='catalog' AND indexname IN ('idx_releases_year_discogs','idx_releases_master','idx_release_credits_artist_batch','idx_track_credits_artist_batch');",
      "SELECT indexname FROM pg_indexes WHERE schemaname='enrich' AND indexname IN ('idx_entity_quality_status','idx_entity_quality_discogs_id');",
    ].join("\n"),
  );

  if (summaryFailed.length > 0) process.exit(1);
}

run();

