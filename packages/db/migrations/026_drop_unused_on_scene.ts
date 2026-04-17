import { type Kysely, sql } from "kysely";

/**
 * Defensive drops for the slim master-first shape on dig-db-scene.
 *
 * After scripts/build-scoped-db.ts populates the denormed columns + new
 * derivation tables (master_tracks, master_videos_unified, aliases_text),
 * none of these source tables are read at runtime by the slim API or
 * frontend. Dropping them shrinks the scoped DB footprint and prevents
 * stale joins from re-introducing the removed surface area.
 *
 * This migration is a no-op on a freshly-migrated DB (the tables are
 * created earlier in the migration chain, so they exist when this runs)
 * — it only takes effect if the rest of the migration history runs first.
 *
 * On dig-db (the live full-catalog DB) we deliberately do NOT run this.
 * The migration is sequenced after the slim build step so we have full
 * control: the scope-build script populates the new columns/tables, then
 * we apply this drop. If anything looks wrong post-cutover, rollback is
 * "point Fly secrets back at dig-db" — the source tables are still intact
 * over there, untouched.
 *
 * down() is intentionally empty: there is no automatic recovery path. If
 * we need these tables back on dig-db-scene we re-run the full scope build.
 */
export async function up(db: Kysely<any>): Promise<void> {
  // -------------------------------------------------------------------------
  // catalog.releases family — replaced by release_shadow + denormed primary_*
  // -------------------------------------------------------------------------
  await sql`DROP TABLE IF EXISTS catalog.release_videos       CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_companies    CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_identifiers  CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_styles       CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_genres       CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_formats      CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_labels       CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_credits      CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.release_artists      CASCADE`.execute(db);

  await sql`DROP TABLE IF EXISTS catalog.track_credits        CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.tracks               CASCADE`.execute(db);

  // catalog.releases dropped LAST after its children, since the shadow does
  // not foreign-key to it (release_shadow.release_discogs_id is just an int).
  await sql`DROP TABLE IF EXISTS catalog.releases             CASCADE`.execute(db);

  // -------------------------------------------------------------------------
  // catalog.master child tables — replaced by denormed columns / unified video
  // -------------------------------------------------------------------------
  // master_genres / master_styles → denormed as TEXT[] on catalog.masters
  await sql`DROP TABLE IF EXISTS catalog.master_styles  CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.master_genres  CASCADE`.execute(db);
  // master_videos folded into catalog.master_videos_unified
  await sql`DROP TABLE IF EXISTS catalog.master_videos  CASCADE`.execute(db);

  // -------------------------------------------------------------------------
  // catalog.artist child tables — replaced by aliases_text or fully removed
  // -------------------------------------------------------------------------
  // aliases denormed onto catalog.artists.aliases_text TEXT[]
  await sql`DROP TABLE IF EXISTS catalog.artist_aliases          CASCADE`.execute(db);
  // name variations: search recall improvement only — marginal value, dropped
  await sql`DROP TABLE IF EXISTS catalog.artist_name_variations  CASCADE`.execute(db);
  // members / groups: no UI surface in slim product
  await sql`DROP TABLE IF EXISTS catalog.artist_members          CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS catalog.artist_groups           CASCADE`.execute(db);

  // -------------------------------------------------------------------------
  // enrich.* tables that never landed data
  // -------------------------------------------------------------------------
  // No enrichment data ever loaded beyond entity_quality + label_linkouts.
  // Drop the bookkeeping tables so the scoped DB doesn't carry empty schema
  // for a feature surface we removed.
  await sql`DROP TABLE IF EXISTS enrich.refresh_checkpoints CASCADE`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.ingest_batches      CASCADE`.execute(db);

  // usage_counters: runtime telemetry, recreated fresh on the new DB by
  // whatever instrumentation we wire up post-cutover.
  await sql`DROP TABLE IF EXISTS enrich.usage_counters      CASCADE`.execute(db);

  // -------------------------------------------------------------------------
  // ingest.raw_entities — only used during XML import, never at runtime
  // -------------------------------------------------------------------------
  // The scoped DB never re-runs ingest from XML. If we ever need to rebuild
  // we run scripts/build-scoped-db.ts against dig-db, not against the dump.
  await sql`DROP TABLE IF EXISTS ingest.raw_entities CASCADE`.execute(db);
}

export async function down(_db: Kysely<any>): Promise<void> {
  // No automatic recovery. To restore these tables, re-run the scope build
  // from dig-db (the live source still has them).
}
