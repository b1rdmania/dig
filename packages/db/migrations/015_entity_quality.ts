import type { Kysely } from "kysely";
import { sql } from "kysely";

/**
 * Data Quality Layer v1.
 *
 * Creates enrich.entity_quality — a separate (non-catalog) table that stores
 * deterministic quality scores for each entity. Kept in enrich.* schema so
 * catalog.* tables remain immutable (source of truth = Discogs CC0 data).
 *
 * quality_status values:
 *   active   — passes default quality filter (shown by default)
 *   low_value — exists but has low signal (hidden by default)
 *   suppressed — explicit suppression (hidden by default)
 *   invalid  — structurally broken record (hidden by default)
 *   orphan   — no meaningful links (future v2 rule)
 *
 * Read path: search defaults to quality_status = 'active' with ?quality=all override.
 * Rollback: set quality default to 'all' via feature flag or query param.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.entity_quality (
      entity_type       TEXT        NOT NULL,
      discogs_id        BIGINT      NOT NULL,
      batch_id          TEXT        NOT NULL,
      quality_status    TEXT        NOT NULL DEFAULT 'active',
      quality_reason    TEXT        NOT NULL DEFAULT 'default_active',
      quality_version   INTEGER     NOT NULL DEFAULT 1,
      quality_scored_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (entity_type, discogs_id),
      CHECK (entity_type IN ('artist', 'label', 'master', 'release')),
      CHECK (quality_status IN ('active', 'low_value', 'suppressed', 'invalid', 'orphan'))
    )
  `.execute(db);

  // Fast status filter index for search quality gate
  await sql`
    CREATE INDEX IF NOT EXISTS idx_entity_quality_status
    ON enrich.entity_quality (entity_type, quality_status)
  `.execute(db);

  // Lookup by ID list (used in post-fetch quality filter)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_entity_quality_discogs_id
    ON enrich.entity_quality (entity_type, discogs_id)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.entity_quality`.execute(db);
}
