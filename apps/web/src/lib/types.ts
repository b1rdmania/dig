// Types matching locked API response contracts (docs/phase2-response-contracts.md)

export interface Provenance {
  source: string;
  dump_date: string;
  discogs_id: number;
}

// Search
export interface SearchResult {
  type: "artist" | "label" | "master";
  discogs_id: number;
  name: string | null;
  title: string | null;
  /** For type="master": denormed primary artist name. Null for other types. */
  primary_artist?: string | null;
  /** For type="master": denormed primary label name. Null for other types. */
  primary_label?: string | null;
  year: number | null;
  country: string | null;
  data_quality: string;
  relevance: number;
  provenance: Provenance;
}

export interface Pagination {
  cursor: string | null;
  has_more: boolean;
  total_estimate: number | null;
}

export interface SearchTopMatch {
  type: "label" | "artist";
  discogs_id: number;
  name: string;
  /** Label-only — tier1 / denylist / null. */
  tier: "tier1" | "denylist" | null;
  palette: { accent: string; accent_ink: string } | null;
  blurb: string | null;
}

export interface SearchTypeCounts {
  artist: number;
  label: number;
  master: number;
  artist_capped?: boolean;
  label_capped?: boolean;
  master_capped?: boolean;
}

export interface SearchMeta {
  query: string;
  type: string | null;
  filters_applied: Record<string, unknown>;
  elapsed_ms: number;
  hint: string | null;
  degraded: boolean;
  degraded_reason: string | null;
  suggested_results?: SearchResult[] | null;
  type_counts?: SearchTypeCounts;
}

export interface SearchResponse {
  results: SearchResult[];
  /** Pinned exact-name match (label/artist). Optional for back-compat with older API. */
  top_match?: SearchTopMatch | null;
  pagination: Pagination;
  meta: SearchMeta;
}

// Release detail
export interface ReleaseArtist {
  discogs_id: number;
  name: string;
  role: string | null;
  join_relation: string | null;
}

export interface ReleaseLabel {
  discogs_id: number;
  name: string;
  catalog_number: string | null;
}

export interface ReleaseFormat {
  name: string;
  qty: number;
  descriptions: string[];
}

export interface Track {
  position_raw: string;
  title: string;
  duration_seconds: number | null;
  disc: string | null;
  credits: TrackCredit[];
}

export interface TrackCredit {
  artist_discogs_id: number;
  artist_name: string;
  role: string;
}

export interface ReleaseCredit {
  artist_discogs_id: number;
  artist_name: string;
  role: string;
}

export interface ReleaseIdentifier {
  type: string;
  value: string;
  description: string | null;
}

export interface ReleaseCompany {
  discogs_id: number;
  name: string;
  entity_type: string;
}

export interface ReleaseVideo {
  url: string;
  title: string | null;
  duration_seconds: number | null;
}

export interface Release {
  discogs_id: number;
  title: string;
  country: string | null;
  release_year: number | null;
  released_raw: string | null;
  status: string;
  notes: string | null;
  data_quality: string;
  master_discogs_id: number | null;
  is_main_release: boolean | null;
  artists: ReleaseArtist[];
  labels: ReleaseLabel[];
  formats: ReleaseFormat[];
  genres: string[];
  styles: string[];
  tracks: Track[];
  credits: ReleaseCredit[];
  identifiers: ReleaseIdentifier[];
  companies: ReleaseCompany[];
  videos: ReleaseVideo[];
  provenance: Provenance;
}

export interface ReleaseResponse {
  release: Release;
}

// Master detail (slim / scene-scoped shape)
export interface MasterArtist {
  discogs_id: number;
  name: string;
  role: string | null;
  join_relation: string | null;
}

export interface MasterTrack {
  position: string | null;
  title: string | null;
  duration_seconds: number | null;
  artists_text: string | null;
  source_release_discogs_id: number | null;
}

export interface MasterVideo {
  url: string;
  title: string | null;
  duration_seconds: number | null;
  source_type: "master" | "release";
  source_release_discogs_id: number | null;
  discogs_release_url: string | null;
}

