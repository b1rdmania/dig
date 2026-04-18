/**
 * Migration 029: Label essentials.
 *
 * Two tables in `enrich.*` to support the "core run" and directional
 * "if you like this, go here" blocks on label pages (Phase C, Step 6):
 *
 *   1. enrich.label_core_run — 5 to 10 hand-picked or auto-generated
 *      "essential listening" masters per label. Surfaced above the full
 *      catalog spine. `source` distinguishes auto-seeded entries from
 *      hand-curated ones so a future curated pass can override safely.
 *
 *   2. enrich.label_related — directional edges between labels:
 *      label A → label B with a `direction` tag drawn from a fixed
 *      8-value vocabulary. Powers the "more raw / more minimal /
 *      poppier / etc." sidebar on label pages.
 *
 * The 8 directions are a deliberately tight vocabulary so the UI can
 * group / colour them, and so we can aggregate across labels later.
 *
 * Forward-only. Auto-seeded by scripts/seed-label-essentials.ts and
 * hand-seeded by packages/db/seeds/label_related_v1.json.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. enrich.label_core_run
  // ---------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.label_core_run (
      discogs_label_id   INTEGER     NOT NULL,
      master_discogs_id  BIGINT      NOT NULL,
      rank               INTEGER     NOT NULL,
      source             TEXT        NOT NULL DEFAULT 'auto',
      note               TEXT,
      added_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (discogs_label_id, master_discogs_id),
      CHECK (source IN ('auto', 'curated')),
      CHECK (rank >= 1 AND rank <= 25)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_label_core_run_rank
      ON enrich.label_core_run (discogs_label_id, rank ASC)
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.label_core_run IS
      'Per-label "core run" — 5 to 10 essential masters that define the label, surfaced above the full catalog spine. source=auto entries are deterministically derived from catalog.masters.scene_weight; source=curated entries are hand-picked and take precedence.'
  `.execute(db);

  // ---------------------------------------------------------------------------
  // 2. enrich.label_related — directional "if you like this" edges
  // ---------------------------------------------------------------------------
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.label_related (
      from_label_id   INTEGER     NOT NULL,
      to_label_id     INTEGER     NOT NULL,
      direction       TEXT        NOT NULL,
      rank            INTEGER     NOT NULL DEFAULT 0,
      blurb           TEXT,
      added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (from_label_id, to_label_id, direction),
      CHECK (from_label_id <> to_label_id),
      CHECK (direction IN (
        'deeper', 'harder', 'rawer', 'cleaner',
        'weirder', 'poppier', 'earlier', 'later'
      ))
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_label_related_from
      ON enrich.label_related (from_label_id, direction, rank ASC)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_label_related_to
      ON enrich.label_related (to_label_id)
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.label_related IS
      'Directional "if you like this, go here" edges between labels. The 8-value direction vocabulary (deeper/harder/rawer/cleaner/weirder/poppier/earlier/later) is fixed so the UI can group and the system can aggregate across labels later.'
  `.execute(db);

  await sql`
    COMMENT ON COLUMN enrich.label_related.direction IS
      'Direction relative to from_label: deeper=more dub/atmospheric, harder=more peak-time/aggro, rawer=more lo-fi/jacking, cleaner=more polished/tech, weirder=more leftfield, poppier=more commercial, earlier=predecessor/source, later=successor/heir.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.label_related`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.label_core_run`.execute(db);
}
