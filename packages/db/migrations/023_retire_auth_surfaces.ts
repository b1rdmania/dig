import { type Kysely, sql } from "kysely";

/**
 * Retire the `auth.*` schema in full.
 *
 * Context
 * -------
 * The `auth` schema was created in migration 001 and extended by 018–022 to
 * support Clerk + Stripe + Mixtapes + Spotify export. None of those features
 * ship in the current product. The application code that referenced these
 * tables has been removed. This migration drops the entire schema so the DB
 * matches the codebase.
 *
 * Rate limiting today uses env-var API keys (not `auth.api_keys`), so dropping
 * these tables has no runtime effect.
 *
 * `DROP SCHEMA ... CASCADE` will drop every table, index, and constraint
 * inside `auth` (including `auth.users`, `auth.api_keys`, `auth.mixtapes`,
 * `auth.spotify_tokens`, `auth.mixtape_export_jobs`, and everything else).
 */
export async function up(db: Kysely<any>): Promise<void> {
  await sql`DROP SCHEMA IF EXISTS auth CASCADE`.execute(db);
}

/**
 * Intentionally empty. Recreating the auth schema would require replaying
 * migrations 001 and 018–022 verbatim; if that's ever needed, restore from a
 * pre-migration backup instead.
 */
export async function down(_db: Kysely<any>): Promise<void> {
  // no-op
}
