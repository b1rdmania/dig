/**
 * Kysely database type definitions.
 * Tables are added here as migrations create them.
 * This is the single source of truth for DB types across the monorepo.
 */

import type { Generated, ColumnType } from "kysely";

// --- Ingest ---

export interface DumpBatchesTable {
  id: Generated<string>;
  dump_date: string;
  status: "pending" | "importing" | "qa" | "active" | "active_fallback" | "superseded" | "failed";
  started_at: ColumnType<Date, Date | undefined, Date | undefined>;
  completed_at: ColumnType<Date, Date | undefined, Date | undefined>;
  stats: ColumnType<unknown, unknown | undefined, unknown | undefined>;
  created_at: Generated<Date>;
}

export interface RawEntitiesTable {
  id: Generated<string>;
  batch_id: string;
  entity_type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  raw_payload: unknown;
  created_at: Generated<Date>;
}

// --- Catalog: Core entities ---

export interface CatalogArtistsTable {
  id: Generated<number>;
  discogs_id: number;
  name: string;
  real_name: string | null;
  profile: string | null;
  data_quality: string;
  batch_id: string;
  search_vector: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  // Slim model (migration 025): denormed alias names, display-only.
  // Defaults to '{}' so existing rows on dig-db remain valid.
  aliases_text: Generated<string[]>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CatalogLabelsTable {
  id: Generated<number>;
  discogs_id: number;
  name: string;
  profile: string | null;
  contact_info: string | null;
  data_quality: string;
  parent_label_discogs_id: number | null;
  batch_id: string;
  search_vector: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  // Slim model (migration 025): denormed label aliases, display-only.
  aliases_text: Generated<string[]>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CatalogMastersTable {
  id: Generated<number>;
  discogs_id: number;
  title: string;
  main_release_discogs_id: number | null;
  year: number | null;
  data_quality: string;
  batch_id: string;
  search_vector: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  // Slim model (migration 025): denormed columns populated at scope-build
  // by scripts/build-scoped-db.ts. All nullable / default-empty so the
  // migration is reversible without a backfill.
  primary_artist_discogs_id: number | null;
  primary_artist_name: string | null;
  artists_credit_text: string | null;
  primary_label_discogs_id: number | null;
  primary_label_name: string | null;
  primary_country: string | null;
  primary_format: string | null;
  genres: Generated<string[]>;
  styles: Generated<string[]>;
  scene_weight: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CatalogMasterTracksTable {
  id: Generated<number>;
  master_discogs_id: number;
  position: string | null;
  title: string;
  duration_seconds: number | null;
  artists_text: string | null;
  source_release_discogs_id: number;
  built_at: Generated<Date>;
}

export interface CatalogMasterVideosUnifiedTable {
  id: Generated<number>;
  master_discogs_id: number;
  source_type: "master" | "release";
  source_release_discogs_id: number | null;
  url: string;
  title: string | null;
  duration_seconds: number | null;
  discogs_release_url: string | null;
  built_at: Generated<Date>;
}

export interface CatalogReleasesTable {
  id: Generated<number>;
  discogs_id: number;
  status: string;
  title: string;
  country: string | null;
  released_raw: string | null;
  release_year: number | null;
  release_month: number | null;
  release_day: number | null;
  notes: string | null;
  data_quality: string;
  master_discogs_id: number | null;
  is_main_release: boolean | null;
  batch_id: string;
  search_vector: ColumnType<string | null, string | null | undefined, string | null | undefined>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

// --- Catalog: Artist child tables ---

export interface ArtistUrlsTable {
  id: Generated<number>;
  artist_discogs_id: number;
  url: string;
  batch_id: string;
}

export interface ArtistNameVariationsTable {
  id: Generated<number>;
  artist_discogs_id: number;
  name: string;
  batch_id: string;
}

export interface ArtistAliasesTable {
  id: Generated<number>;
  artist_discogs_id: number;
  alias_name: string;
  alias_discogs_id: number | null;
  batch_id: string;
}

export interface ArtistGroupsTable {
  id: Generated<number>;
  artist_discogs_id: number;
  group_name: string;
  group_discogs_id: number | null;
  batch_id: string;
}

export interface ArtistMembersTable {
  id: Generated<number>;
  artist_discogs_id: number;
  member_name: string;
  member_discogs_id: number | null;
  batch_id: string;
}

// --- Catalog: Label child tables ---

export interface LabelUrlsTable {
  id: Generated<number>;
  label_discogs_id: number;
  url: string;
  batch_id: string;
}

// --- Catalog: Master child tables ---

export interface MasterArtistsTable {
  id: Generated<number>;
  master_discogs_id: number;
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  join_relation: string | null;
  position: number;
  batch_id: string;
}

export interface MasterGenresTable {
  id: Generated<number>;
  master_discogs_id: number;
  genre: string;
  batch_id: string;
}

export interface MasterStylesTable {
  id: Generated<number>;
  master_discogs_id: number;
  style: string;
  batch_id: string;
}

export interface MasterVideosTable {
  id: Generated<number>;
  master_discogs_id: number;
  url: string;
  duration_seconds: number | null;
  title: string | null;
  description: string | null;
  batch_id: string;
}

// --- Catalog: Release child tables ---

export interface ReleaseArtistsTable {
  id: Generated<number>;
  release_discogs_id: number;
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  join_relation: string | null;
  role: string | null;
  position: number;
  batch_id: string;
}

export interface ReleaseCreditsTable {
  id: Generated<number>;
  release_discogs_id: number;
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  role: string | null;
  batch_id: string;
}

export interface ReleaseLabelsTable {
  id: Generated<number>;
  release_discogs_id: number;
  label_discogs_id: number;
  label_name: string;
  catno: string | null;
  batch_id: string;
}

export interface ReleaseFormatsTable {
  id: Generated<number>;
  release_discogs_id: number;
  name: string;
  qty: number | null;
  text: string | null;
  descriptions: string[] | null;
  position: number;
  batch_id: string;
}

export interface ReleaseGenresTable {
  id: Generated<number>;
  release_discogs_id: number;
  genre: string;
  batch_id: string;
}

export interface ReleaseStylesTable {
  id: Generated<number>;
  release_discogs_id: number;
  style: string;
  batch_id: string;
}

export interface ReleaseIdentifiersTable {
  id: Generated<number>;
  release_discogs_id: number;
  type: string;
  value: string;
  description: string | null;
  batch_id: string;
}

export interface ReleaseCompaniesTable {
  id: Generated<number>;
  release_discogs_id: number;
  company_discogs_id: number;
  company_name: string;
  catno: string | null;
  entity_type: string | null;
  entity_type_name: string | null;
  batch_id: string;
}

export interface ReleaseVideosTable {
  id: Generated<number>;
  release_discogs_id: number;
  url: string;
  duration_seconds: number | null;
  title: string | null;
  description: string | null;
  batch_id: string;
}

// --- Catalog: Track tables ---

export interface TracksTable {
  id: Generated<number>;
  release_discogs_id: number;
  position_raw: string | null;
  disc_number: number | null;
  track_number: string | null;
  title: string | null;
  duration_raw: string | null;
  duration_seconds: number | null;
  position: number;
  batch_id: string;
}

export interface TrackCreditsTable {
  id: Generated<number>;
  track_id: number;
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  role: string | null;
  batch_id: string;
}

// --- Enrich ---

export interface EnrichEntityQualityTable {
  entity_type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  batch_id: string;
  quality_status: "active" | "low_value" | "suppressed" | "invalid" | "orphan";
  quality_reason: string;
  quality_version: number;
  quality_scored_at: Date;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EnrichLabelLinkoutsTable {
  id: Generated<number>;
  discogs_label_id: number;
  provider: "bandcamp" | "instagram";
  url: string;
  handle: string | null;
  confidence: number;
  match_method: string;
  is_verified: boolean;
  source_batch_id: number | null;
  check_status: Generated<"pending" | "verified" | "needs_review" | "invalid">;
  checked_at: Date | null;
  check_method: string | null;
  check_evidence: unknown | null;
  check_score: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EnrichUsageCountersTable {
  counter_key: string;
  counter_value: ColumnType<number, number | undefined, number | undefined>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EnrichLabelEditorialTable {
  discogs_label_id: number;
  tier: "tier1" | "denylist";
  notes: string | null;
  source: Generated<string>;
  added_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface EnrichSceneScopeAuditTable {
  id: Generated<number>;
  built_at: Generated<Date>;
  source_batch_id: string;
  year_min: number;
  year_max: number;
  style_allowlist: string[];
  quality_filter: boolean;
  breakbeat_year_gate: number | null;
  counts: Generated<unknown>;
  notes: string | null;
}

export interface CatalogReleaseShadowTable {
  release_discogs_id: number;
  master_discogs_id: number | null;
  title: string;
  release_year: number | null;
  country: string | null;
  label: string | null;
  format: string | null;
  is_main_release: Generated<boolean>;
  has_tracklist_delta: Generated<boolean>;
  has_remix_signal: Generated<boolean>;
  discogs_url: string | null;
  built_at: Generated<Date>;
}

// --- Database interface ---

export interface Database {
  // Ingest
  "ingest.dump_batches": DumpBatchesTable;
  "ingest.raw_entities": RawEntitiesTable;

  // Catalog: core entities
  "catalog.artists": CatalogArtistsTable;
  "catalog.labels": CatalogLabelsTable;
  "catalog.masters": CatalogMastersTable;
  "catalog.releases": CatalogReleasesTable;

  // Catalog: artist children
  "catalog.artist_urls": ArtistUrlsTable;
  "catalog.artist_name_variations": ArtistNameVariationsTable;
  "catalog.artist_aliases": ArtistAliasesTable;
  "catalog.artist_groups": ArtistGroupsTable;
  "catalog.artist_members": ArtistMembersTable;

  // Catalog: label children
  "catalog.label_urls": LabelUrlsTable;

  // Catalog: master children
  "catalog.master_artists": MasterArtistsTable;
  "catalog.master_genres": MasterGenresTable;
  "catalog.master_styles": MasterStylesTable;
  "catalog.master_videos": MasterVideosTable;

  // Catalog: release children
  "catalog.release_artists": ReleaseArtistsTable;
  "catalog.release_credits": ReleaseCreditsTable;
  "catalog.release_labels": ReleaseLabelsTable;
  "catalog.release_formats": ReleaseFormatsTable;
  "catalog.release_genres": ReleaseGenresTable;
  "catalog.release_styles": ReleaseStylesTable;
  "catalog.release_identifiers": ReleaseIdentifiersTable;
  "catalog.release_companies": ReleaseCompaniesTable;
  "catalog.release_videos": ReleaseVideosTable;

  // Catalog: tracks
  "catalog.tracks": TracksTable;
  "catalog.track_credits": TrackCreditsTable;

  // Catalog: scene-scope shadow + slim master-first derivations (025)
  "catalog.release_shadow": CatalogReleaseShadowTable;
  "catalog.master_tracks": CatalogMasterTracksTable;
  "catalog.master_videos_unified": CatalogMasterVideosUnifiedTable;

  // Enrich
  "enrich.entity_quality": EnrichEntityQualityTable;
  "enrich.label_linkouts": EnrichLabelLinkoutsTable;
  "enrich.usage_counters": EnrichUsageCountersTable;
  "enrich.label_editorial": EnrichLabelEditorialTable;
  "enrich.scene_scope_audit": EnrichSceneScopeAuditTable;
}
