import { sql } from "@dig/db";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";

/**
 * Resolve the latest active/qa batch that actually has rows in a given table.
 *
 * Different entity types (artists, masters, releases, labels) may live in
 * different batches. Using a single "latest batch" globally causes 404s
 * for entity types that were ingested in an earlier batch.
 */
export async function getBatchForTable(
  db: Kysely<Database>,
  table: string,
): Promise<{ batchId: string; dumpDate: string }> {
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

  return { batchId: row.id, dumpDate: row.dump_date };
}
