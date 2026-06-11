/**
 * Canonical transform CLI.
 *
 * Reads raw_entities for a given batch and entity type(s),
 * processes them through canonical transforms, and writes
 * to catalog.* tables.
 *
 * Uses cursor-based pagination (WHERE discogs_id > last_seen) instead of
 * OFFSET for consistent performance on large tables. Automatically resumes
 * from the last processed discogs_id on restart.
 *
 * Usage:
 *   pnpm transform --batch-id <uuid> [--type artists|labels|masters|releases] [--page-size 1000]
 *
 * If --type is omitted, transforms all types in order: artists, labels, masters, releases.
 *
 * KNOWN CONSTRAINT — child-table refresh semantics:
 * Child tables (release_credits, formats, genres, styles, identifiers, etc.)
 * insert with `onConflict doNothing` and are never deleted. Re-transforming
 * the SAME batch_id therefore does NOT refresh changed child rows — it only
 * adds new ones. Re-ingests that need updated child data must use a fresh
 * batch_id.
 */

import { createDb, sql } from "@dig/db";
import type { Kysely, Database } from "@dig/db";
import type { XmlNode } from "./parser.js";
import { transformArtists } from "./transforms/artists.js";
import { transformLabels } from "./transforms/labels.js";
import { transformMasters } from "./transforms/masters.js";
import { transformReleases } from "./transforms/releases.js";

type EntityType = "artist" | "label" | "master" | "release";

const ALL_TYPES: EntityType[] = ["artist", "label", "master", "release"];

const TRANSFORM_ORDER: EntityType[] = ["artist", "label", "master", "release"];

/** Maps entity_type → the primary catalog table to check for resume cursor */
const CATALOG_TABLE: Record<EntityType, string> = {
  artist: "catalog.artists",
  label: "catalog.labels",
  master: "catalog.masters",
  release: "catalog.releases",
};

interface TransformArgs {
  batchId: string;
  types: EntityType[];
  pageSize: number;
}

function parseArgs(argv: string[]): TransformArgs {
  const rest = argv.slice(2).filter((a) => a !== "--");
  let batchId: string | undefined;
  let types: EntityType[] | undefined;
  let pageSize = 1000;

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--batch-id" && rest[i + 1]) {
      batchId = rest[i + 1];
      i++;
    } else if (rest[i] === "--type" && rest[i + 1]) {
      const raw = rest[i + 1];
      // Allow plural forms
      const singular = raw.replace(/s$/, "") as EntityType;
      if (!ALL_TYPES.includes(singular)) {
        console.error(`Error: --type must be one of: ${ALL_TYPES.join(", ")} (or plural form)`);
        process.exit(1);
      }
      types = [singular];
      i++;
    } else if (rest[i] === "--page-size" && rest[i + 1]) {
      pageSize = parseInt(rest[i + 1], 10);
      i++;
    }
  }

  if (!batchId) {
    console.error("Error: --batch-id <uuid> is required");
    process.exit(1);
  }

  return { batchId, types: types ?? TRANSFORM_ORDER, pageSize };
}

/**
 * Find the resume cursor: the max discogs_id already in the catalog table
 * for this batch. Returns 0 if no rows exist (start from beginning).
 */
