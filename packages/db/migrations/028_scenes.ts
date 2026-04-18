/**
 * Migration 028: Scenes primitive.
 *
 * Three new tables in `enrich.*` to support the catalog wall (Phase C):
 *
 *   1. enrich.scenes — one row per curated scene (Detroit Core, Chicago House,
 *      Berlin Techno, etc.). Carries a slug (URL identifier), display name,
 *      city/era window, axis (geography / sound / era / cluster / bridge / micro),
 *      hero label, palette, and editorial blurb.
 *
 *   2. enrich.scene_labels — join table mapping scenes to their member labels.
 *      Carries a `role` (core / adjacent / bridge) and a `rank` for ordering
 *      within the wall strip. A label can belong to multiple scenes.
 *
 *   3. enrich.scene_bridges — directed edges between scenes that capture a
 *      genealogical connection (e.g. detroit-core → berlin-techno via
 *      Jeff Mills). Drives the "bridges" sidecar on the scene page and
 *      potentially the cross-cluster tie-lines on the catalog wall.
 *
 * All three live in enrich.* so catalog.* stays pure source-of-truth Discogs.
 *
 * Forward-only. Seeded from packages/db/seeds/scenes_v1.json via
 * scripts/seed-scenes.ts.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. enrich.scenes
  // ---------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.scenes (
      slug              TEXT        NOT NULL PRIMARY KEY,
      name              TEXT        NOT NULL,
      city              TEXT,
      era_start         INTEGER,
      era_end           INTEGER,
      parent_slug       TEXT        REFERENCES enrich.scenes(slug) ON DELETE SET NULL,
      axis              TEXT        NOT NULL,
      depth             INTEGER     NOT NULL DEFAULT 1,
      blurb             TEXT,
      hero_label_id     INTEGER,
      palette           JSONB,
      added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (axis IN ('geography', 'sound', 'era', 'cluster', 'bridge', 'micro'))
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scenes_axis ON enrich.scenes (axis)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scenes_parent ON enrich.scenes (parent_slug)
      WHERE parent_slug IS NOT NULL
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.scenes IS
      'Curated scenes for the catalog wall — geographic, sonic, era, cluster, bridge or micro-scene groupings of labels. Loaded from packages/db/seeds/scenes_v1.json.'
  `.execute(db);

  await sql`
    COMMENT ON COLUMN enrich.scenes.axis IS
      'Classification axis: geography (Detroit, Berlin), sound (Dub Techno, IDM), era (Acid 88), cluster (Basic Channel family), bridge (Detroit↔Berlin), micro (a tight micro-scene).'
  `.execute(db);

  await sql`
    COMMENT ON COLUMN enrich.scenes.palette IS
      'Optional override palette { accent, accent_ink }. Defaults to the hero_label_id palette if null.'
  `.execute(db);

  // ---------------------------------------------------------------------------
  // 2. enrich.scene_labels
  // ---------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.scene_labels (
      scene_slug        TEXT        NOT NULL REFERENCES enrich.scenes(slug) ON DELETE CASCADE,
      discogs_label_id  INTEGER     NOT NULL,
      role              TEXT        NOT NULL DEFAULT 'core',
      rank              INTEGER     NOT NULL DEFAULT 0,
      added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (scene_slug, discogs_label_id),
      CHECK (role IN ('core', 'adjacent', 'bridge'))
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scene_labels_label ON enrich.scene_labels (discogs_label_id)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scene_labels_rank ON enrich.scene_labels (scene_slug, rank ASC)
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.scene_labels IS
      'Membership join — labels in scenes. role=core for spine labels, adjacent for satellites, bridge for shared-with-another-scene labels. rank is the ordering within the wall strip (lower = more prominent).'
  `.execute(db);

  // ---------------------------------------------------------------------------
  // 3. enrich.scene_bridges
  // ---------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.scene_bridges (
      from_slug         TEXT        NOT NULL REFERENCES enrich.scenes(slug) ON DELETE CASCADE,
      to_slug           TEXT        NOT NULL REFERENCES enrich.scenes(slug) ON DELETE CASCADE,
      via_kind          TEXT        NOT NULL,
      via_id            INTEGER,
      via_name          TEXT,
      blurb             TEXT,
      added_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_slug, to_slug, via_kind, via_id),
      CHECK (via_kind IN ('artist', 'label', 'sound')),
      CHECK (from_slug <> to_slug)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scene_bridges_from ON enrich.scene_bridges (from_slug)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_scene_bridges_to ON enrich.scene_bridges (to_slug)
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.scene_bridges IS
      'Directed edges between scenes. via_kind=artist|label|sound names what carries the connection. via_id is the discogs id (artist or label) where applicable.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.scene_bridges`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.scene_labels`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.scenes`.execute(db);
}
