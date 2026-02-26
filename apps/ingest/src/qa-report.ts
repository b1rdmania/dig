/**
 * QA Report Generator.
 *
 * Compares raw_entities counts against canonical catalog tables
 * and reports on data quality metrics.
 *
 * Usage:
 *   pnpm qa --batch-id <uuid>
 */

import { createDb, sql } from "@dig/db";
import type { Kysely, Database } from "@dig/db";

interface TableCount {
  table: string;
  count: number;
}

interface QaSection {
  title: string;
  rows: Array<Record<string, string | number | null>>;
}

async function countTable(db: Kysely<Database>, table: string, batchId: string): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT count(*)::int as count FROM ${sql.table(table)} WHERE batch_id = ${batchId}
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  let batchId: string | undefined;
  const cliArgs = process.argv.slice(2).filter((a) => a !== "--");
  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === "--batch-id" && cliArgs[i + 1]) {
      batchId = cliArgs[i + 1];
      i++;
    }
  }

  if (!batchId) {
    console.error("Error: --batch-id <uuid> is required");
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  try {
    // Batch info
    const batch = await db
      .selectFrom("ingest.dump_batches")
      .select(["id", "dump_date", "status", "started_at", "created_at"])
      .where("id", "=", batchId)
      .executeTakeFirst();

    if (!batch) {
      console.error(`Error: batch ${batchId} not found`);
      process.exit(1);
    }

    console.log("=".repeat(70));
    console.log("QA REPORT");
    console.log("=".repeat(70));
    console.log(`Batch ID:   ${batch.id}`);
    console.log(`Dump Date:  ${batch.dump_date}`);
    console.log(`Status:     ${batch.status}`);
    console.log(`Created:    ${batch.created_at}`);
    console.log("");

    // Section 1: Raw entity counts
    console.log("-".repeat(70));
    console.log("1. RAW ENTITY COUNTS (ingest.raw_entities)");
    console.log("-".repeat(70));

    const rawCounts = await db
      .selectFrom("ingest.raw_entities")
      .select(["entity_type"])
      .select(db.fn.countAll<number>().as("count"))
      .where("batch_id", "=", batchId)
      .groupBy("entity_type")
      .orderBy("entity_type")
      .execute();

    for (const row of rawCounts) {
      console.log(`  ${row.entity_type.padEnd(12)} ${Number(row.count).toLocaleString()}`);
    }
    if (rawCounts.length === 0) console.log("  (none)");
    console.log("");

    // Section 2: Canonical table counts
    console.log("-".repeat(70));
    console.log("2. CANONICAL TABLE COUNTS (catalog.*)");
    console.log("-".repeat(70));

    const catalogTables = [
      // Core entities
      "catalog.artists", "catalog.labels", "catalog.masters", "catalog.releases",
      // Artist children
      "catalog.artist_urls", "catalog.artist_name_variations",
      "catalog.artist_aliases", "catalog.artist_groups", "catalog.artist_members",
      // Label children
      "catalog.label_urls",
      // Master children
      "catalog.master_artists", "catalog.master_genres",
      "catalog.master_styles", "catalog.master_videos",
      // Release children
      "catalog.release_artists", "catalog.release_credits", "catalog.release_labels",
      "catalog.release_formats", "catalog.release_genres", "catalog.release_styles",
      "catalog.release_identifiers", "catalog.release_companies", "catalog.release_videos",
      // Tracks
      "catalog.tracks", "catalog.track_credits",
    ];

    const tableCounts: TableCount[] = [];
    for (const table of catalogTables) {
      const count = await countTable(db, table, batchId);
      tableCounts.push({ table, count });
    }

    for (const { table, count } of tableCounts) {
      if (count > 0) {
        console.log(`  ${table.replace("catalog.", "").padEnd(30)} ${count.toLocaleString()}`);
      }
    }

    const emptyTables = tableCounts.filter((t) => t.count === 0);
    if (emptyTables.length > 0) {
      console.log(`\n  Empty tables (${emptyTables.length}): ${emptyTables.map((t) => t.table.replace("catalog.", "")).join(", ")}`);
    }
    console.log("");

    // Section 3: Raw → Canonical ratio
    console.log("-".repeat(70));
    console.log("3. RAW → CANONICAL COVERAGE");
    console.log("-".repeat(70));

    const rawMap = new Map(rawCounts.map((r) => [r.entity_type, Number(r.count)]));
    const coreMap: Array<{ entity: string; raw: number; canonical: number }> = [
      { entity: "artist", raw: rawMap.get("artist") ?? 0, canonical: tableCounts.find((t) => t.table === "catalog.artists")?.count ?? 0 },
      { entity: "label", raw: rawMap.get("label") ?? 0, canonical: tableCounts.find((t) => t.table === "catalog.labels")?.count ?? 0 },
      { entity: "master", raw: rawMap.get("master") ?? 0, canonical: tableCounts.find((t) => t.table === "catalog.masters")?.count ?? 0 },
      { entity: "release", raw: rawMap.get("release") ?? 0, canonical: tableCounts.find((t) => t.table === "catalog.releases")?.count ?? 0 },
    ];

    for (const { entity, raw, canonical } of coreMap) {
      if (raw > 0) {
        const pct = ((canonical / raw) * 100).toFixed(1);
        console.log(`  ${entity.padEnd(12)} ${canonical.toLocaleString().padStart(12)} / ${raw.toLocaleString().padStart(12)} = ${pct}%`);
      }
    }
    console.log("");

    // Section 4: Data quality distribution
    console.log("-".repeat(70));
    console.log("4. DATA QUALITY DISTRIBUTION");
    console.log("-".repeat(70));

    for (const table of ["catalog.artists", "catalog.labels", "catalog.masters", "catalog.releases"]) {
      const count = tableCounts.find((t) => t.table === table)?.count ?? 0;
      if (count === 0) continue;

      const dqRows = await sql<{ data_quality: string; count: number }>`
        SELECT data_quality, count(*)::int as count
        FROM ${sql.table(table)}
        WHERE batch_id = ${batchId}
        GROUP BY data_quality
        ORDER BY count DESC
      `.execute(db);

      console.log(`\n  ${table.replace("catalog.", "")}:`);
      for (const row of dqRows.rows) {
        const pct = ((row.count / count) * 100).toFixed(1);
        console.log(`    ${row.data_quality.padEnd(20)} ${row.count.toLocaleString().padStart(10)} (${pct}%)`);
      }
    }
    console.log("");

    // Section 5: NULL checks on important fields
    console.log("-".repeat(70));
    console.log("5. NULL / EMPTY FIELD CHECKS");
    console.log("-".repeat(70));

    const nullChecks = [
      { table: "catalog.artists", field: "name", condition: "name LIKE '[Unknown%'" },
      { table: "catalog.artists", field: "profile", condition: "profile IS NULL" },
      { table: "catalog.artists", field: "real_name", condition: "real_name IS NULL" },
      { table: "catalog.labels", field: "name", condition: "name LIKE '[Unknown%'" },
      { table: "catalog.labels", field: "profile", condition: "profile IS NULL" },
      { table: "catalog.masters", field: "title", condition: "title LIKE '[Untitled%'" },
      { table: "catalog.masters", field: "year", condition: "year IS NULL" },
      { table: "catalog.releases", field: "title", condition: "title LIKE '[Untitled%'" },
      { table: "catalog.releases", field: "country", condition: "country IS NULL" },
      { table: "catalog.releases", field: "release_year", condition: "release_year IS NULL" },
    ];

    for (const check of nullChecks) {
      const total = tableCounts.find((t) => t.table === check.table)?.count ?? 0;
      if (total === 0) continue;

      const result = await sql<{ count: number }>`
        SELECT count(*)::int as count FROM ${sql.table(check.table)}
        WHERE batch_id = ${batchId} AND ${sql.raw(check.condition)}
      `.execute(db);

      const nullCount = result.rows[0]?.count ?? 0;
      const pct = ((nullCount / total) * 100).toFixed(1);
      const label = `${check.table.replace("catalog.", "")}.${check.field}`;
      console.log(`  ${label.padEnd(35)} ${nullCount.toLocaleString().padStart(10)} / ${total.toLocaleString().padStart(10)} (${pct}%)`);
    }
    console.log("");

    // Section 6: Sample data spot check
    console.log("-".repeat(70));
    console.log("6. SAMPLE RECORDS (first 3 per core entity)");
    console.log("-".repeat(70));

    for (const table of ["catalog.artists", "catalog.labels", "catalog.masters", "catalog.releases"]) {
      const count = tableCounts.find((t) => t.table === table)?.count ?? 0;
      if (count === 0) continue;

      const entityName = table.replace("catalog.", "");
      console.log(`\n  ${entityName}:`);

      const samples = await sql<Record<string, unknown>>`
        SELECT * FROM ${sql.table(table)}
        WHERE batch_id = ${batchId}
        ORDER BY discogs_id ASC LIMIT 3
      `.execute(db);

      for (const row of samples.rows) {
        const id = row.discogs_id;
        const name = row.name ?? row.title ?? "(no name)";
        const dq = row.data_quality ?? "";
        console.log(`    [${id}] ${name} (${dq})`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("END QA REPORT");
    console.log("=".repeat(70));
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