async function getResumeCursor(
  db: Kysely<Database>,
  entityType: EntityType,
  batchId: string,
): Promise<number> {
  const table = CATALOG_TABLE[entityType];
  const result = await sql<{ max_id: number | null }>`
    SELECT MAX(discogs_id) as max_id FROM ${sql.table(table)} WHERE batch_id = ${batchId}
  `.execute(db);
  return result.rows[0]?.max_id ?? 0;
}

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const db = createDb(databaseUrl);

  try {
    // Verify batch exists
    const batch = await db
      .selectFrom("ingest.dump_batches")
      .select(["id", "dump_date", "status"])
      .where("id", "=", args.batchId)
      .executeTakeFirst();

    if (!batch) {
      console.error(`Error: batch ${args.batchId} not found`);
      process.exit(1);
    }

    console.log(`[transform] Batch ${batch.id} (dump_date: ${batch.dump_date}, status: ${batch.status})`);

    const totalCounts: Record<string, number> = {};
    const startTime = Date.now();

    for (const entityType of args.types) {
      console.log(`\n[transform] Processing ${entityType}s...`);
      const typeStart = Date.now();

      // Count total raw entities
      const countResult = await db
        .selectFrom("ingest.raw_entities")
        .select(db.fn.countAll<number>().as("count"))
        .where("batch_id", "=", args.batchId)
        .where("entity_type", "=", entityType)
        .executeTakeFirstOrThrow();

      const totalEntities = Number(countResult.count);
      console.log(`[transform] Found ${totalEntities.toLocaleString()} raw ${entityType}s`);

      if (totalEntities === 0) {
        console.log(`[transform] Skipping ${entityType} (no raw entities)`);
        continue;
      }

      // Check for resume point
      let cursor = await getResumeCursor(db, entityType, args.batchId);
      let processedCount = 0;
      let resumedCount = 0;

      if (cursor > 0) {
        // Count how many we've already done to show accurate progress
        const doneResult = await sql<{ count: number }>`
          SELECT COUNT(*)::int as count FROM ${sql.table(CATALOG_TABLE[entityType])}
          WHERE batch_id = ${args.batchId}
        `.execute(db);
        processedCount = doneResult.rows[0]?.count ?? 0;
        resumedCount = processedCount;
        console.log(`[transform] Resuming from discogs_id ${cursor} (${processedCount.toLocaleString()} already done)`);
      }

      // Cursor-based pagination through raw_entities
      let pagesEmpty = false;
      while (!pagesEmpty) {
        const rawRows = await db
          .selectFrom("ingest.raw_entities")
          .select(["discogs_id", "raw_payload"])
          .where("batch_id", "=", args.batchId)
          .where("entity_type", "=", entityType)
          .where("discogs_id", ">", cursor)
          .orderBy("discogs_id", "asc")
          .limit(args.pageSize)
          .execute();

        if (rawRows.length === 0) {
          pagesEmpty = true;
          break;
        }

        // Advance cursor to the last discogs_id in this page
        cursor = rawRows[rawRows.length - 1].discogs_id;

        // Parse raw_payload from JSON string to XmlNode
        const rows = rawRows.map((r) => ({
          discogs_id: r.discogs_id,
          raw_payload: (typeof r.raw_payload === "string"
            ? JSON.parse(r.raw_payload)
            : r.raw_payload) as XmlNode,
        }));

        // Call the appropriate transform inside a transaction (fewer round trips)
        const counts = await db.transaction().execute(async (trx) => {
          let result: Record<string, number>;
          switch (entityType) {
            case "artist":
              result = { ...await transformArtists(trx, args.batchId, rows) };
              break;
            case "label":
              result = { ...await transformLabels(trx, args.batchId, rows) };
              break;
            case "master":
              result = { ...await transformMasters(trx, args.batchId, rows) };
              break;
            case "release":
              result = { ...await transformReleases(trx, args.batchId, rows) };
              break;
          }
          return result;
        });

        // Accumulate counts
        for (const [key, val] of Object.entries(counts)) {
          totalCounts[key] = (totalCounts[key] ?? 0) + val;
        }

        processedCount += rawRows.length;

        // Progress log every page
        const pct = ((processedCount / totalEntities) * 100).toFixed(1);
        const elapsedSec = (Date.now() - typeStart) / 1000;
        const newRows = processedCount - resumedCount;
        const rate = elapsedSec > 0 ? (newRows / elapsedSec).toFixed(0) : "0";
        const remaining = totalEntities - processedCount;
        const eta = Number(rate) > 0 ? (remaining / Number(rate) / 60).toFixed(0) : "?";
        process.stdout.write(`\r[transform] ${entityType}: ${processedCount.toLocaleString()}/${totalEntities.toLocaleString()} (${pct}%) ${rate}/s ETA ${eta}min`);
      }

      const typeElapsed = ((Date.now() - typeStart) / 1000).toFixed(1);
      console.log(`\n[transform] ${entityType}s done in ${typeElapsed}s`);
    }

    // Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n[transform] === Summary (${elapsed}s) ===`);
    for (const [table, count] of Object.entries(totalCounts).sort()) {
      if (count > 0) {
        console.log(`  ${table}: ${count.toLocaleString()}`);
      }
    }

    // Update batch status
    await db
      .updateTable("ingest.dump_batches")
      .set({ status: "qa" })
      .where("id", "=", args.batchId)
      .execute();

    console.log(`\n[transform] Batch ${args.batchId} status → qa`);
  } catch (err) {
    // Mark the batch failed so a crashed run doesn't leave it stuck in 'importing'
    try {
      await db
        .updateTable("ingest.dump_batches")
        .set({ status: "failed" })
        .where("id", "=", args.batchId)
        .execute();
      console.error(`[transform] Batch ${args.batchId} status → failed`);
    } catch {
      console.error(`[transform] Could not mark batch ${args.batchId} as failed`);
    }
    throw err;
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
