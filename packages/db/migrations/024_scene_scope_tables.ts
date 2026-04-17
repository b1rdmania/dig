import { type Kysely, sql } from "kysely";

/**
 * Scene-scope reset infrastructure.
 *
 * Three new tables to support the master-first, style-scoped catalog:
 *
 *   1. enrich.label_editorial — editorial tier metadata for labels.
 *      Loaded from packages/db/seeds/label_editorial_tier1.csv via the
 *      seed script (scripts/seed-label-editorial.ts). Used purely for
 *      display (badge on master/label pages, optional ranking nudge).
 *      Does NOT gate inclusion. Stays in enrich.* so catalog.* remains
 *      pure source-of-truth Discogs data.
 *
 *   2. enrich.scene_scope_audit — provenance log of which scope rules
 *      built the active scoped DB. One row per build run. Used for
 *      "what's actually in here?" introspection and reproducibility.
 *
 *   3. catalog.release_shadow — thin denormalised release rows kept on
 *      the scoped DB to power the master page's "Notable Versions"
 *      section without needing to expose public release/version routes.
 *      Populated at scope-build time by scripts/build-scoped-db.ts.
 *
 * All three are forward-only: the scoped DB is built fresh, not migrated
 * in place, so down() returns to a clean drop without data preservation.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // -------------------------------------------------------------------------
  // 1. enrich.label_editorial
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.label_editorial (
      discogs_label_id INTEGER     NOT NULL PRIMARY KEY,
      tier             TEXT        NOT NULL,
      notes            TEXT,
      source           TEXT        NOT NULL DEFAULT 'seed:label_editorial_tier1.csv',
      added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (tier IN ('tier1', 'denylist'))
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_label_editorial_tier
    ON enrich.label_editorial (tier)
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.label_editorial IS
      'Editorial tier metadata for labels — display-only, does not gate inclusion. Loaded from packages/db/seeds/label_editorial_tier1.csv.'
  `.execute(db);

  // -------------------------------------------------------------------------
  // 2. enrich.scene_scope_audit
  // -------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.scene_scope_audit (
      id               BIGSERIAL    PRIMARY KEY,
      built_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
      source_batch_id  UUID         NOT NULL,
      year_min         INTEGER      NOT NULL,
      year_max         INTEGER      NOT NULL,
      style_allowlist  TEXT[]       NOT NULL,
      quality_filter   BOOLEAN      NOT NULL,
      breakbeat_year_gate INTEGER,
      counts           JSONB        NOT NULL DEFAULT '{}'::jsonb,
      notes            TEXT
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scene_scope_audit_built_at
    ON enrich.scene_scope_audit (built_at DESC)
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.scene_scope_audit IS
      'One row per scope-build run on this database. Captures the rules that defined the active scope so we can reproduce or diff future builds.'
  `.execute(db);

  // -------------------------------------------------------------------------
  // 3. catalog.release_shadow
  // -------------------------------------------------------------------------
  // Thin per-release denormalised row. Field choices match the exec summary's
  // "release shadow layer" spec. We do NOT bring tracklist or full credit detail
  // — Discogs is the escape hatch for that.
  await sql`
    CREATE TABLE IF NOT EXISTS catalog.release_shadow (
      release_discogs_id     INTEGER     NOT NULL PRIMARY KEY,
      master_discogs_id      INTEGER,
      title                  TEXT        NOT NULL,
      release_year           INTEGER,
      country                TEXT,
      label                  TEXT,
      format                 TEXT,
      is_main_release        BOOLEAN     NOT NULL DEFAULT FALSE,
      has_tracklist_delta    BOOLEAN     NOT NULL DEFAULT FALSE,
      has_remix_signal       BOOLEAN     NOT NULL DEFAULT FALSE,
      discogs_url            TEXT,
      built_at               TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  // The hot lookup is "give me the notable versions for master M":
  // SELECT ... FROM release_shadow WHERE master_discogs_id = $1
  //   ORDER BY is_main_release DESC, has_remix_signal DESC, release_year ASC
  //   LIMIT 5
  await sql`
    CREATE INDEX IF NOT EXISTS idx_release_shadow_master
    ON catalog.release_shadow (master_discogs_id, is_main_release DESC, release_year ASC)
  `.execute(db);

  await sql`
    COMMENT ON TABLE catalog.release_shadow IS
      'Thin per-release rows kept on the scoped DB to power the master page Notable Versions section. Public release/version routes are removed.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS catalog.release_shadow`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.scene_scope_audit`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.label_editorial`.execute(db);
}