export interface Master {
  discogs_id: number;
  title: string;
  year: number | null;
  main_release_discogs_id: number | null;
  data_quality: string;
  scene_weight: number;
  primary_artist: { discogs_id: number | null; name: string | null };
  primary_label: { discogs_id: number | null; name: string | null };
  artists_credit_text: string | null;
  primary_country: string | null;
  primary_format: string | null;
  artists: MasterArtist[];
  genres: string[];
  styles: string[];
  tracks: MasterTrack[];
  videos: MasterVideo[];
  provenance: Provenance;
}

export interface MasterResponse {
  master: Master;
}

// Release shadow — minimal release info for redirecting old /version/:id URLs
// to the canonical /master/:master_id page.
export interface ReleaseShadow {
  release_discogs_id: number;
  master_discogs_id: number | null;
  title: string;
  release_year: number | null;
  country: string | null;
  label: string | null;
  format: string | null;
  is_main_release: boolean;
  has_tracklist_delta: boolean;
  has_remix_signal: boolean;
  discogs_url: string | null;
}

export interface ReleaseShadowResponse {
  release_shadow: ReleaseShadow;
}

export function isReleaseShadowResponse(data: unknown): data is ReleaseShadowResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.release_shadow !== undefined && typeof d.release_shadow === "object";
}

// Artist detail
export interface Artist {
  discogs_id: number;
  name: string;
  real_name: string | null;
  profile: string | null;
  data_quality: string;
  aliases: Array<{ discogs_id: number | null; name: string }>;
  name_variations: string[];
  members: Array<{ discogs_id: number | null; name: string }>;
  groups: Array<{ discogs_id: number | null; name: string }>;
  urls: string[];
  provenance: Provenance;
}

export interface ArtistResponse {
  artist: Artist;
}

// Label detail (slim shape + redesign editorial)
export interface LabelEditorial {
  tier: "tier1" | "denylist" | null;
  /** 2-colour palette for label-color identity. null = unrated, page falls back to ink-on-paper. */
  palette: { accent: string; accent_ink: string } | null;
  /** ≤50-word hand-written editorial blurb. Renders serif italic. */
  blurb: string | null;
  founded_year: number | null;
  closed_year: number | null;
  is_active: boolean;
  /** "Ghent, BE" / "Berlin, DE" / etc. */
  location: string | null;
}

export interface SublabelLink {
  discogs_id: number;
  name: string;
}

export interface Label {
  discogs_id: number;
  name: string;
  profile: string | null;
  contact_info: string | null;
  parent_label: { discogs_id: number | null; name: string | null };
  data_quality: string;
  /** Denormed alias text from catalog.labels.aliases_text */
  aliases: string[];
  /** @deprecated Use `editorial.tier`. Kept for backward compat. */
  tier: "tier1" | "denylist" | null;
  /**
   * Editorial metadata for the redesign — palette, blurb, founded year, etc.
   * Optional: API versions before 2026-04-16 don't include this; fall back
   * to `tier` only with no palette/blurb in that case.
   */
  editorial?: LabelEditorial;
  /**
   * Children pointing at this label via parent_label_discogs_id. Optional
   * for back-compat with API versions before 2026-04-17.
   */
  sublabels?: SublabelLink[];
  urls: string[];
  provenance: Provenance;
}

export type RelatedDirection =
  | "deeper"
  | "harder"
  | "rawer"
  | "cleaner"
  | "weirder"
  | "poppier"
  | "earlier"
  | "later";

export interface CoreRunMaster {
  master_discogs_id: number;
  rank: number;
  source: "auto" | "curated";
  note: string | null;
  title: string;
  year: number | null;
  primary_artist_name: string | null;
  primary_artist_discogs_id: number | null;
  scene_weight: number | null;
}

export interface RelatedLabel {
  to_label_id: number;
  to_label_name: string;
  direction: RelatedDirection;
  rank: number;
  blurb: string | null;
  to_label_master_count: number;
  palette: { accent: string; accent_ink: string } | null;
}

