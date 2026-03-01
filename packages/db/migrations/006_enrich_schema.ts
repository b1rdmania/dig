/**
 * Migration 006: Enrichment schema (EN-A foundation).
 *
 * Creates the `enrich` schema with 7 tables for crosswalks,
 * relationship edges, entity context, and review queue.
 * Schema-only, additive — no changes to `catalog.*`.
 *
 * See: docs/enrichment-migration-spec-en-a.md
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS enrich`.execute(db);

  // Batch tracking for enrichment sources
  await sql`
    CREATE TABLE enrich.ingest_batches (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm')),
      source_batch_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'importing', 'qa', 'active', 'superseded', 'failed')),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      stats JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source, source_batch_key)
    )
  `.execute(db);

  await sql`
    CREATE TABLE enrich.refresh_checkpoints (
      id BIGSERIAL PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm')),
      checkpoint_key TEXT NOT NULL,
      checkpoint_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (source, checkpoint_key)
    )
  `.execute(db);

  // Crosswalks: Discogs IDs to external IDs
  await sql`
    CREATE TABLE enrich.artist_crosswalks (
      id BIGSERIAL PRIMARY KEY,
      discogs_artist_id INTEGER NOT NULL,
      mbid TEXT,
      wikidata_qid TEXT,
      setlistfm_artist_id TEXT,
      confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
      match_method TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (discogs_artist_id)
    )
  `.execute(db);

  await sql`CREATE UNIQUE INDEX uq_artist_crosswalks_mbid ON enrich.artist_crosswalks(mbid) WHERE mbid IS NOT NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX uq_artist_crosswalks_wikidata ON enrich.artist_crosswalks(wikidata_qid) WHERE wikidata_qid IS NOT NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX uq_artist_crosswalks_setlist ON enrich.artist_crosswalks(setlistfm_artist_id) WHERE setlistfm_artist_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX idx_artist_crosswalks_confidence ON enrich.artist_crosswalks(confidence DESC)`.execute(db);

  await sql`
    CREATE TABLE enrich.label_crosswalks (
      id BIGSERIAL PRIMARY KEY,
      discogs_label_id INTEGER NOT NULL,
      mbid TEXT,
      wikidata_qid TEXT,
      confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
      match_method TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (discogs_label_id)
    )
  `.execute(db);

  await sql`CREATE UNIQUE INDEX uq_label_crosswalks_mbid ON enrich.label_crosswalks(mbid) WHERE mbid IS NOT NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX uq_label_crosswalks_wikidata ON enrich.label_crosswalks(wikidata_qid) WHERE wikidata_qid IS NOT NULL`.execute(db);
  await sql`CREATE INDEX idx_label_crosswalks_confidence ON enrich.label_crosswalks(confidence DESC)`.execute(db);

  await sql`
    CREATE TABLE enrich.release_crosswalks (
      id BIGSERIAL PRIMARY KEY,
      discogs_release_id INTEGER NOT NULL,
      mbid TEXT,
      confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
      match_method TEXT NOT NULL,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (discogs_release_id)
    )
  `.execute(db);

  await sql`CREATE UNIQUE INDEX uq_release_crosswalks_mbid ON enrich.release_crosswalks(mbid) WHERE mbid IS NOT NULL`.execute(db);
  await sql`CREATE INDEX idx_release_crosswalks_confidence ON enrich.release_crosswalks(confidence DESC)`.execute(db);

  // Typed relationship edges
  await sql`
    CREATE TABLE enrich.relationship_edges (
      id BIGSERIAL PRIMARY KEY,
      source_entity_type TEXT NOT NULL CHECK (source_entity_type IN ('artist', 'label', 'release', 'master')),
      source_discogs_id INTEGER NOT NULL,
      target_entity_type TEXT NOT NULL CHECK (target_entity_type IN ('artist', 'label', 'release', 'master', 'external')),
      target_discogs_id INTEGER,
      target_external_id TEXT,
      edge_type TEXT NOT NULL,
      edge_source TEXT NOT NULL CHECK (edge_source IN ('musicbrainz', 'wikidata', 'setlistfm')),
      edge_source_id TEXT NOT NULL,
      confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
      match_method TEXT NOT NULL,
      valid_from DATE,
      valid_to DATE,
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      edge_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (edge_key)
    )
  `.execute(db);

  await sql`CREATE INDEX idx_relationship_edges_source ON enrich.relationship_edges(source_entity_type, source_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_relationship_edges_target ON enrich.relationship_edges(target_entity_type, target_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_relationship_edges_type ON enrich.relationship_edges(edge_type)`.execute(db);
  await sql`CREATE INDEX idx_relationship_edges_confidence ON enrich.relationship_edges(confidence DESC)`.execute(db);
  await sql`CREATE INDEX idx_relationship_edges_source_batch ON enrich.relationship_edges(source_batch_id)`.execute(db);

  // Context blocks (bio/history/scene/location/timeline)
  await sql`
    CREATE TABLE enrich.entity_context (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('artist', 'label', 'release', 'master')),
      discogs_id INTEGER NOT NULL,
      context_type TEXT NOT NULL CHECK (context_type IN ('bio', 'history', 'scene', 'location', 'timeline_note')),
      content_json JSONB NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm')),
      source_id TEXT NOT NULL,
      confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
      match_method TEXT NOT NULL,
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      context_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (context_key)
    )
  `.execute(db);

  await sql`CREATE INDEX idx_entity_context_lookup ON enrich.entity_context(entity_type, discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_entity_context_type ON enrich.entity_context(context_type)`.execute(db);
  await sql`CREATE INDEX idx_entity_context_confidence ON enrich.entity_context(confidence DESC)`.execute(db);
  await sql`CREATE INDEX idx_entity_context_gin ON enrich.entity_context USING GIN (content_json jsonb_path_ops)`.execute(db);

  // Low-confidence manual review queue
  await sql`
    CREATE TABLE enrich.match_review_queue (
      id BIGSERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('artist', 'label', 'release')),
      discogs_id INTEGER NOT NULL,
      candidate_source TEXT NOT NULL CHECK (candidate_source IN ('musicbrainz', 'wikidata', 'setlistfm')),
      candidate_id TEXT NOT NULL,
      candidate_payload JSONB NOT NULL,
      confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      match_method TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (entity_type, discogs_id, candidate_source, candidate_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX idx_match_review_pending
    ON enrich.match_review_queue(status, confidence, created_at)
    WHERE status = 'pending'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.match_review_queue`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.entity_context`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.relationship_edges`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.release_crosswalks`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.label_crosswalks`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.artist_crosswalks`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.refresh_checkpoints`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.ingest_batches`.execute(db);
  await sql`DROP SCHEMA IF EXISTS enrich`.execute(db);
}
