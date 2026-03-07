import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Indexes for GET /v1/artists/:id/credits queries.
 *
 * Both release_credits and track_credits are queried by
 * (artist_discogs_id, batch_id) with release_discogs_id ordering.
 * Without indexes, each query scans millions of rows.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_release_credits_artist_batch
    ON catalog.release_credits (batch_id, artist_discogs_id, release_discogs_id ASC)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_track_credits_artist_batch
    ON catalog.track_credits (batch_id, artist_discogs_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS catalog.idx_release_credits_artist_batch`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_track_credits_artist_batch`.execute(db);
}
