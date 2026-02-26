/**
 * Canonical transform CLI.
 *
 * Reads raw_entities for a given batch and entity type(s),
 * processes them through canonical transforms, and writes
 * to catalog.* tables.
 *
 * Usage:
 *   pnpm transform --batch-id <uuid> [--type artists|labels|masters|releases] [--page-size 1000]
 *
 * If --type is omitted, transforms all types in order: artists, labels, masters, releases.
 */

import { createDb } from "@dig/db";
import type { XmlNode } from "./parser.js";
import { transformArtists } from "./transforms/artists.js";
import { transformLabels } from "./transforms/labels.js";
import { transformMasters } from "./transforms/masters.js";
import { transformReleases } from "./transforms/releases.js";

type EntityType = "artist" | "label" | "master" | "release";

const ALL_TYPES: EntityType[] = ["artist", "label", "master", "release"];

const TRANSFORM_ORDER: EntityType[] = ["artist", "label", "master", "release"];

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

      // Page through raw_entities
      let offset = 0;
      let processedCount = 0;

      while (offset < totalEntities) {
        const rawRows = await db
          .selectFrom("ingest.raw_entities")
          .select(["discogs_id", "raw_payload"])
          .where("batch_id", "=", args.batchId)
          .where("entity_type", "=", entityType)
          .orderBy("discogs_id", "asc")
          .limit(args.pageSize)
          .offset(offset)
          .execute();

        if (rawRows.length === 0) break;

        // Parse raw_payload from JSON string to XmlNode
        const rows = rawRows.map((r) => ({
          discogs_id: r.discogs_id,
          raw_payload: (typeof r.raw_payload === "string"
            ? JSON.parse(r.raw_payload)
            : r.raw_payload) as XmlNode,
        }));

        // Call the appropriate transform
        let result: Record<string, number>;
        switch (entityType) {
          case "artist":
            result = { ...await transformArtists(db, args.batchId, rows) };
            break;
          case "label":
            result = { ...await transformLabels(db, args.batchId, rows) };
            break;
          case "master":
            result = { ...await transformMasters(db, args.batchId, rows) };
            break;
          case "release":
            result = { ...await transformReleases(db, args.batchId, rows) };
            break;
        }
        const counts = result;

        // Accumulate counts
        for (const [key, val] of Object.entries(counts)) {
          totalCounts[key] = (totalCounts[key] ?? 0) + val;
        }

        processedCount += rawRows.length;
        offset += rawRows.length;

        // Progress log every page
        const pct = ((processedCount / totalEntities) * 100).toFixed(1);
        process.stdout.write(`\r[transform] ${entityType}: ${processedCount.toLocaleString()}/${totalEntities.toLocaleString()} (${pct}%)`);
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
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
