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
export {
  getArtistReleases,
  getArtistMasters,
  getLabelReleases,
  getMasterReleases,
  getReleaseCredits,
  type TraversalResponse,
  type TraversalLink,
} from "./traversal.js";
