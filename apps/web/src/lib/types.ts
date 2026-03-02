// Types matching locked API response contracts (docs/phase2-response-contracts.md)

export interface Provenance {
  source: string;
  dump_date: string;
  discogs_id: number;
}

// Search
export interface SearchResult {
  type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  master_discogs_id: number | null;
  name: string | null;
  title: string | null;
  year: number | null;
  country: string | null;
  data_quality: string;
  relevance: number;
  is_main_release?: boolean;
  provenance: Provenance;
}

export interface Pagination {
  cursor: string | null;
  has_more: boolean;
  total_estimate: number | null;
}

export interface SearchMeta {
  query: string;
  type: string | null;
  filters_applied: Record<string, unknown>;
  elapsed_ms: number;
  hint: string | null;
  degraded: boolean;
  degraded_reason: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
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

// Master detail
export interface MasterArtist {
  discogs_id: number;
  name: string;
  role: string | null;
  join_relation: string | null;
}

export interface Master {
  discogs_id: number;
  title: string;
  year: number | null;
  main_release_discogs_id: number | null;
  data_quality: string;
  artists: MasterArtist[];
  genres: string[];
  styles: string[];
  videos: Array<{ url: string; title: string | null; duration_seconds: number | null }>;
  provenance: Provenance;
}

export interface MasterResponse {
  master: Master;
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

// Label detail
export interface Label {
  discogs_id: number;
  name: string;
  profile: string | null;
  contact_info: string | null;
  parent_label: { discogs_id: number | null; name: string | null };
  data_quality: string;
  urls: string[];
  provenance: Provenance;
}

export interface LabelResponse {
  label: Label;
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

export function isApiError(data: unknown): data is ApiError {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return d.error !== undefined && typeof d.error === "object";
}
