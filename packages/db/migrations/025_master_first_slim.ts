import { type Kysely, sql } from "kysely";

/**
 * Master-first slim model.
 *
 * Adds the denormed columns + new derived tables that make `dig-db-scene`
 * a purpose-built read model for the slim master-first product surface
 * instead of a smaller copy of the source schema.
 *
 * See docs/scoped-catalog-90s-house-techno.md §"Master-First Lean Architecture"
 * for the full rationale. Summary:
 *
 *   - `catalog.masters` gets a wad of denormed columns lifted from
 *     `main_release` + `master_artists` + `master_genres` + `master_styles`
 *     so master cards / search results / label resolution all become
 *     single-table reads.
 *   - `catalog.master_tracks` (new) holds one canonical "Frankenstein"
 *     tracklist per master, derived from the highest-completeness in-scope
 *     release. Replaces shipping all of `catalog.tracks` (~24M rows).
 *   - `catalog.master_videos_unified` (new) aggregates `master_videos` +
 *     in-scope `release_videos` so per-version YouTube embeds (dubs,
 *     instrumentals, B-side mixes) stay discoverable without keeping the
 *     full release video table.
 *   - `catalog.artists.aliases_text` and `catalog.labels.aliases_text` are
 *     denormed `TEXT[]` columns so the "also known as" UI doesn't need a
 *     graph traversal. The source `catalog.artist_aliases` table is then
 *     dropped in migration `026`.
 *
 * Forward-only on the scoped DB. The columns are all nullable / default-empty
 * so this is also safe to apply on `dig-db` if we ever want to backfill
 * there for testing — none of them break existing queries.
 *
 * down() removes the columns + tables in reverse order.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. Denormed columns on catalog.masters
  // -------------------------------------------------------------------------
  // Populated by scripts/build-scoped-db.ts at scope-build time. All nullable
  // so the migration is reversible without backfill on existing DBs.
  await sql`
    ALTER TABLE catalog.masters
      ADD COLUMN IF NOT EXISTS primary_artist_discogs_id INTEGER,
      ADD COLUMN IF NOT EXISTS primary_artist_name       TEXT,
      ADD COLUMN IF NOT EXISTS artists_credit_text       TEXT,
      ADD COLUMN IF NOT EXISTS primary_label_discogs_id  INTEGER,
      ADD COLUMN IF NOT EXISTS primary_label_name        TEXT,
      ADD COLUMN IF NOT EXISTS primary_country           TEXT,
      ADD COLUMN IF NOT EXISTS primary_format            TEXT,
      ADD COLUMN IF NOT EXISTS genres                    TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS styles                    TEXT[] NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS scene_weight              INTEGER NOT NULL DEFAULT 0
  `.execute(db);

  // Hot indexes used by:
  //  - artist page "more by this artist"   → primary_artist_discogs_id
  //  - label page  "masters on this label" → primary_label_discogs_id
  //  - browse/filter "Detroit Techno 1991" → genres / styles GIN + year
  //  - search ranking + threshold filtering → scene_weight
  await sql`
    CREATE INDEX IF NOT EXISTS idx_masters_primary_artist
    ON catalog.masters (primary_artist_discogs_id)
    WHERE primary_artist_discogs_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_masters_primary_label
    ON catalog.masters (primary_label_discogs_id)
    WHERE primary_label_discogs_id IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_masters_genres_gin
    ON catalog.masters USING GIN (genres)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_masters_styles_gin
    ON catalog.masters USING GIN (styles)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_masters_scene_weight
    ON catalog.masters (scene_weight DESC)
  `.execute(db);

  await sql`
    COMMENT ON COLUMN catalog.masters.primary_artist_discogs_id IS
      'Denormed at scope-build from the first master_artists row. Single source of truth for master->artist resolution after master_artists itself is no longer queried at runtime.'
  `.execute(db);

  await sql`
    COMMENT ON COLUMN catalog.masters.primary_label_discogs_id IS
      'Denormed at scope-build from the main_release release_labels. Critical: catalog.releases is dropped on dig-db-scene, so this is the only path from master to label.'
  `.execute(db);

  await sql`
    COMMENT ON COLUMN catalog.masters.scene_weight IS
      'Derived score (data_quality + release count + countries + videos + tier-1 + named-artist + year-known). Used for both pruning at build time and ranking at query time.'
  `.execute(db);

  // -------------------------------------------------------------------------
  // 2. catalog.master_tracks — the Frankenstein tracklist
  // -------------------------------------------------------------------------
  // One canonical tracklist per master, lifted from the
  // highest-completeness in-scope release (preferring main_release) at
  // scope-build time. Replaces shipping catalog.tracks entirely.
  await sql`
    CREATE TABLE IF NOT EXISTS catalog.master_tracks (
      id                        BIGSERIAL   PRIMARY KEY,
      master_discogs_id         INTEGER     NOT NULL,
      position                  TEXT,
      title                     TEXT        NOT NULL,
      duration_seconds          INTEGER,
      artists_text              TEXT,
      source_release_discogs_id INTEGER     NOT NULL,
      built_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_master_tracks_master
    ON catalog.master_tracks (master_discogs_id, position)
  `.execute(db);

  await sql`
    COMMENT ON TABLE catalog.master_tracks IS
      'One canonical tracklist per master, derived at scope-build from the highest-completeness in-scope release (preferring main_release). source_release_discogs_id records which pressing the tracks were lifted from for outbound to Discogs.'
  `.execute(db);

  // -------------------------------------------------------------------------
  // 3. catalog.master_videos_unified — per-version YouTube discovery
  // -------------------------------------------------------------------------
  // Aggregates master-level + release-level videos so dub/instrumental/remix
  // YouTube embeds (which on Discogs typically live on the specific 12"
  // release page, not the master) stay discoverable.
  await sql`
    CREATE TABLE IF NOT EXISTS catalog.master_videos_unified (
      id                        BIGSERIAL   PRIMARY KEY,
      master_discogs_id         INTEGER     NOT NULL,
      source_type               TEXT        NOT NULL,
      source_release_discogs_id INTEGER,
      url                       TEXT        NOT NULL,
      title                     TEXT,
      duration_seconds          INTEGER,
      discogs_release_url       TEXT,
      built_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (source_type IN ('master', 'release'))
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_master_videos_unified_master
    ON catalog.master_videos_unified (master_discogs_id, source_type)
  `.execute(db);

  // Title trigram index lets the MCP do "find Juan Atkins dub mixes" type
  // searches efficiently. ~600k rows is fine for a single trgm index.
  await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_master_videos_unified_title_trgm
    ON catalog.master_videos_unified USING GIN (title gin_trgm_ops)
  `.execute(db);

  await sql`
    COMMENT ON TABLE catalog.master_videos_unified IS
      'Aggregated YouTube videos per master. Includes both master-level and in-scope release-level entries so per-pressing variants (dubs, instrumentals, B-side remixes) remain discoverable on dig-db-scene without keeping catalog.release_videos.'
  `.execute(db);

  // -------------------------------------------------------------------------
  // 4. Denormed aliases on catalog.artists and catalog.labels
  // -------------------------------------------------------------------------
  // Plain text array — no graph traversal, no extra query, no broken links
  // to out-of-scope entities. Source tables (catalog.artist_aliases) are
  // dropped in migration 026 once this is populated.
  await sql`
    ALTER TABLE catalog.artists
      ADD COLUMN IF NOT EXISTS aliases_text TEXT[] NOT NULL DEFAULT '{}'
  `.execute(db);

  await sql`
    ALTER TABLE catalog.labels
      ADD COLUMN IF NOT EXISTS aliases_text TEXT[] NOT NULL DEFAULT '{}'
  `.execute(db);

  await sql`
    COMMENT ON COLUMN catalog.artists.aliases_text IS
      'Denormed alias names from catalog.artist_aliases at scope-build. Display-only on artist pages — no link traversal. Source table dropped in migration 026 on dig-db-scene.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE catalog.labels  DROP COLUMN IF EXISTS aliases_text`.execute(db);
  await sql`ALTER TABLE catalog.artists DROP COLUMN IF EXISTS aliases_text`.execute(db);

  await sql`DROP TABLE IF EXISTS catalog.master_videos_unified`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.master_tracks`.execute(db);

  await sql`DROP INDEX IF EXISTS catalog.idx_masters_scene_weight`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_masters_styles_gin`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_masters_genres_gin`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_masters_primary_label`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_masters_primary_artist`.execute(db);

  await sql`
    ALTER TABLE catalog.masters
      DROP COLUMN IF EXISTS scene_weight,
      DROP COLUMN IF EXISTS styles,
      DROP COLUMN IF EXISTS genres,
      DROP COLUMN IF EXISTS primary_format,
      DROP COLUMN IF EXISTS primary_country,
      DROP COLUMN IF EXISTS primary_label_name,
      DROP COLUMN IF EXISTS primary_label_discogs_id,
      DROP COLUMN IF EXISTS artists_credit_text,
      DROP COLUMN IF EXISTS primary_artist_name,
      DROP COLUMN IF EXISTS primary_artist_discogs_id
  `.execute(db);
}