export interface LabelResponse {
  label: Label;
  /** Phase C, optional for back-compat with API < 2026-04-17. */
  core_run?: CoreRunMaster[];
  /** Phase C, optional for back-compat with API < 2026-04-17. */
  related?: RelatedLabel[];
}

// Label roster (top artists by master count on the label)
export interface LabelRosterEntry {
  artist_discogs_id: number;
  name: string;
  master_count: number;
  first_year: number | null;
  last_year: number | null;
}

export interface LabelRosterResponse {
  roster: LabelRosterEntry[];
  meta: {
    source_type: "label";
    source_discogs_id: number;
    link_type: "roster";
    elapsed_ms: number;
    total_artists: number;
  };
}

export function isLabelRosterResponse(data: unknown): data is LabelRosterResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.roster) && d.meta !== undefined;
}

// Label genre/style breakdown (Phase B — drives the ASCII bar)
export interface LabelStyleEntry {
  style: string;
  master_count: number;
  /** Share of label's tagged masters (0–1). */
  share: number;
}

export interface LabelStylesResponse {
  styles: LabelStyleEntry[];
  meta: {
    source_type: "label";
    source_discogs_id: number;
    link_type: "styles";
    total_tagged_masters: number;
    elapsed_ms: number;
  };
}

export function isLabelStylesResponse(data: unknown): data is LabelStylesResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.styles) && d.meta !== undefined;
}

// Artist → primary labels (Phase B — drives Labelmates derivation)
export interface ArtistPrimaryLabelEntry {
  discogs_label_id: number;
  name: string;
  master_count: number;
}

export interface ArtistPrimaryLabelsResponse {
  labels: ArtistPrimaryLabelEntry[];
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    link_type: "primary_labels";
  };
}

export function isArtistPrimaryLabelsResponse(data: unknown): data is ArtistPrimaryLabelsResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.labels) && d.meta !== undefined;
}

// Traversal
export interface TraversalLink {
  type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  name?: string;
  title?: string;
  year?: number | null;
  role?: string | null;
  country?: string | null;
  format?: string | null;
  release_type?: "album" | "single_ep" | "compilation" | "other";
  release_type_label?: "LP" | "EP" | "Single" | "Comp" | "Other";
  master_discogs_id?: number | null;
  /** Set on Notable Versions (master_releases) — flags the canonical pressing */
  is_main_release?: boolean;
  provenance: Provenance;
}

export interface TraversalResponse {
  links: TraversalLink[];
  pagination: Pagination;
  meta: {
    source_type: string;
    source_discogs_id: number;
    link_type: string;
    elapsed_ms: number;
  };
}

export interface MasterVideosResponse {
  videos: Array<{
    url: string;
    title: string | null;
    duration_seconds: number | null;
    release_discogs_id: number;
    provenance: Provenance;
  }>;
  meta: {
    source_type: "master";
    source_discogs_id: number;
    elapsed_ms: number;
  };
}

// Artist credits
export type RoleFamily = "writing" | "arranging" | "performance" | "production" | "other";

export interface ArtistCreditLink {
  release_discogs_id: number;
  title: string | null;
  year: number | null;
  country: string | null;
  roles: string[];
  role_count: number;
  credit_source: "release" | "track" | "both";
  role_family: RoleFamily;
  provenance: Provenance;
}

export interface ArtistCreditsResponse {
  links: ArtistCreditLink[];
  pagination: Pagination;
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    link_type: "credits";
    elapsed_ms: number;
  };
}

export function isArtistCreditsResponse(data: unknown): data is ArtistCreditsResponse {
  return (
    typeof data === "object" &&
    data !== null &&
    "links" in data &&
    Array.isArray((data as any).links) &&
    "meta" in data &&
    (data as any).meta?.link_type === "credits"
  );
}

// ─── Credits + remixes (migration 030) ──────────────────────────────────────

