/**
 * Migration 004: Replace btree unique index on release_identifiers with MD5 hashes.
 *
 * Reason: Some Discogs releases have identifier values or descriptions exceeding
 * the btree page size limit (~2,712 bytes). Postgres error 54000:
 * "Values larger than 1/3 of a buffer page cannot be indexed."
 *
 * Solution: Hash the unbounded text columns (value, description) with MD5.
 * This preserves uniqueness semantics while fitting within btree limits.
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // Drop the old constraint
  await sql`DROP INDEX catalog.uq_release_identifiers`.execute(db);

  // Create new constraint using MD5 hashes for the text columns
  await sql`
    CREATE UNIQUE INDEX uq_release_identifiers
    ON catalog.release_identifiers(batch_id, release_discogs_id, type, md5(value), md5(COALESCE(description, '')))
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX catalog.uq_release_identifiers`.execute(db);

  await sql`
    CREATE UNIQUE INDEX uq_release_identifiers
    ON catalog.release_identifiers(batch_id, release_discogs_id, type, value, COALESCE(description, ''))
  `.execute(db);
}
