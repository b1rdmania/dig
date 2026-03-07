#!/usr/bin/env npx tsx
/**
 * Data Quality Classifier — Backfill Script
 *
 * Classifies all entities in the catalog and upserts results into enrich.entity_quality.
 * Idempotent: reruns update existing rows via ON CONFLICT DO UPDATE.
 *
 * Usage:
 *   DATABASE_URL=<pg_url> npx tsx scripts/quality-classify.ts [--types artist,label,master,release]
 *
 * Local (via Docker):
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig npx tsx scripts/quality-classify.ts
 *
 * Fly (via proxy):
 *   fly proxy 15432:5432 -a dig-db &
 *   DATABASE_URL=postgresql://postgres:<pass>@localhost:15432/dig npx tsx scripts/quality-classify.ts
 *
 * Rules (quality_version = 1):
 *   1. empty name/title         → invalid   / empty_name
 *   2. purely numeric name      → low_value / numeric_name
 *   3. Entirely Incorrect       → suppressed / discogs_quality_entirely_incorrect
 *   4. Needs Major Changes      → low_value / discogs_quality_needs_major_changes
 *   5. otherwise                → active / default_active
 */

import pg from "pg";
import { sql } from "kysely";
import { Kysely, PostgresDialect } from "kysely";
import type { Database } from "../packages/db/src/schema.js";

const QUALITY_VERSION = 1;

type EntityType = "artist" | "label" | "master" | "release";

const ALL_TYPES: EntityType[] = ["artist", "label", "master", "release"];

function parseArgs(): { types: EntityType[] } {
  const args = process.argv.slice(2);
  const typesArg = args.find(a => a.startsWith("--types="))?.split("=")[1]
    ?? args[args.indexOf("--types") + 1];

  if (typesArg) {
    const requested = typesArg.split(",").map(t => t.trim()) as EntityType[];
    const invalid = requested.filter(t => !ALL_TYPES.includes(t));
    if (invalid.length > 0) {
      console.error(`Invalid types: ${invalid.join(", ")}. Valid: ${ALL_TYPES.join(", ")}`);
      process.exit(1);
    }
    return { types: requested };
  }

  return { types: ALL_TYPES };
}

async function classifyEntityType(
  db: Kysely<Database>,
  entityType: EntityType,
): Promise<{ total: number; byStatus: Record<string, number> }> {
  const nameCol = entityType === "artist" || entityType === "label" ? "name" : "title";
  const table = `catalog.${entityType === "artist" ? "artists" : entityType === "label" ? "labels" : entityType === "master" ? "masters" : "releases"}`;

  console.log(`  [${entityType}] Classifying from ${table}...`);
  const start = Date.now();

  // Single INSERT...SELECT — idempotent via ON CONFLICT DO UPDATE.
  // The CASE expression mirrors classifyEntityQuality() in quality.ts.
  const result = await sql`
    INSERT INTO enrich.entity_quality
      (entity_type, discogs_id, batch_id, quality_status, quality_reason, quality_version, quality_scored_at)
    SELECT
      ${entityType}::text,
      discogs_id,
      batch_id,
      CASE
        WHEN ${sql.raw(nameCol)} IS NULL OR trim(${sql.raw(nameCol)}) = '' THEN 'invalid'
        WHEN ${sql.raw(nameCol)} ~ '^[0-9]+$' THEN 'low_value'
        WHEN data_quality = 'Entirely Incorrect' THEN 'suppressed'
        WHEN data_quality = 'Needs Major Changes' THEN 'low_value'
        ELSE 'active'
      END,
      CASE
        WHEN ${sql.raw(nameCol)} IS NULL OR trim(${sql.raw(nameCol)}) = '' THEN 'empty_name'
        WHEN ${sql.raw(nameCol)} ~ '^[0-9]+$' THEN 'numeric_name'
        WHEN data_quality = 'Entirely Incorrect' THEN 'discogs_quality_entirely_incorrect'
        WHEN data_quality = 'Needs Major Changes' THEN 'discogs_quality_needs_major_changes'
        ELSE 'default_active'
      END,
      ${QUALITY_VERSION},
      now()
    FROM ${sql.raw(table)}
    ON CONFLICT (entity_type, discogs_id) DO UPDATE SET
      batch_id          = EXCLUDED.batch_id,
      quality_status    = EXCLUDED.quality_status,
      quality_reason    = EXCLUDED.quality_reason,
      quality_version   = EXCLUDED.quality_version,
      quality_scored_at = EXCLUDED.quality_scored_at,
      updated_at        = now()
  `.execute(db);

  const elapsed = Date.now() - start;
  const rowCount = (result as any).numAffectedRows ?? 0;
  console.log(`  [${entityType}] Done — ${rowCount} rows in ${elapsed}ms`);

  // Distribution report
  const dist = await sql<{ quality_status: string; cnt: string }>`
    SELECT quality_status, count(*) as cnt
    FROM enrich.entity_quality
    WHERE entity_type = ${entityType}
    GROUP BY quality_status
    ORDER BY cnt DESC
  `.execute(db);

  const byStatus: Record<string, number> = {};
  for (const row of dist.rows) {
    byStatus[row.quality_status] = parseInt(row.cnt, 10);
  }

  return { total: Number(rowCount), byStatus };
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  const { types } = parseArgs();

  const pool = new pg.Pool({ connectionString: dbUrl });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  console.log("Quality Classifier — Backfill");
  console.log(`Entity types: ${types.join(", ")}`);
  console.log(`Quality version: ${QUALITY_VERSION}`);
  console.log("");

  const report: Record<string, { total: number; byStatus: Record<string, number> }> = {};

  try {
    for (const entityType of types) {
      const result = await classifyEntityType(db, entityType);
      report[entityType] = result;
    }
  } finally {
    await pool.end();
  }

  console.log("\n=== Distribution Report ===");
  let allActive = 0;
  let allTotal = 0;

  for (const [entityType, { byStatus }] of Object.entries(report)) {
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const active = byStatus.active ?? 0;
    const pct = total > 0 ? ((active / total) * 100).toFixed(1) : "0.0";
    console.log(`\n${entityType}:`);
    for (const [status, count] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(15)} ${count.toLocaleString()}`);
    }
    console.log(`  total:          ${total.toLocaleString()} (${pct}% active)`);
    allActive += active;
    allTotal += total;
  }

  if (allTotal > 0) {
    const overallPct = ((allActive / allTotal) * 100).toFixed(1);
    console.log(`\nOverall: ${allActive.toLocaleString()} / ${allTotal.toLocaleString()} active (${overallPct}%)`);
  }

  console.log("\n✓ Backfill complete. Classifier is idempotent — safe to rerun.");
}

main().catch((err) => {
  console.error("Backfill failed:", err.message);
  process.exit(1);
});
