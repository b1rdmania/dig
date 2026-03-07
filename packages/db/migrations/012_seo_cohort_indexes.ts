import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Indexes for /v1/seo/cohort queries.
 *
 * Without these:
 *   - releases cohort: ~24s  (EXISTS on master_genres does 2.5M subqueries)
 *   - labels cohort:   ~95s  (GROUP BY/HAVING on 18.9M release_labels rows)
 *
 * After:
 *   - releases cohort: <1s
 *   - labels cohort:   <2s
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // EXISTS subquery: catalog.master_genres WHERE master_discogs_id = ? AND batch_id = ?
  await sql`
    CREATE INDEX IF NOT EXISTS idx_master_genres_batch_master
    ON catalog.master_genres (batch_id, master_discogs_id)
  `.execute(db);

  // EXISTS subquery: catalog.release_labels WHERE label_discogs_id = ? AND batch_id = ? LIMIT 1
  await sql`
    CREATE INDEX IF NOT EXISTS idx_release_labels_batch_label
    ON catalog.release_labels (batch_id, label_discogs_id)
  `.execute(db);

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
  await sql`DROP INDEX IF EXISTS catalog.idx_master_genres_batch_master`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_release_labels_batch_label`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_masters_batch_year`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_labels_batch_id`.execute(db);
}
