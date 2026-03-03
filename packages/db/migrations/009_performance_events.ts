/**
 * Migration 009: Performance events table (EN-D spike).
 *
 * Stores setlist.fm performance data for artist timeline enrichment.
 * Additive — no changes to existing tables.
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE enrich.performance_events (
      id BIGSERIAL PRIMARY KEY,
      discogs_artist_id INTEGER NOT NULL,
      event_date DATE NOT NULL,
      venue_name TEXT,
      city_name TEXT,
      country_name TEXT,
      country_code TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      tour_name TEXT,
      song_count INTEGER NOT NULL DEFAULT 0,
      setlistfm_id TEXT NOT NULL,
      setlistfm_url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'setlistfm',
      source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (setlistfm_id)
    )
  `.execute(db);

  await sql`CREATE INDEX idx_perf_events_artist ON enrich.performance_events(discogs_artist_id, event_date DESC)`.execute(db);
  await sql`CREATE INDEX idx_perf_events_date ON enrich.performance_events(event_date DESC)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.performance_events`.execute(db);
}
