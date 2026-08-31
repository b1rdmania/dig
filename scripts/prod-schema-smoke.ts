/**
 * Prod schema smoke test — asserts the live database actually has the tables
 * the code depends on.
 *
 * Why: migrations say what SHOULD exist; the scoped-artifact rebuild restores
 * a database that can drift from that. On 2026-08-31 enrich.usage_counters
 * (migration 016) was missing from BOTH prod and local — usage metrics had
 * been failing silently for weeks because the writer swallows errors.
 *
 * Run against prod:
 *   fly proxy 15433:5432 -a dig-db-scene            # in another terminal
 *   DATABASE_URL=postgres://postgres:<OPERATOR_PASSWORD>@localhost:15433/dig \
 *     pnpm exec tsx scripts/prod-schema-smoke.ts
 * Run against local:
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
 *     pnpm exec tsx scripts/prod-schema-smoke.ts
 *
 * Run after every catalog rebuild/restore, and whenever telemetry looks quiet.
 */
import pg from "pg";

// Every table the API reads or writes at runtime. Add here when a migration
// adds a runtime table; leave build-time/staging-only tables out.
const REQUIRED_TABLES = [
  "catalog.masters",
  "catalog.artists",
  "catalog.labels",
  "catalog.master_videos_unified",
  "catalog.release_shadow",
  "enrich.usage_counters",
  "enrich.usage_daily",
  "enrich.search_quality_daily",
  "enrich.entity_images",
  "enrich.entity_quality",
  "enrich.label_core_run",
  "enrich.scenes",
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required — see the header for the fly proxy recipe");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const res = await client.query<{ full_name: string }>(
      `SELECT table_schema || '.' || table_name AS full_name
       FROM information_schema.tables
       WHERE table_schema IN ('catalog', 'enrich')`,
    );
    const present = new Set(res.rows.map((r) => r.full_name));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    for (const t of REQUIRED_TABLES) {
      console.log(`${present.has(t) ? "ok     " : "MISSING"} ${t}`);
    }
    if (missing.length > 0) {
      console.error(`\n${missing.length} required table(s) missing — the runtime is degraded.`);
      process.exit(1);
    }
    console.log("\nAll required tables present.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
