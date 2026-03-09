/**
 * Kysely database type definitions.
 * Tables are added here as migrations create them.
 * This is the single source of truth for DB types across the monorepo.
 */

import type { Generated, ColumnType } from "kysely";

// --- Auth (designed in Phase 0A, enforced in Phase 5) ---

export interface UsersTable {
  id: Generated<string>;
  email: string;
  role: "public" | "developer" | "curator" | "admin";
  clerk_user_id: string | null;
  stripe_customer_id: string | null;
  plan: Generated<"free" | "early_access" | "team">;
  plan_expires_at: Date | null;
  created_at: Generated<Date>;
}

export interface ApiKeysTable {
  id: Generated<string>;
  user_id: string;
  key_hash: string;
  label: string | null;
  rate_limit_tier: "public" | "developer";
  active: Generated<boolean>;
  created_at: Generated<Date>;
}

export interface UserProfilesTable {
  user_id: string;
  clerk_user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  provider: Generated<string>;
  provider_customer_id: string;
  provider_subscription_id: string;
  status: string;
  price_id: string;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UserEntitlementsTable {
  user_id: string;
  plan: Generated<string>;
  llm_beta_access: Generated<boolean>;
  monthly_request_limit: Generated<number>;
  rpm_limit: Generated<number>;
  features: ColumnType<Record<string, boolean>, Record<string, boolean> | undefined, Record<string, boolean>>;
  effective_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsageQuotasTable {
  user_id: string;
  period_month: string;
  request_count: Generated<number>;
  llm_request_count: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface BillingEventsTable {
  id: Generated<string>;
  provider: Generated<string>;
  provider_event_id: string;
  event_type: string;
  payload: ColumnType<unknown, unknown, unknown>;
  processed_at: Date | null;
  created_at: Generated<Date>;
}

export interface UserSavedItemsTable {
  id: Generated<string>;
  user_id: string;
  entity_type: "artist" | "release" | "version" | "label" | "track";
  discogs_id: number;
  list_type: "favorite" | "want";
  created_at: Generated<Date>;
}

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
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
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

// --- Database interface ---

export interface Database {
  // Auth
  "auth.users": UsersTable;
  "auth.api_keys": ApiKeysTable;
  "auth.user_profiles": UserProfilesTable;
  "auth.subscriptions": SubscriptionsTable;
  "auth.user_entitlements": UserEntitlementsTable;
  "auth.usage_quotas": UsageQuotasTable;
  "auth.billing_events": BillingEventsTable;
  "auth.user_saved_items": UserSavedItemsTable;

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

  // Enrich
  "enrich.entity_quality": EnrichEntityQualityTable;
  "enrich.label_linkouts": EnrichLabelLinkoutsTable;
  "enrich.usage_counters": EnrichUsageCountersTable;
}
