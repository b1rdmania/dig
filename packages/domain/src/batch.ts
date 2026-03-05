import { sql } from "@dig/db";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";

/**
 * In-memory cache for batch resolution. Batch assignments change very
 * rarely (only on new ingest runs), so a 60s TTL avoids repeated
 * expensive EXISTS scans on large tables like catalog.releases (18.9M rows).
 */
const CACHE_TTL_MS = 60_000;
const batchCache = new Map<string, { batchId: string; dumpDate: string; expiresAt: number }>();

/**
 * Resolve the latest active/qa batch that actually has rows in a given table.
 *
 * Different entity types (artists, masters, releases, labels) may live in
 * different batches. Using a single "latest batch" globally causes 404s
 * for entity types that were ingested in an earlier batch.
 *
 * Results are cached in-memory for 60s to avoid repeated sequential scans
 * on large tables.
 */
export async function getBatchForTable(
  db: Kysely<Database>,
  table: string,
): Promise<{ batchId: string; dumpDate: string }> {
  const cached = batchCache.get(table);
  if (cached && Date.now() < cached.expiresAt) {
    return { batchId: cached.batchId, dumpDate: cached.dumpDate };
  }

  const result = await sql<{ id: string; dump_date: string }>`
    SELECT b.id, b.dump_date
    FROM ingest.dump_batches b
    WHERE b.status IN ('active', 'qa')
      AND EXISTS (
        SELECT 1
        FROM ${sql.table(table)} t
        WHERE t.batch_id = b.id
        LIMIT 1
      )
    ORDER BY b.created_at DESC
    LIMIT 1
  `.execute(db);

  const row = result.rows[0];
  if (!row) {
    throw new Error(`No active/qa batch found with rows in ${table}`);
  }

  batchCache.set(table, {
    batchId: row.id,
    dumpDate: row.dump_date,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return { batchId: row.id, dumpDate: row.dump_date };
}