export interface ArtistMasterCredit {
  master_discogs_id: number;
  master_title: string | null;
  master_year: number | null;
  primary_artist_discogs_id: number | null;
  primary_artist_name: string | null;
  primary_label_discogs_id: number | null;
  primary_label_name: string | null;
  roles: string[];
  track_lines: Array<{
    track_position: string | null;
    track_title: string | null;
    role: string;
  }>;
  has_release_level: boolean;
}

export interface ArtistMasterCreditsResponse {
  links: ArtistMasterCredit[];
  pagination: Pagination;
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    link_type: "rule_a_credits";
    role_filter: string | null;
    elapsed_ms: number;
  };
}

export function isArtistMasterCreditsResponse(data: unknown): data is ArtistMasterCreditsResponse {
  return (
    typeof data === "object" && data !== null &&
    "links" in data && Array.isArray((data as any).links) &&
    (data as any).meta?.link_type === "rule_a_credits"
  );
}

export interface CrossScopeCreditCard {
  host_release_id: number;
  host_release_title: string;
  host_release_year: number | null;
  host_primary_artist_name: string | null;
  host_label_name: string | null;
  track_position: string | null;
  track_title: string | null;
  role: string;
  role_raw: string | null;
  discogs_release_url: string;
}

export interface CrossScopeCreditsResponse {
  links: CrossScopeCreditCard[];
  pagination: Pagination;
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    link_type: "cross_scope_credits";
    role_filter: string | null;
    elapsed_ms: number;
  };
}

export function isCrossScopeCreditsResponse(data: unknown): data is CrossScopeCreditsResponse {
  return (
    typeof data === "object" && data !== null &&
    "links" in data && Array.isArray((data as any).links) &&
    (data as any).meta?.link_type === "cross_scope_credits"
  );
}

export interface MasterTrackCreditLine {
  track_position: string | null;
  track_title: string | null;
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  role: string;
  role_raw: string | null;
}

export interface MasterReleaseCreditLine {
  artist_discogs_id: number;
  artist_name: string;
  anv: string | null;
  role: string;
  role_raw: string | null;
}

export interface MasterCreditsResponse {
  master_discogs_id: number;
  track_credits: MasterTrackCreditLine[];
  release_credits: MasterReleaseCreditLine[];
  meta: { elapsed_ms: number };
}

export function isMasterCreditsResponse(data: unknown): data is MasterCreditsResponse {
  return (
    typeof data === "object" && data !== null &&
    "master_discogs_id" in data &&
    Array.isArray((data as any).track_credits) &&
    Array.isArray((data as any).release_credits)
  );
}

export interface ArtistGroupEdge {
  discogs_id: number;
  name: string | null;
}

export interface ArtistGroupsAndMembersResponse {
  artist_discogs_id: number;
  groups: ArtistGroupEdge[];
  members: ArtistGroupEdge[];
  meta: { elapsed_ms: number };
}

export interface LabelTopCreditEntry {
  artist_discogs_id: number;
  artist_name: string;
  master_count: number;
  credit_count: number;
  roles: string[];
}

export interface LabelTopCreditsResponse {
  label_discogs_id: number;
  entries: LabelTopCreditEntry[];
}

export function isLabelTopCreditsResponse(data: unknown): data is LabelTopCreditsResponse {
  return (
    typeof data === "object" && data !== null &&
    "label_discogs_id" in data &&
    Array.isArray((data as any).entries)
  );
}

// Entity images (labels + artists)
export type EntityImageKind = "logo" | "photo" | "hero";

export interface EntityImage {
  kind: EntityImageKind;
  source: string;
  source_id: string | null;
  source_url: string;
  url: string;
  attribution: string | null;
  license: string | null;
}

export interface EntityImagesResponse {
  entity_type: "label" | "artist";
  discogs_id: number;
  images: EntityImage[];
}

export function isEntityImagesResponse(data: unknown): data is EntityImagesResponse {
  return (
    typeof data === "object" && data !== null &&
    "entity_type" in data &&
    "discogs_id" in data &&
    Array.isArray((data as any).images)
  );
}

// Enrichment
export interface EnrichmentProvenance {
  source: string;
  source_id: string;
  confidence: number;
  match_method: string;
}

