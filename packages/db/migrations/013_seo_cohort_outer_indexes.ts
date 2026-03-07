import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Additional indexes for /v1/seo/cohort outer query scans.
 *
 * 012 added inner-query indexes (master_genres, release_labels subqueries).
 * These cover the outer scans:
 *
 *   releases cohort: masters WHERE batch_id + main_release_discogs_id IS NOT NULL
 *                    ORDER BY year DESC, discogs_id — was ~24s, target <1s
 *
 *   labels cohort:   labels WHERE batch_id ORDER BY discogs_id — was ~70s, target <1s
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // Outer masters scan: WHERE batch_id = ? AND main_release_discogs_id IS NOT NULL ORDER BY year DESC
  await sql`
    CREATE INDEX IF NOT EXISTS idx_masters_batch_year
    ON catalog.masters (batch_id, year DESC NULLS LAST, discogs_id ASC)
    WHERE main_release_discogs_id IS NOT NULL
  `.execute(db);

  // Outer labels scan: WHERE batch_id = ? AND name NOT IN (...) ORDER BY discogs_id ASC
  await sql`
    CREATE INDEX IF NOT EXISTS idx_labels_batch_id
    ON catalog.labels (batch_id, discogs_id ASC)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS catalog.idx_masters_batch_year`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_labels_batch_id`.execute(db);
}
