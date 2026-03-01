import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Add index on master_discogs_id for master → releases traversal.
 * Without this, getMasterReleases does a full table scan on 18.9M rows (~10s).
 * Partial index excludes NULL master_discogs_id rows (~30% of releases).
 *
 * Applied manually on Fly staging 2026-03-01; this migration ensures parity.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_releases_master
    ON catalog.releases (master_discogs_id)
    WHERE master_discogs_id IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS catalog.idx_releases_master`.execute(db);
}