export interface RelationshipEdge {
  edge_type: string;
  edge_direction: "outbound" | "inbound";
  source_entity: { entity_type: string; discogs_id: number; name: string | null };
  target_entity: { entity_type: string; discogs_id: number | null; external_id: string | null; name: string | null };
  valid_from: string | null;
  valid_to: string | null;
  provenance: EnrichmentProvenance;
}

export interface RelationshipsResponse {
  edges: RelationshipEdge[];
  pagination: Pagination;
  meta: {
    source_type: string;
    source_discogs_id: number;
    elapsed_ms: number;
    enrichment_included: boolean;
    enrichment_sources: string[];
    enrichment_edge_count: number;
  };
}

// Context (EN-C)
export interface ContextBlock {
  context_type: string;
  content_json: unknown;
  provenance: EnrichmentProvenance;
}

export interface ContextResponse {
  context: ContextBlock[];
  meta: {
    source_type: string;
    source_discogs_id: number;
    elapsed_ms: number;
    enrichment_included: boolean;
    enrichment_sources: string[];
    enrichment_edge_count: number;
  };
}

// Timeline (EN-D)
export interface TimelineEvent {
  event_date: string;
  venue_name: string | null;
  city_name: string | null;
  country_name: string | null;
  country_code: string | null;
  tour_name: string | null;
  song_count: number;
  setlistfm_url: string;
}

export interface TimelineResponse {
  events: TimelineEvent[];
  meta: {
    source_type: string;
    source_discogs_id: number;
    elapsed_ms: number;
    enrichment_included: boolean;
    total_events: number;
  };
}

export function isTimelineResponse(data: unknown): data is TimelineResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.events) && d.meta !== undefined;
}

// Label linkouts (EN-E)
export interface LabelLinkout {
  provider: "bandcamp" | "instagram";
  url: string;
  handle: string | null;
  confidence: number;
  is_verified: boolean;
}

export interface LabelLinkoutsResponse {
  linkouts: LabelLinkout[];
  meta: {
    source_type: "label";
    source_discogs_id: number;
    elapsed_ms: number;
    enrichment_included: boolean;
    enrichment_sources: string[];
  };
}

export function isLinkoutsResponse(data: unknown): data is LabelLinkoutsResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.linkouts) && d.meta !== undefined;
}

// Market snapshot (Phase 2 — dormant until MARKET_SNAPSHOT_ENABLED + DISCOGS_API_KEY set)
export interface MarketSnapshot {
  lowest_price: number | null;
  num_for_sale: number | null;
  last_sold_price: number | null;
  currency: string;
  fetched_at: string;
  source: "discogs_marketplace";
}

export interface MarketResponse {
  market: MarketSnapshot | null;
}

// Error
export interface ApiError {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown> | null;
  };
}

// Type guards for runtime validation at fetch boundary
export function isSearchResponse(data: unknown): data is SearchResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.results) && d.pagination !== undefined && d.meta !== undefined;
}

export function isReleaseResponse(data: unknown): data is ReleaseResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.release !== undefined && typeof d.release === "object";
}

export function isMasterResponse(data: unknown): data is MasterResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.master !== undefined && typeof d.master === "object";
}

export function isArtistResponse(data: unknown): data is ArtistResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.artist !== undefined && typeof d.artist === "object";
}

export function isTraversalResponse(data: unknown): data is TraversalResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.links) && d.pagination !== undefined && d.meta !== undefined;
}

export function isMasterVideosResponse(data: unknown): data is MasterVideosResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.videos) && d.meta !== undefined;
}

export function isLabelResponse(data: unknown): data is LabelResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.label !== undefined && typeof d.label === "object";
}

export function isRelationshipsResponse(data: unknown): data is RelationshipsResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.edges) && d.meta !== undefined;
}

export function isContextResponse(data: unknown): data is ContextResponse {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return Array.isArray(d.context) && d.meta !== undefined;
}

export function isApiError(data: unknown): data is ApiError {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.error !== undefined && typeof d.error === "object";
}

