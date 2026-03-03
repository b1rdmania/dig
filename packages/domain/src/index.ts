/**
 * @dig/domain — shared retrieval services, business logic, and types.
 *
 * This package is imported by apps/api, apps/mcp, and apps/ingest.
 * It contains no framework-specific code — just pure domain logic
 * that operates on the DB via @dig/db.
 */

export { healthCheck } from "./health.js";
export {
  search,
  validateSearchParams,
  isBroadQuery,
  getTimeoutStats,
  type SearchParams,
  type SearchResponse,
  type SearchResult,
  type SearchEntityType,
  type SearchError,
} from "./search.js";
export {
  getArtist,
  getLabel,
  getMaster,
  getRelease,
  type ArtistDetail,
  type LabelDetail,
  type MasterDetail,
  type ReleaseDetail,
} from "./retrieval/index.js";
export { getCoverUrl, type CoverResult } from "./covers.js";
export {
  getArtistReleases,
  getArtistMasters,
  getLabelReleases,
  getMasterReleases,
  getMasterVideos,
  getReleaseCredits,
  type TraversalResponse,
  type TraversalLink,
  type MasterVideosResponse,
  type MasterVideo,
} from "./traversal.js";
export {
  getArtistRelationships,
  getArtistContext,
  getArtistTimeline,
  parseEnrichmentParams,
  validateEnrichmentParams,
  type RelationshipsResponse,
  type ContextResponse,
  type TimelineResponse,
  type TimelineEvent,
  type EnrichmentParams,
  type EdgeDirection,
  type RelationshipEdge,
  type ContextBlock,
} from "./enrichment.js";
