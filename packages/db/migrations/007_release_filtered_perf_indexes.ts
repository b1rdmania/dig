import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Phase 4 search hardening:
 * Add composite index to improve filtered release queries under concurrency
 * (notably genre+year + recency ordering paths).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_releases_year_discogs
    ON catalog.releases(batch_id, release_year, discogs_id DESC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS catalog.idx_releases_year_discogs`.execute(db);
}