// Usage
export interface UsageWindow {
  requests_total: number;
  errors_total: number;
  telemetry_events_total: number;
  telemetry_by_event: Record<string, number>;
  shares_total?: number;
  shares_by_channel?: Record<string, number>;
  share_to_pageview_ratio?: number | null;
}

export interface ApiUsageSnapshot {
  service: "dig-api";
  window: string;
  started_at: string;
  uptime_seconds: number;
  requests_total: number;
  errors_total: number;
  requests_by_category: Record<string, number>;
  telemetry_events_total: number;
  telemetry_by_event: Record<string, number>;
  unique_sessions_estimate: number;
  lifetime: {
    as_of: string;
    requests_total: number;
    errors_total: number;
    requests_by_category: Record<string, number>;
    telemetry_events_total: number;
    telemetry_by_event: Record<string, number>;
    shares_by_channel?: Record<string, number>;
    routes: Array<{
      route: string;
      count: number;
      errors: number;
      avg_ms: number;
    }>;
  } | null;
  windows?: {
    last_24h: UsageWindow | null;
    last_7d: UsageWindow | null;
    last_30d: UsageWindow | null;
  } | null;
}

export interface ApiUsageSnapshotInternal extends ApiUsageSnapshot {
  routes: Array<{
    route: string;
    count: number;
    errors: number;
    avg_ms: number;
  }>;
}

// --- Scenes (catalog wall) ---

export type SceneAxis = "geography" | "sound" | "era" | "cluster" | "bridge" | "micro";
export type SceneRole = "core" | "adjacent" | "bridge";
export type BridgeKind = "artist" | "label" | "sound";

export interface ScenePalette {
  accent: string;
  accent_ink: string;
}

export interface SceneSummary {
  slug: string;
  name: string;
  city: string | null;
  era_start: number | null;
  era_end: number | null;
  axis: SceneAxis;
  parent_slug: string | null;
  depth: number;
  hero_label_id: number | null;
  blurb: string | null;
  palette: ScenePalette | null;
  label_count: number;
}

export interface SceneLabelMember {
  discogs_id: number;
  name: string;
  role: SceneRole;
  rank: number;
  palette: ScenePalette | null;
  founded_year: number | null;
  closed_year: number | null;
  is_active: boolean;
  location: string | null;
  master_count: number;
}

export interface SceneBridgeLink {
  from_slug: string;
  to_slug: string;
  via_kind: BridgeKind;
  via_id: number | null;
  via_name: string | null;
  blurb: string | null;
}

export interface SceneDetail extends SceneSummary {
  labels: SceneLabelMember[];
  bridges_out: SceneBridgeLink[];
  bridges_in: SceneBridgeLink[];
}

export interface WallStripRelease {
  master_discogs_id: number;
  title: string;
  primary_artist_name: string | null;
  year: number | null;
  scene_weight: number;
}

export interface WallStripLabel extends SceneLabelMember {
  era: { start: number | null; end: number | null };
  total_masters: number;
  releases: WallStripRelease[];
}

export interface SceneWall extends SceneSummary {
  labels: WallStripLabel[];
  density: "compact" | "medium" | "full";
  per_label_cap: number;
}

export interface ListScenesResponse {
  scenes: SceneSummary[];
  meta: { count: number; provenance: { source: string; dump_date: string } };
}

export interface SceneDetailResponse {
  scene: SceneDetail;
  meta: { provenance: { source: string; dump_date: string } };
}

export interface SceneWallResponse {
  wall: SceneWall;
  meta: { provenance: { source: string; dump_date: string } };
}

export interface ScenePlaylistRecord {
  master_discogs_id: number;
  title: string;
  primary_artist_name: string | null;
  year: number | null;
  video_id: string;
}

export interface ScenePlaylist {
  slug: string;
  name: string;
  video_count: number;
  playlist_url: string | null;
  records: ScenePlaylistRecord[];
}

export interface ScenePlaylistResponse {
  playlist: ScenePlaylist;
  meta: { provenance: { source: string; dump_date: string } };
}
