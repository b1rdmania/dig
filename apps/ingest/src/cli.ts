/**
 * Discogs XML dump ingest CLI.
 *
 * Usage:
 *   pnpm ingest artists  --file /path/to/discogs_artists.xml.gz
 *   pnpm ingest labels   --file /path/to/discogs_labels.xml.gz
 *   pnpm ingest masters  --file /path/to/discogs_masters.xml.gz
 *   pnpm ingest releases --file /path/to/discogs_releases.xml.gz
 *
 * Options:
 *   --file <path>        Path to gzipped XML dump file (required)
 *   --batch-id <uuid>    Resume into an existing batch (optional)
 *   --dump-date <date>   Dump date label, e.g. "2026-02-01" (defaults to filename parse)
 *   --batch-size <n>     DB write batch size (default: 500)
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import path from "node:path";
import { createDb, sql } from "@dig/db";
import { parseXmlDump, type EntityType, type RawEntity } from "./parser.js";

const VALID_TYPES: EntityType[] = ["artists", "labels", "masters", "releases"];

/** Singular form for entity_type column in raw_entities */
const SINGULAR: Record<EntityType, "artist" | "label" | "master" | "release"> = {
  artists: "artist",
  labels: "label",
  masters: "master",
  releases: "release",
};

interface CliArgs {
  type: EntityType;
  file: string;
  batchId?: string;
  dumpDate?: string;
  batchSize: number;
}

function parseArgs(argv: string[]): CliArgs {
  const [, , command, ...rest] = argv;

  if (!VALID_TYPES.includes(command as EntityType)) {
    console.error(`Error: first argument must be one of: ${VALID_TYPES.join(", ")}`);
    console.error(`Got: ${JSON.stringify(command)}`);
    process.exit(1);
  }

  let file: string | undefined;
  let batchId: string | undefined;
  let dumpDate: string | undefined;
  let batchSize = 500;

  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--file" && rest[i + 1]) {
      file = rest[i + 1];
      i++;
    } else if (rest[i] === "--batch-id" && rest[i + 1]) {
      batchId = rest[i + 1];
      i++;
    } else if (rest[i] === "--dump-date" && rest[i + 1]) {
      dumpDate = rest[i + 1];
      i++;
    } else if (rest[i] === "--batch-size" && rest[i + 1]) {
      batchSize = parseInt(rest[i + 1], 10);
      i++;
    }
  }

  if (!file) {
    console.error("Error: --file <path> is required");
    process.exit(1);
  }

  return { type: command as EntityType, file, batchId, dumpDate, batchSize };
}

/** Try to extract dump date from filename like "discogs_20260201_artists.xml.gz" */
function parseDumpDate(filename: string): string {
  const match = path.basename(filename).match(/(\d{4})(\d{2})(\d{2})/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return new Date().toISOString().slice(0, 10);
}

/**
 * Extract discogs_id from parsed entity data.
 * For artists/labels: id is a child element.
 * For masters/releases: id is an attribute on the root element.
 */
function extractDiscogsId(entity: RawEntity): number | null {
  const data = entity.data;

  // Check attribute first (masters, releases)
  if (data["@attr"]?.["id"]) {
    const id = parseInt(data["@attr"]["id"] as string, 10);
    if (!isNaN(id)) return id;
  }

  // Check child <id> element (artists, labels)
  const idChildren = data["id"];
  if (Array.isArray(idChildren) && idChildren.length > 0) {
    const text = idChildren[0]["#text"];
    if (typeof text === "string") {
      const id = parseInt(text, 10);
      if (!isNaN(id)) return id;
    }
  }

  return null;
}

async function main() {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const dumpDate = args.dumpDate ?? parseDumpDate(args.file);
  const db = createDb(databaseUrl);

  try {
    // Create or resume batch
    let batchId: string;
    if (args.batchId) {
      batchId = args.batchId;
      console.log(`[ingest] Resuming batch ${batchId}`);
    } else {
      const result = await db
        .insertInto("ingest.dump_batches")
        .values({
          dump_date: dumpDate,
          status: "importing",
          started_at: new Date(),
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      batchId = result.id;
      console.log(`[ingest] Created batch ${batchId} (dump_date: ${dumpDate})`);
    }

    // Update batch status to importing
    await db
      .updateTable("ingest.dump_batches")
      .set({ status: "importing", started_at: new Date() })
      .where("id", "=", batchId)
      .execute();

    // Set up buffered batch writer
    const entityType = SINGULAR[args.type];
    let buffer: Array<{
      batch_id: string;
      entity_type: typeof entityType;
      discogs_id: number;
      raw_payload: unknown;
    }> = [];
    let totalWritten = 0;
    let skipped = 0;

    async function flushBuffer() {
      if (buffer.length === 0) return;
      const batch = buffer;
      buffer = [];

      await db
        .insertInto("ingest.raw_entities")
        .values(batch)
        .onConflict((oc) =>
          oc
            .columns(["batch_id", "entity_type", "discogs_id"])
            .doUpdateSet({ raw_payload: sql`excluded.raw_payload` })
        )
        .execute();

      totalWritten += batch.length;
    }

    // Parse and ingest
    console.log(`[ingest] Parsing ${args.type} from ${path.basename(args.file)}...`);

    const stream = createReadStream(args.file).pipe(createGunzip());
    const startTime = Date.now();

    const { entityCount } = await parseXmlDump(args.type, stream, async (entity) => {
      const discogsId = extractDiscogsId(entity);
      if (discogsId === null) {
        skipped++;
        return;
      }

      buffer.push({
        batch_id: batchId,
        entity_type: entityType,
        discogs_id: discogsId,
        raw_payload: JSON.stringify(entity.data),
      });

      if (buffer.length >= args.batchSize) {
        await flushBuffer();
      }
    });

    // Flush remaining
    await flushBuffer();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (entityCount / ((Date.now() - startTime) / 1000)).toFixed(0);

    console.log(
      `[ingest] Complete: ${totalWritten.toLocaleString()} ${args.type} written to raw_entities ` +
      `(${skipped} skipped, ${elapsed}s, ${rate}/s)`
    );

    // Update batch stats
    await db
      .updateTable("ingest.dump_batches")
      .set({
        stats: JSON.stringify({
          [args.type]: {
            parsed: entityCount,
            written: totalWritten,
            skipped,
            elapsed_seconds: parseFloat(elapsed),
            rate_per_second: parseInt(rate, 10),
          },
        }),
      })
      .where("id", "=", batchId)
      .execute();

    console.log(`[ingest] Batch ${batchId} — ${args.type} phase done`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
