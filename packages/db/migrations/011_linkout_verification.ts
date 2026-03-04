/**
 * Migration 011: Add verification audit columns to label_linkouts.
 *
 * Supports agent-assisted verification queue: URL health checks,
 * domain matching, handle consistency — with human gate for ambiguous cases.
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE enrich.label_linkouts
      ADD COLUMN check_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (check_status IN ('pending', 'verified', 'needs_review', 'invalid')),
      ADD COLUMN checked_at TIMESTAMPTZ,
      ADD COLUMN check_method TEXT,
      ADD COLUMN check_evidence JSONB,
      ADD COLUMN check_score NUMERIC(4,3)
  `.execute(db);

  await sql`CREATE INDEX idx_label_linkouts_check_status ON enrich.label_linkouts(check_status)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS enrich.idx_label_linkouts_check_status`.execute(db);
  await sql`
    ALTER TABLE enrich.label_linkouts
      DROP COLUMN IF EXISTS check_status,
      DROP COLUMN IF EXISTS checked_at,
      DROP COLUMN IF EXISTS check_method,
      DROP COLUMN IF EXISTS check_evidence,
      DROP COLUMN IF EXISTS check_score
  `.execute(db);
}
