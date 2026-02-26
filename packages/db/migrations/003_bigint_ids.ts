/**
 * Migration 003: Convert all catalog surrogate IDs from integer to bigint.
 *
 * Reason: tracks table will reach ~150M rows per full Discogs dump import.
 * Multiple imports over time would exceed int32 max (2.1B). Converting all
 * tables for consistency.
 *
 * Also converts track_credits.track_id (FK to tracks.id).
 */

import { type Kysely, sql } from "kysely";

const CATALOG_TABLES = [
  "catalog.artists",
  "catalog.artist_aliases",
  "catalog.artist_groups",
  "catalog.artist_members",
  "catalog.artist_name_variations",
  "catalog.artist_urls",
  "catalog.labels",
  "catalog.label_urls",
  "catalog.masters",
  "catalog.master_artists",
  "catalog.master_genres",
  "catalog.master_styles",
  "catalog.master_videos",
  "catalog.releases",
  "catalog.release_artists",
  "catalog.release_companies",
  "catalog.release_credits",
  "catalog.release_formats",
  "catalog.release_genres",
  "catalog.release_identifiers",
  "catalog.release_labels",
  "catalog.release_styles",
  "catalog.release_videos",
  "catalog.tracks",
  "catalog.track_credits",
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const table of CATALOG_TABLES) {
    // Convert id column to bigint
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN id SET DATA TYPE bigint`.execute(db);

    // Convert the backing sequence to bigint too
    const seqResult = await sql<{ seq: string | null }>`
      SELECT pg_get_serial_sequence(${table}, 'id') as seq
    `.execute(db);
    const seqName = seqResult.rows[0]?.seq;
    if (seqName) {
      await sql`ALTER SEQUENCE ${sql.raw(seqName)} AS bigint`.execute(db);
    }
  }

  // Convert FK column: track_credits.track_id references tracks.id
  await sql`ALTER TABLE catalog.track_credits ALTER COLUMN track_id SET DATA TYPE bigint`.execute(db);
}

/**
 * WARNING: down migration will fail if any id values exceed int32 max (2,147,483,647).
 * Only safe to run before large production data volumes.
 */
export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE catalog.track_credits ALTER COLUMN track_id SET DATA TYPE integer`.execute(db);

  for (const table of CATALOG_TABLES) {
    await sql`ALTER TABLE ${sql.table(table)} ALTER COLUMN id SET DATA TYPE integer`.execute(db);

    const seqResult = await sql<{ seq: string | null }>`
      SELECT pg_get_serial_sequence(${table}, 'id') as seq
    `.execute(db);
    const seqName = seqResult.rows[0]?.seq;
    if (seqName) {
      await sql`ALTER SEQUENCE ${sql.raw(seqName)} AS integer`.execute(db);
    }
  }
}
