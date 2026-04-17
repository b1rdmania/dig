/**
 * @dig/domain — shared retrieval services, business logic, and types.
 *
 * This package is imported by apps/api, apps/mcp, and apps/ingest.
 * It contains no framework-specific code — just pure domain logic
 * that operates on the DB via @dig/db.
 */

export { healthCheck } from "./health.js";
export { getBatchForTable } from "./batch.js";
export {
  search,
  validateSearchParams,
  isBroadQuery,
  getTimeoutStats,
  classifySearchLane,
  type SearchParams,
  type SearchResponse,
  type SearchResult,
  type SearchEntityType,
  type SearchError,
  type SearchLane,
} from "./search.js";
export {
  getArtist,
  getLabel,
  getMaster,
  getRelease,
  getReleaseShadow,
  type ArtistDetail,
  type LabelDetail,
  type MasterDetail,
  type ReleaseDetail,
  type ReleaseShadow,
} from "./retrieval/index.js";
export { getCoverUrl, type CoverResult } from "./covers.js";
export {
  getArtistReleases,
  getArtistMasters,
  getArtistCatalogReleases,
  getLabelReleases,
  getLabelRoster,
  getMasterReleases,
  getMasterVideos,
  getReleaseCredits,
  classifyReleaseType,
  classifyRoleFamily,
  getArtistCredits,
  type TraversalResponse,
  type TraversalLink,
  type LabelMasterLink,
  type LabelRosterEntry,
  type LabelRosterResponse,
  type MasterVideosResponse,
  type MasterVideo,
  type ReleaseType,
  type ReleaseTypeLabel,
  type RoleFamily,
  type ArtistCreditLink,
  type ArtistCreditsResponse,
} from "./traversal.js";
export {
  classifyEntityQuality,
  getSuppressedEntityKeys,
  QUALITY_VERSION,
  type QualityStatus,
  type QualityScore,
} from "./quality.js";
export {
  getArtistRelationships,
  getArtistContext,
  getArtistTimeline,
  getLabelLinkouts,
  parseEnrichmentParams,
  validateEnrichmentParams,
  type RelationshipsResponse,
  type ContextResponse,
  type TimelineResponse,
  type TimelineEvent,
  type LabelLinkout,
  type LabelLinkoutsResponse,
  type EnrichmentParams,
  type EdgeDirection,
  type RelationshipEdge,
  type ContextBlock,
} from "./enrichment.js";
