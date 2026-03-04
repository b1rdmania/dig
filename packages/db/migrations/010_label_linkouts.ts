/**
 * Migration 010: Label linkouts for Bandcamp/Instagram (EN-E).
 *
 * Adds a dedicated enrichment table for deterministic label social/store links
 * derived from known URLs in the Discogs ingest.
 *
 * Also extends enrich source checks to include `linkout` for ingest batching.
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // Extend source enum checks for ingest bookkeeping.
  await sql`ALTER TABLE enrich.ingest_batches DROP CONSTRAINT IF EXISTS ingest_batches_source_check`.execute(db);
  await sql`
    ALTER TABLE enrich.ingest_batches
    ADD CONSTRAINT ingest_batches_source_check
    CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm', 'linkout'))
  `.execute(db);

  await sql`ALTER TABLE enrich.refresh_checkpoints DROP CONSTRAINT IF EXISTS refresh_checkpoints_source_check`.execute(db);
  await sql`
    ALTER TABLE enrich.refresh_checkpoints
    ADD CONSTRAINT refresh_checkpoints_source_check
    CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm', 'linkout'))
  `.execute(db);

  await sql`
    CREATE TABLE enrich.label_linkouts (
      id BIGSERIAL PRIMARY KEY,
      discogs_label_id INTEGER NOT NULL,
      provider TEXT NOT NULL CHECK (provider IN ('bandcamp', 'instagram')),
      url TEXT NOT NULL,
      handle TEXT,
      confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
      match_method TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (discogs_label_id, provider)
    )
  `.execute(db);

  await sql`CREATE INDEX idx_label_linkouts_provider ON enrich.label_linkouts(provider)`.execute(db);
  await sql`CREATE INDEX idx_label_linkouts_confidence ON enrich.label_linkouts(confidence DESC)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.label_linkouts`.execute(db);

  // Revert source check constraints to original set.
  await sql`ALTER TABLE enrich.refresh_checkpoints DROP CONSTRAINT IF EXISTS refresh_checkpoints_source_check`.execute(db);
  await sql`
    ALTER TABLE enrich.refresh_checkpoints
    ADD CONSTRAINT refresh_checkpoints_source_check
    CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm'))
  `.execute(db);

  await sql`ALTER TABLE enrich.ingest_batches DROP CONSTRAINT IF EXISTS ingest_batches_source_check`.execute(db);
  await sql`
    ALTER TABLE enrich.ingest_batches
    ADD CONSTRAINT ingest_batches_source_check
    CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm'))
  `.execute(db);
}
