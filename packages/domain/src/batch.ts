import { sql } from "@dig/db";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";

/**
 * In-memory cache for batch resolution. Batch assignments change very
 * rarely (only on new ingest runs), so a 60s TTL avoids repeated lookups.
 */
const CACHE_TTL_MS = 60_000;
const batchCache = new Map<string, { batchId: string; dumpDate: string; expiresAt: number }>();

/**
 * Resolve the latest active/qa batch that actually has rows in a given table.
 *
 * Two-step approach to avoid seq-scanning large tables (18.9M releases):
 * 1. Get all active/qa batches from the tiny dump_batches table (instant)
 * 2. For each batch (newest first), check existence with seqscan disabled
 *    so PG uses the (batch_id, discogs_id) unique index (~0.1ms)
 *
 * Results are cached in-memory for 60s.
 */
export async function getBatchForTable(
  db: Kysely<Database>,
  table: string,
): Promise<{ batchId: string; dumpDate: string }> {
  const cached = batchCache.get(table);
  if (cached && Date.now() < cached.expiresAt) {
    return { batchId: cached.batchId, dumpDate: cached.dumpDate };
  }

  // Step 1: Get all candidate batches (tiny table, instant)
  const batches = await sql<{ id: string; dump_date: string }>`
    SELECT id, dump_date
    FROM ingest.dump_batches
    WHERE status IN ('active', 'qa')
    ORDER BY created_at DESC
  `.execute(db);

  // Step 2: For each batch, check if it has rows in the target table.
  // Use a pinned connection with seqscan disabled so PG uses the
  // (batch_id, ...) btree index for a fast Index Only Scan (~0.1ms)
  // instead of seq-scanning millions of rows.
  const result = await db.connection().execute(async (conn) => {
    await sql`SET LOCAL enable_seqscan = off`.execute(conn);
    try {
      for (const batch of batches.rows) {
        const check = await sql<{ found: boolean }>`
          SELECT EXISTS (
            SELECT 1 FROM ${sql.table(table)}
            WHERE batch_id = ${batch.id}::uuid
          ) as found
        `.execute(conn);

        if (check.rows[0]?.found) {
          return { batchId: batch.id, dumpDate: batch.dump_date };
        }
      }
      return null;
    } finally {
      await sql`RESET enable_seqscan`.execute(conn).catch(() => {});
    }
  });

  if (!result) {
    throw new Error(`No active/qa batch found with rows in ${table}`);
  }

  batchCache.set(table, {
    batchId: result.batchId,
    dumpDate: result.dumpDate,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}
