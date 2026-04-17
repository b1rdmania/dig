/**
 * Migration 027: Extend `enrich.label_editorial` with palette + editorial
 * fields used by the redesign.
 *
 *   palette       JSONB   — { accent: "#hex", accent_ink: "#hex" }
 *   blurb         TEXT    — ≤50-word editorial blurb (serif italic on page)
 *   founded_year  INTEGER
 *   closed_year   INTEGER
 *   is_active     BOOLEAN — true if no closed_year, drives "1984—" vs "1984–2008"
 *   location      TEXT    — "Ghent, BE", "Berlin, DE", etc
 *
 * All columns are nullable. Backfilled by scripts/seed-label-editorial.ts.
 *
 * Idempotent — uses ADD COLUMN IF NOT EXISTS so it can run safely against
 * the existing table.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE enrich.label_editorial
      ADD COLUMN IF NOT EXISTS palette       JSONB,
      ADD COLUMN IF NOT EXISTS blurb         TEXT,
      ADD COLUMN IF NOT EXISTS founded_year  INTEGER,
      ADD COLUMN IF NOT EXISTS closed_year   INTEGER,
      ADD COLUMN IF NOT EXISTS is_active     BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS location      TEXT
  `.execute(db);

  await sql`
    COMMENT ON COLUMN enrich.label_editorial.palette IS
      'Canonical 2-colour palette: { accent, accent_ink }. Used for hairline rules, catalog stickers, label dots in search.'
  `.execute(db);

  await sql`
    COMMENT ON COLUMN enrich.label_editorial.blurb IS
      'Hand-written ≤50-word editorial. Voice: terse, factual, opinionated. Rendered serif italic on label pages.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE enrich.label_editorial
      DROP COLUMN IF EXISTS palette,
      DROP COLUMN IF EXISTS blurb,
      DROP COLUMN IF EXISTS founded_year,
      DROP COLUMN IF EXISTS closed_year,
      DROP COLUMN IF EXISTS is_active,
      DROP COLUMN IF EXISTS location
  `.execute(db);
}
