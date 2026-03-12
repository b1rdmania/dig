/**
 * Multi-entity search service.
 *
 * Two-path release search strategy (v1):
 *
 *   Path A (fast path): FTS with ts_rank_cd ranking. Used for unfiltered
 *   queries or queries on small entity types (artist/label/master).
 *
 *   Path B (guarded path): FTS match without rank computation, ordered by
 *   discogs_id DESC. Used for filtered release queries and broad single-term
 *   queries. Returns degraded=true with a hint.
 *
 * Enforces query envelope from phase2-query-envelope.md:
 * - Min query length: 2 chars, max: 200 chars
 * - Max page size: 50, default 20
 * - Cursor-based pagination
 * - 3s per-statement timeout (enforced via pinned connection)
 * - Fuzzy: artist (full), label/master (stricter threshold + cap), release (disabled)
 * - Broad query detection → degraded response
 * - Filtered release queries → degraded response (no rank sort)
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";
import { getBatchForTable } from "./batch.js";
import { getSuppressedEntityKeys } from "./quality.js";

export type SearchEntityType = "artist" | "label" | "master" | "release";

export interface SearchParams {
  q: string;
  type?: SearchEntityType;
  genre?: string;
  style?: string;
  year?: number;
  yearMin?: number;
  yearMax?: number;
  country?: string;
  limit?: number;
  cursor?: string;
  /** Quality filter. Default 'active' hides low-signal/invalid entities. Use 'all' for admin/debug. */
  quality?: "active" | "all";
  /**
   * Zero-result rescue. When true and quality=active returns 0 results for a
   * ≥4-char artist query, re-runs a fuzzy search without quality filtering and
   * returns up to 3 suggestions in meta.suggested_results ("Did you mean?").
   * Gate: SEARCH_ZERO_RESCUE=true env var. Off by default.
   */
  rescue?: boolean;
}

export interface SearchResult {
  type: SearchEntityType;
  discogs_id: number;
  master_discogs_id: number | null;
  name: string | null;
  title: string | null;
  year: number | null;
  country: string | null;
  data_quality: string;
  relevance: number;
  is_main_release: boolean;
  provenance: {
    source: "discogs";
    dump_date: string;
    discogs_id: number;
  };
}

export interface SearchResponse {
  results: SearchResult[];
  pagination: {
    cursor: string | null;
    has_more: boolean;
    total_estimate: number | null;
  };
  meta: {
    query: string;
    type: SearchEntityType | null;
    filters_applied: Record<string, string | number>;
    elapsed_ms: number;
    hint: string | null;
    degraded: boolean;
    degraded_reason: string | null;
    /** Populated when rescue=true and quality=active returns 0 results. "Did you mean?" candidates. */
    suggested_results?: SearchResult[] | null;
  };
}

export interface SearchError {
  code: string;
  message: string;
}

// --- Timeout rate tracking ---

/**
 * Lightweight in-process timeout rate tracker.
 * Logs a warning if statement_timeout errors exceed 1% of requests
 * per 15-minute window for any category. Provides operational signal
 * before users experience sustained degradation.
 */
const TIMEOUT_WINDOW_MS = 15 * 60 * 1000;
const TIMEOUT_ALERT_THRESHOLD = 0.01; // 1%

interface TimeoutBucket {
  total: number;
  timeouts: number;
  windowStart: number;
}

const timeoutBuckets = new Map<string, TimeoutBucket>();

function trackRequest(category: string, timedOut: boolean): void {
  const now = Date.now();
  let bucket = timeoutBuckets.get(category);
  if (!bucket || now - bucket.windowStart > TIMEOUT_WINDOW_MS) {
    bucket = { total: 0, timeouts: 0, windowStart: now };
    timeoutBuckets.set(category, bucket);
  }
  bucket.total++;
  if (timedOut) bucket.timeouts++;

  // Check threshold
  if (bucket.total >= 10 && bucket.timeouts / bucket.total > TIMEOUT_ALERT_THRESHOLD) {
    console.warn(
      `[dig:search] TIMEOUT_RATE_HIGH category=${category} ` +
      `timeouts=${bucket.timeouts}/${bucket.total} ` +
      `rate=${(bucket.timeouts / bucket.total * 100).toFixed(1)}% ` +
      `window=${Math.round((now - bucket.windowStart) / 1000)}s`,
    );
  }
}

/**
 * Classify a search request as core or heavy lane.
 *
 * Heavy lane: release searches with structured filters (genre/style/country/year).
 * These hit expensive GIN+EXISTS or multi-filter join paths and must not starve
 * unfiltered FTS queries on smaller entity tables.
 *
 * Core lane: everything else — artist/label/master FTS, unfiltered release FTS,
 * multi-entity text-only queries.
 */
export type SearchLane = "core" | "heavy";

export function classifySearchLane(params: SearchParams): SearchLane {
  const hasFilters = !!(
    params.genre || params.style || params.country ||
    params.year !== undefined || params.yearMin !== undefined || params.yearMax !== undefined
  );
  // Any filtered query that touches releases (multi-entity or type=release) is heavy.
  // type=artist/label/master with filters stays core — those tables are small.
  const touchesRelease = !params.type || params.type === "release";
  if (hasFilters && touchesRelease) return "heavy";
  return "core";
}

/** Expose timeout stats for health/metrics endpoints */
export function getTimeoutStats(): Record<string, { total: number; timeouts: number; rate: number }> {
  const now = Date.now();
  const stats: Record<string, { total: number; timeouts: number; rate: number }> = {};
  for (const [category, bucket] of timeoutBuckets) {
    if (now - bucket.windowStart <= TIMEOUT_WINDOW_MS && bucket.total > 0) {
      stats[category] = {
        total: bucket.total,
        timeouts: bucket.timeouts,
        rate: bucket.timeouts / bucket.total,
      };
    }
  }
  return stats;
}

// --- Constants ---

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
/** Minimum ts_rank_cd score to include in ranked results */
const MIN_RANK_THRESHOLD = 0.0001;
/** Fuzzy similarity threshold for artists (289k rows — fast) */
const SIMILARITY_ARTIST = 0.3;
/** Stricter fuzzy threshold for labels (2.3M) and masters (2.5M) */
const SIMILARITY_LABEL_MASTER = 0.5;
/** Max fuzzy results for label/master to cap candidate scan */
const FUZZY_CAP_LABEL_MASTER = 5;

/** High-frequency single terms that trigger degraded mode on releases */
const BROAD_TERMS = new Set([
  "love", "remix", "the", "you", "live", "blue", "rock", "jazz", "house",
  "soul", "baby", "night", "dance", "dream", "world", "heart", "time",
  "best", "gold", "fire", "magic", "party", "super", "radio", "black",
  "white", "sweet", "angel", "crazy", "happy", "dj",
]);

// --- Helpers ---

/**
 * Detect broad queries that would scan hundreds of thousands of rows.
 * A query is broad when it's a single token AND either short (2-5 chars)
 * or in the known high-frequency term list.
 * Broad detection is skipped if filters are applied (they narrow the result set).
 */
export function isBroadQuery(params: SearchParams): boolean {
  if (!params.q) return false;
  // Filters narrow the result set enough for ranked search
  if (params.genre || params.style || params.year !== undefined
    || params.yearMin !== undefined || params.yearMax !== undefined
    || params.country) return false;
  const trimmed = params.q.trim();
  const isSingleToken = !trimmed.includes(" ");
  if (!isSingleToken) return false;
  if (trimmed.length <= 5) return true;
  return BROAD_TERMS.has(trimmed.toLowerCase());
}

/**
 * Detect whether a release query needs the guarded path (Path B).
 * Any structured filter on releases makes ts_rank_cd + sort too expensive
 * because PG picks bitmap heap scan on the FTS GIN index, reading tens of
 * thousands of heap pages to compute rank.
 */
function needsGuardedPath(params: SearchParams, type: SearchEntityType): boolean {
  if (type !== "release") return false;
  return !!(params.genre || params.style || params.country
    || params.year !== undefined || params.yearMin !== undefined || params.yearMax !== undefined);
}

interface DecodedCursor {
  discogs_id: number;
  rank: number;
}

function encodeCursor(discogsId: number, rank: number): string {
  return Buffer.from(JSON.stringify({ discogs_id: discogsId, rank })).toString("base64url");
}

function decodeCursor(cursor: string): DecodedCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (typeof parsed.discogs_id === "number" && typeof parsed.rank === "number") {
      return parsed as DecodedCursor;
    }
    return null;
  } catch {
    return null;
  }
}

export function validateSearchParams(params: SearchParams): SearchError | null {
  if (!params.q && !params.genre && !params.style && params.year === undefined
    && params.yearMin === undefined && params.country === undefined) {
    return { code: "INVALID_REQUEST", message: "Query or at least one filter is required" };
  }
  if (params.q) {
    if (params.q.length < MIN_QUERY_LENGTH) {
      return { code: "INVALID_REQUEST", message: `Query must be at least ${MIN_QUERY_LENGTH} characters` };
    }
    if (params.q.length > MAX_QUERY_LENGTH) {
      return { code: "INVALID_REQUEST", message: "Query too long" };
    }
  }
  return null;
}

/**
 * Check if a query string produces an empty tsquery after PG normalization.
 * Stop words like "The", "A", "An" get stripped entirely, producing an empty
 * tsquery that matches everything — causing a full table scan and timeout.
 * We detect these client-side to short-circuit before hitting the DB.
 */
const ENGLISH_STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "but", "by", "for",
  "from", "had", "has", "have", "he", "her", "his", "how", "i", "if", "in",
  "into", "is", "it", "its", "just", "me", "my", "no", "not", "of", "on",
  "or", "our", "s", "she", "so", "t", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "to", "too", "us", "very", "was", "we",
  "what", "when", "which", "who", "will", "with", "would", "you", "your",
]);

function isEmptyTsquery(q: string): boolean {
  // After lowercasing and splitting, if every token is a stop word, the
  // tsquery will be empty and match all rows (or none, depending on PG version).
  const tokens = q.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
  if (tokens.length === 0) return true;
  return tokens.every(t => ENGLISH_STOP_WORDS.has(t));
}

/** Table mapping for per-entity-type batch resolution */
const ENTITY_TABLE: Record<SearchEntityType, string> = {
  artist: "catalog.artists",
  label: "catalog.labels",
  master: "catalog.masters",
  release: "catalog.releases",
};

/**
 * Resolve batches for all needed entity types, cached per request.
 * Returns a Map so each entity type gets its own batchId/dumpDate.
 */
async function getBatchMap(
  db: Kysely<Database>,
  types: SearchEntityType[],
): Promise<Map<SearchEntityType, { batchId: string; dumpDate: string }>> {
  const map = new Map<SearchEntityType, { batchId: string; dumpDate: string }>();
  // Deduplicate table lookups (e.g. if two types share a batch)
  const seen = new Map<string, { batchId: string; dumpDate: string }>();
  for (const t of types) {
    const table = ENTITY_TABLE[t];
    if (seen.has(table)) {
      map.set(t, seen.get(table)!);
      continue;
    }
    try {
      const info = await getBatchForTable(db, table);
      seen.set(table, info);
      map.set(t, info);
    } catch {
      // No batch for this entity type — skip it
    }
  }
  return map;
}

// --- Path A: Ranked search (fast path) ---

/**
 * Standard ranked FTS search. Computes ts_rank_cd, sorts by relevance.
 * Used for unfiltered queries and non-release entity types.
 */
async function searchRanked(
  db: Kysely<Database>,
  type: SearchEntityType,
  params: SearchParams,
  batchId: string,
  dumpDate: string,
  limit: number,
  cursorData: DecodedCursor | null,
): Promise<{ results: SearchResult[]; hasMore: boolean }> {
  const tableName = `catalog.${type === "artist" ? "artists" : type === "label" ? "labels" : type === "master" ? "masters" : "releases"}` as const;
  const isNameType = type === "artist" || type === "label";
  const nameCol = isNameType ? "name" : "title";

  let query = db
    .selectFrom(tableName as any)
    .select([
      "discogs_id",
      `${nameCol} as display_name`,
      "data_quality",
    ] as any[])
    .where("batch_id" as any, "=", batchId);

  // FTS ranking with exact/prefix name boosting in SQL.
  // This ensures exact matches survive the per-type LIMIT instead of being
  // pushed out by newer records with the same FTS rank.
  if (params.q) {
    const tsqueryFn = type === "release"
      ? sql`websearch_to_tsquery('english', ${params.q})`
      : sql`plainto_tsquery('english', ${params.q})`;
    const qLower = params.q.toLowerCase().trim();
    query = query
      .where(sql`search_vector @@ ${tsqueryFn}` as any)
      .select(sql`(
        ts_rank_cd(search_vector, ${tsqueryFn})
        + CASE WHEN lower(${sql.ref(nameCol)}) = ${qLower} THEN 10
               WHEN lower(${sql.ref(nameCol)}) LIKE ${qLower + '%'} THEN 2
               ELSE 0 END
      )`.as("rank") as any)
      .where(sql`ts_rank_cd(search_vector, ${tsqueryFn}) > ${MIN_RANK_THRESHOLD}` as any);
  } else {
    query = query.select(sql`0`.as("rank") as any);
  }

  // Year/country columns
  if (type === "master") {
    query = query.select("year" as any);
  } else if (type === "release") {
    query = query.select(["release_year as year", "country", "master_discogs_id", "is_main_release"] as any[]);
  }

  // Apply filters (for non-release types — masters can have genre/style)
  if (params.year !== undefined && (type === "master" || type === "release")) {
    const yearCol = type === "release" ? "release_year" : "year";
    query = query.where(yearCol as any, "=", params.year);
  }
  if (params.yearMin !== undefined && (type === "master" || type === "release")) {
    const yearCol = type === "release" ? "release_year" : "year";
    query = query.where(yearCol as any, ">=", params.yearMin);
  }
  if (params.yearMax !== undefined && (type === "master" || type === "release")) {
    const yearCol = type === "release" ? "release_year" : "year";
    query = query.where(yearCol as any, "<=", params.yearMax);
  }
  if (params.country && type === "release") {
    query = query.where("country" as any, "=", params.country);
  }
  if (params.genre && (type === "master" || type === "release")) {
    const genreTable = type === "master" ? "catalog.master_genres" : "catalog.release_genres";
    const fkCol = type === "master" ? "master_discogs_id" : "release_discogs_id";
    query = query.where(sql`EXISTS (SELECT 1 FROM ${sql.table(genreTable)} g WHERE g.${sql.ref(fkCol)} = ${sql.ref("discogs_id")} AND g.batch_id = ${batchId} AND g.genre = ${params.genre})` as any);
  }
  if (params.style && (type === "master" || type === "release")) {
    const styleTable = type === "master" ? "catalog.master_styles" : "catalog.release_styles";
    const fkCol = type === "master" ? "master_discogs_id" : "release_discogs_id";
    query = query.where(sql`EXISTS (SELECT 1 FROM ${sql.table(styleTable)} s WHERE s.${sql.ref(fkCol)} = ${sql.ref("discogs_id")} AND s.batch_id = ${batchId} AND s.style = ${params.style})` as any);
  }

  // Cursor pagination
  if (cursorData && params.q) {
    const tsqueryFn = type === "release"
      ? sql`websearch_to_tsquery('english', ${params.q})`
      : sql`plainto_tsquery('english', ${params.q})`;
    query = query.where(sql`(ts_rank_cd(search_vector, ${tsqueryFn}), discogs_id) < (${cursorData.rank}, ${cursorData.discogs_id})` as any);
  } else if (cursorData) {
    query = query.where("discogs_id" as any, "<", cursorData.discogs_id);
  }

  // Order by rank desc, then discogs_id for tie-breaking
  if (params.q) {
    query = query.orderBy(sql`rank` as any, "desc").orderBy("discogs_id" as any, "desc");
  } else {
    query = query.orderBy("discogs_id" as any, "desc");
  }

  query = query.limit(limit + 1);

  const rows = await (query as any).execute();
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    results: resultRows.map((row: any) => ({
      type,
      discogs_id: row.discogs_id,
      master_discogs_id: type === "release" ? (row.master_discogs_id ?? null) : null,
      name: isNameType ? row.display_name : null,
      title: isNameType ? null : row.display_name,
      year: row.year ?? null,
      country: row.country ?? null,
      data_quality: row.data_quality,
      relevance: row.rank ? Math.min(1, Math.max(0, Number(row.rank))) : 0,
      is_main_release: type === "release" ? !!row.is_main_release : false,
      provenance: {
        source: "discogs" as const,
        dump_date: dumpDate,
        discogs_id: row.discogs_id,
      },
    })),
    hasMore,
  };
}

// --- Path B: Guarded search (filtered/broad releases) ---

/**
 * Guarded search path for filtered or broad release queries.
 *
 * Strategy: prefilter by structured filters first (genre/style via join table,
 * country/year via btree), cap candidates, then apply FTS text match.
 * No rank computation, no sort on computed value.
 * Results ordered by discogs_id DESC (newest first).
 *
 * For simple single-filter cases (genre-only, country-only), PG can use
 * index scan backward efficiently. For expensive multi-filter combinations
 * (genre+year), we use a bounded CTE to cap the candidate set and guarantee
 * deterministic completion within the timeout.
 */
async function searchGuardedRelease(
  db: Kysely<Database>,
  params: SearchParams,
  batchId: string,
  dumpDate: string,
  limit: number,
  cursorData: DecodedCursor | null,
): Promise<{ results: SearchResult[]; hasMore: boolean; capped: boolean }> {
  const tsqueryFn = params.q
    ? sql`websearch_to_tsquery('english', ${params.q})`
    : null;

  // Count the number of filters to decide strategy
  const filterCount = [
    params.genre, params.style, params.country,
    params.year !== undefined, params.yearMin !== undefined, params.yearMax !== undefined,
  ].filter(Boolean).length;

  // For multi-filter combinations (2+ filters), use bounded CTE to prefilter
  // candidates before applying FTS. This prevents the sparse-intersection
  // timeout where PG scans millions of rows.
  if (filterCount >= 2 && tsqueryFn) {
    return searchGuardedMultiFilter(db, params, batchId, dumpDate, limit, cursorData);
  }

  // Single-filter case: PG handles this well with index scan backward
  let query = db
    .selectFrom("catalog.releases" as any)
    .select([
      "discogs_id",
      "master_discogs_id",
      "title as display_name",
      "data_quality",
      "release_year as year",
      "country",
    ] as any[])
    .where("batch_id" as any, "=", batchId);

  if (tsqueryFn) {
    query = query.where(sql`search_vector @@ ${tsqueryFn}` as any);
  }

  // Apply single filter
  if (params.year !== undefined) {
    query = query.where("release_year" as any, "=", params.year);
  }
  if (params.yearMin !== undefined) {
    query = query.where("release_year" as any, ">=", params.yearMin);
  }
  if (params.yearMax !== undefined) {
    query = query.where("release_year" as any, "<=", params.yearMax);
  }
  if (params.country) {
    query = query.where("country" as any, "=", params.country);
  }
  if (params.genre) {
    query = query.where(sql`EXISTS (SELECT 1 FROM catalog.release_genres g WHERE g.release_discogs_id = discogs_id AND g.batch_id = ${batchId} AND g.genre = ${params.genre})` as any);
  }
  if (params.style) {
    query = query.where(sql`EXISTS (SELECT 1 FROM catalog.release_styles s WHERE s.release_discogs_id = discogs_id AND s.batch_id = ${batchId} AND s.style = ${params.style})` as any);
  }

  if (cursorData) {
    query = query.where("discogs_id" as any, "<", cursorData.discogs_id);
  }

  query = query.orderBy("discogs_id" as any, "desc").limit(limit + 1);

  const rows = await (query as any).execute();
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    results: resultRows.map((row: any) => ({
      type: "release" as const,
      discogs_id: row.discogs_id,
      master_discogs_id: row.master_discogs_id ?? null,
      name: null,
      title: row.display_name,
      year: row.year ?? null,
      country: row.country ?? null,
      data_quality: row.data_quality,
      relevance: 0,
      is_main_release: false,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: row.discogs_id },
    })),
    hasMore,
    capped: false,
  };
}

/**
 * Multi-filter guarded path: prefilter candidates via structured filters,
 * then apply FTS text match. Uses JOINs on genre/style tables (which have
 * covering indexes) to narrow candidates before applying FTS.
 * No rank computation — ordered by discogs_id DESC.
 */
async function searchGuardedMultiFilter(
  db: Kysely<Database>,
  params: SearchParams,
  batchId: string,
  dumpDate: string,
  limit: number,
  cursorData: DecodedCursor | null,
): Promise<{ results: SearchResult[]; hasMore: boolean; capped: boolean }> {
  // Multi-filter strategy: use Kysely query builder with JOINs on genre/style
  // tables. PG typically uses Nested Loop (BitmapAnd on FTS+year, then
  // Index Only Scan on genre). For warm cache this is <200ms; for cold cache
  // it may exceed 2s timeout — this is accepted as degraded behavior in v1.

  let query = db
    .selectFrom("catalog.releases as r" as any)
    .select([
      "r.discogs_id",
      "r.master_discogs_id",
      "r.title as display_name",
      "r.data_quality",
      "r.release_year as year",
      "r.country",
    ] as any[])
    .where("r.batch_id" as any, "=", batchId);

  // Genre JOIN (uses idx_release_genres_genre covering index)
  if (params.genre) {
    query = query
      .innerJoin("catalog.release_genres as g" as any, (join: any) =>
        join
          .onRef("g.release_discogs_id" as any, "=", "r.discogs_id" as any)
          .on("g.batch_id" as any, "=", batchId)
          .on("g.genre" as any, "=", params.genre!),
      );
  }

  // Style JOIN (uses idx_release_styles_style covering index)
  if (params.style) {
    query = query
      .innerJoin("catalog.release_styles as s" as any, (join: any) =>
        join
          .onRef("s.release_discogs_id" as any, "=", "r.discogs_id" as any)
          .on("s.batch_id" as any, "=", batchId)
          .on("s.style" as any, "=", params.style!),
      );
  }

  // Year filters
  if (params.year !== undefined) {
    query = query.where("r.release_year" as any, "=", params.year);
  }
  if (params.yearMin !== undefined) {
    query = query.where("r.release_year" as any, ">=", params.yearMin);
  }
  if (params.yearMax !== undefined) {
    query = query.where("r.release_year" as any, "<=", params.yearMax);
  }

  // Country filter
  if (params.country) {
    query = query.where("r.country" as any, "=", params.country);
  }

  // FTS match
  if (params.q) {
    query = query.where(sql`r.search_vector @@ websearch_to_tsquery('english', ${params.q})` as any);
  }

  // Cursor
  if (cursorData) {
    query = query.where("r.discogs_id" as any, "<", cursorData.discogs_id);
  }

  query = query.orderBy("r.discogs_id" as any, "desc").limit(limit + 1);

  const rows = await (query as any).execute();
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    results: resultRows.map((row: any) => ({
      type: "release" as const,
      discogs_id: row.discogs_id,
      master_discogs_id: row.master_discogs_id ?? null,
      name: null,
      title: row.display_name,
      year: row.year ?? null,
      country: row.country ?? null,
      data_quality: row.data_quality,
      relevance: 0,
      is_main_release: false,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: row.discogs_id },
    })),
    hasMore,
    capped: false,
  };
}

/**
 * Last-resort fallback for filtered release queries that timed out.
 *
 * Strategy:
 * - Skip FTS entirely to avoid expensive BitmapAnd + heap reads under contention.
 * - Apply only structured filters in SQL.
 * - Pull a bounded recent slice and optionally do lightweight title matching in memory.
 *
 * This path is intentionally degraded but guarantees a deterministic response instead
 * of empty timeout results under high concurrency.
 */
async function searchFilteredCappedRelease(
  db: Kysely<Database>,
  params: SearchParams,
  batchId: string,
  dumpDate: string,
  limit: number,
  cursorData: DecodedCursor | null,
): Promise<{ results: SearchResult[]; hasMore: boolean }> {
  const fetchCap = Math.min(Math.max(limit * 10, 50), 200);

  let query = db
    .selectFrom("catalog.releases" as any)
    .select([
      "discogs_id",
      "master_discogs_id",
      "title as display_name",
      "data_quality",
      "release_year as year",
      "country",
    ] as any[])
    .where("batch_id" as any, "=", batchId);

  if (params.year !== undefined) {
    query = query.where("release_year" as any, "=", params.year);
  }
  if (params.yearMin !== undefined) {
    query = query.where("release_year" as any, ">=", params.yearMin);
  }
  if (params.yearMax !== undefined) {
    query = query.where("release_year" as any, "<=", params.yearMax);
  }
  if (params.country) {
    query = query.where("country" as any, "=", params.country);
  }
  if (params.genre) {
    query = query.where(sql`EXISTS (SELECT 1 FROM catalog.release_genres g WHERE g.release_discogs_id = discogs_id AND g.batch_id = ${batchId} AND g.genre = ${params.genre})` as any);
  }
  if (params.style) {
    query = query.where(sql`EXISTS (SELECT 1 FROM catalog.release_styles s WHERE s.release_discogs_id = discogs_id AND s.batch_id = ${batchId} AND s.style = ${params.style})` as any);
  }

  if (cursorData) {
    query = query.where("discogs_id" as any, "<", cursorData.discogs_id);
  }

  query = query.orderBy("discogs_id" as any, "desc").limit(fetchCap + 1);
  const rows = await (query as any).execute();
  const hasMore = rows.length > fetchCap;
  const baseRows = hasMore ? rows.slice(0, fetchCap) : rows;

  // Lightweight text filter in memory (degraded approximation of search term).
  let filteredRows = baseRows;
  const q = params.q?.trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/).filter((t) => t.length >= 2);
    if (terms.length > 0) {
      const matched = baseRows.filter((row: any) => {
        const title = String(row.display_name ?? "").toLowerCase();
        return terms.some((t) => title.includes(t));
      });
      if (matched.length > 0) {
        filteredRows = matched;
      }
    }
  }

  const finalRows = filteredRows.slice(0, limit);
  return {
    results: finalRows.map((row: any) => ({
      type: "release" as const,
      discogs_id: row.discogs_id,
      master_discogs_id: row.master_discogs_id ?? null,
      name: null,
      title: row.display_name,
      year: row.year ?? null,
      country: row.country ?? null,
      data_quality: row.data_quality,
      relevance: 0,
      is_main_release: false,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: row.discogs_id },
    })),
    hasMore: hasMore || filteredRows.length > limit,
  };
}

// --- Fuzzy fallback ---

async function fuzzyFallback(
  db: Kysely<Database>,
  type: SearchEntityType,
  query: string,
  batchId: string,
  dumpDate: string,
): Promise<SearchResult[]> {
  // Release fuzzy is disabled per phase2-search-mitigation.md
  if (type === "release") return [];

  const tableName = `catalog.${type === "artist" ? "artists" : type === "label" ? "labels" : "masters"}`;
  const nameCol = type === "artist" || type === "label" ? "name" : "title";
  const isNameType = type === "artist" || type === "label";

  // v1 fuzzy policy:
  // - Artists (289k rows): full fuzzy, threshold 0.3, limit 10
  // - Labels (2.3M) / Masters (2.5M): stricter threshold 0.45, limit 5
  const threshold = type === "artist" ? SIMILARITY_ARTIST : SIMILARITY_LABEL_MASTER;
  const fuzzyLimit = type === "artist" ? 10 : FUZZY_CAP_LABEL_MASTER;

  // SET threshold on the connection before the query
  await sql`SELECT set_config('pg_trgm.similarity_threshold', ${String(threshold)}, true)`.execute(db);

  const rows = await sql<any>`
    SELECT discogs_id, ${sql.ref(nameCol)} as display_name, data_quality,
           similarity(${sql.ref(nameCol)}, ${query}) as sim
    FROM ${sql.table(tableName)}
    WHERE batch_id = ${batchId}
      AND ${sql.ref(nameCol)} % ${query}
    ORDER BY sim DESC
    LIMIT ${fuzzyLimit}
  `.execute(db);

  return rows.rows.map((row: any) => ({
    type,
    discogs_id: row.discogs_id,
    master_discogs_id: null,
    name: isNameType ? row.display_name : null,
    title: isNameType ? null : row.display_name,
    year: null,
    country: null,
    data_quality: row.data_quality,
    relevance: Number(row.sim),
    is_main_release: false,
    provenance: {
      source: "discogs" as const,
      dump_date: dumpDate,
      discogs_id: row.discogs_id,
    },
  }));
}

function scoreSearchResult(result: SearchResult, rawQuery: string, explicitType?: SearchEntityType): number {
  const relevanceScore = result.relevance * 100;

  // Single-type searches: use FTS rank with name-match bonuses
  if (explicitType) {
    const display = (result.name || result.title || "").toLowerCase();
    const q = rawQuery.trim().toLowerCase();
    let bonus = 0;
    if (q.length > 0 && display.length > 0) {
      if (display === q) bonus += 500;
      else if (display.startsWith(q)) bonus += 100;
    }
    if (result.is_main_release) bonus += 50;
    return relevanceScore + bonus;
  }

  // Tighter type weights: small enough that name-match bonuses dominate.
  // Prevents non-matching artists from flooding above relevant masters.
  const typeWeight: Record<SearchEntityType, number> = {
    artist: 150,
    master: 120,
    release: 80,
    label: 40,
  };

  const display = (result.name || result.title || "").toLowerCase();
  const q = rawQuery.trim().toLowerCase();
  let bonus = 0;
  if (q.length > 0 && display.length > 0) {
    if (display === q) bonus += 1200;
    else if (display.startsWith(q)) bonus += 220;
    // Substring match: query appears within the name/title
    else if (display.includes(q)) bonus += 80;
  }
  // Main releases (canonical pressings) rank above variants
  if (result.is_main_release) bonus += 50;
  return typeWeight[result.type] + relevanceScore + bonus;
}

// --- Main search entry point ---

export async function search(
  db: Kysely<Database>,
  params: SearchParams,
): Promise<SearchResponse> {
  const start = Date.now();

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursorData = params.cursor ? decodeCursor(params.cursor) : null;

  // Short-circuit: if the query is entirely stop words, the tsquery will be
  // empty and match everything (causing a full table scan / timeout).
  // Return empty results immediately with a hint.
  if (params.q && isEmptyTsquery(params.q)) {
    return {
      results: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        query: params.q,
        type: params.type ?? null,
        filters_applied: {},
        elapsed_ms: Date.now() - start,
        hint: "Query contains only common words. Try more specific search terms.",
        degraded: true,
        degraded_reason: "empty_tsquery",
      },
    };
  }

  const broad = isBroadQuery(params);

  const filtersApplied: Record<string, string | number> = {};
  if (params.genre) filtersApplied.genre = params.genre;
  if (params.style) filtersApplied.style = params.style;
  if (params.year !== undefined) filtersApplied.year = params.year;
  if (params.yearMin !== undefined) filtersApplied.year_min = params.yearMin;
  if (params.yearMax !== undefined) filtersApplied.year_max = params.yearMax;
  if (params.country) filtersApplied.country = params.country;

  const types: SearchEntityType[] = params.type
    ? [params.type]
    : ["artist", "label", "master", "release"];

  // Resolve per-entity-type batches BEFORE the pinned connection so the
  // expensive EXISTS scan (cold cache on 18.9M rows) is not subject to
  // the 3s statement_timeout. Results are cached in-memory for 60s.
  const batchMap = await getBatchMap(db, types);

  // Use a single connection with statement_timeout to enforce per-query time limits.
  return await db.connection().execute(async (conn) => {
    await sql`SET statement_timeout = '3s'`.execute(conn);

    try {

      // Multi-type: cap per-type to prevent one type flooding results.
      // Single-type: use full limit.
      const perTypeLimit = params.type ? limit : Math.max(5, Math.ceil(limit * 0.4));

      let allResults: SearchResult[] = [];
      let hasMore = false;
      let hint: string | null = null;
      let degraded = false;
      let degradedReason: string | null = null;

      for (const entityType of types) {
        const batchInfo = batchMap.get(entityType);
        if (!batchInfo) continue; // no batch for this entity type
        const { batchId, dumpDate } = batchInfo;

        try {
          // Path B: Broad release queries — degraded fast path
          if (broad && entityType === "release") {
            // Disable bitmap scan on this connection to force index scan backward.
            // This prevents PG from choosing a bitmap heap scan on the FTS GIN
            // index which reads tens of thousands of heap pages.
            await sql`SET enable_bitmapscan = off`.execute(conn);
            const { results, hasMore: typeHasMore } = await searchGuardedRelease(
              conn, params, batchId, dumpDate, perTypeLimit, cursorData,
            );
            await sql`RESET enable_bitmapscan`.execute(conn);
            allResults.push(...results);
            if (typeHasMore) hasMore = true;
            degraded = true;
            degradedReason = "broad_query";
            hint = "Broad query \u2014 showing recent matches. Add filters or more search terms for ranked results.";
            continue;
          }

          // Path B: Filtered release queries — guarded path
          if (needsGuardedPath(params, entityType)) {
            const filterCount = [
              params.genre, params.style, params.country,
              params.year !== undefined, params.yearMin !== undefined, params.yearMax !== undefined,
            ].filter(Boolean).length;

            // Genre/style filters hit expensive GIN+EXISTS paths that degrade
            // badly under concurrency (7s+ p50 at c10). Route them straight to
            // the capped fallback which skips FTS and uses pure structured filters.
            // Scalar-only filters (year, country) are cheaper and can try FTS first.
            const hasGenreOrStyle = !!(params.genre || params.style);

            if (filterCount >= 2 || hasGenreOrStyle) {
              const capped = await searchFilteredCappedRelease(
                conn, params, batchId, dumpDate, perTypeLimit, cursorData,
              );
              allResults.push(...capped.results);
              if (capped.hasMore) hasMore = true;
              degraded = true;
              degradedReason = degradedReason ?? "filtered_capped";
              hint = hint ?? "Filtered results — showing recent matches. Simplify filters for ranked results.";
              trackRequest(entityType, false);
              continue;
            }

            // Scalar-only filter (year/country): try guarded path with tighter timeout
            await sql`SET statement_timeout = '1500ms'`.execute(conn);
            await sql`SET enable_bitmapscan = off`.execute(conn);
            const { results, hasMore: typeHasMore, capped } = await searchGuardedRelease(
              conn, params, batchId, dumpDate, perTypeLimit, cursorData,
            );
            await sql`RESET enable_bitmapscan`.execute(conn);
            await sql`SET statement_timeout = '3s'`.execute(conn);
            allResults.push(...results);
            if (typeHasMore) hasMore = true;
            degraded = true;
            degradedReason = degradedReason ?? (capped ? "filtered_capped" : "filtered");
            hint = hint ?? (capped
              ? "Filtered results capped — try narrowing your search for complete results."
              : "Filtered results — showing recent matches. Remove filters for relevance-ranked results.");
            continue;
          }

          // Path A: Ranked search (default)
          const { results, hasMore: typeHasMore } = await searchRanked(
            conn, entityType, params, batchId, dumpDate, perTypeLimit, cursorData,
          );
          allResults.push(...results);
          if (typeHasMore) hasMore = true;
          trackRequest(entityType, false);
        } catch (err: any) {
          // If a single entity type query times out (57014), skip it gracefully
          if (err.code === "57014") {
            // Filtered release queries should degrade to a capped fallback instead
            // of returning empty results under concurrency pressure.
            if (entityType === "release" && needsGuardedPath(params, entityType)) {
              // Restore timeout for capped fallback (it uses structured filters only, fast)
              await sql`SET statement_timeout = '3s'`.execute(conn);
              const capped = await searchFilteredCappedRelease(
                conn, params, batchId, dumpDate, perTypeLimit, cursorData,
              );
              allResults.push(...capped.results);
              if (capped.hasMore) hasMore = true;
              degraded = true;
              degradedReason = degradedReason ?? "filtered_capped";
              hint = hint ?? "High-load fallback applied for filtered search. Refine terms for more precise ranking.";
              trackRequest(entityType, true);
              continue;
            }

            trackRequest(entityType, true);
            hint = hint ?? "Some results may be incomplete due to query complexity";
            degradedReason = degradedReason ?? "statement_timeout";
            continue;
          }
          throw err;
        }
      }

      // Quality filter: remove suppressed/invalid/low_value entities from results.
      // Fail-open: entities with no quality row pass through (backfill may not be complete).
      // Bypass with quality=all for admin/debug purposes.
      if ((params.quality ?? "active") === "active" && allResults.length > 0) {
        try {
          const suppressed = await getSuppressedEntityKeys(conn, allResults);
          if (suppressed.size > 0) {
            allResults = allResults.filter(r => !suppressed.has(`${r.type}:${r.discogs_id}`));
          }
        } catch {
          // Quality table may not exist yet (before migration) — fail open, don't suppress anything
        }
      }

      // If FTS returned nothing and we have a query, try fuzzy fallback
      if (allResults.length === 0 && params.q && params.q.length >= 4) {
        for (const entityType of types) {
          if (entityType === "release") {
            hint = hint ?? "Try a different spelling";
            continue;
          }
          const fuzzyBatch = batchMap.get(entityType);
          if (!fuzzyBatch) continue;
          try {
            const fuzzyResults = await fuzzyFallback(conn, entityType, params.q, fuzzyBatch.batchId, fuzzyBatch.dumpDate);
            allResults.push(...fuzzyResults);
            trackRequest(`${entityType}_fuzzy`, false);
          } catch (err: any) {
            if (err.code === "57014") {
              trackRequest(`${entityType}_fuzzy`, true);
              hint = hint ?? "Some results may be incomplete due to query complexity";
              continue;
            }
            throw err;
          }
        }
      }

      // Zero-result rescue: when quality=active returns nothing and rescue is enabled,
      // run a fuzzy artist search without quality filtering to surface "Did you mean?" candidates.
      // Triggers only for explicit artist queries (or untyped) with ≥4-char query.
      let suggestedResults: SearchResult[] | null = null;
      if (
        params.rescue &&
        allResults.length === 0 &&
        params.q &&
        params.q.length >= 4 &&
        (params.type === "artist" || params.type === undefined)
      ) {
        const artistBatch = batchMap.get("artist");
        if (artistBatch) {
          try {
            const rescue = await fuzzyFallback(conn, "artist", params.q, artistBatch.batchId, artistBatch.dumpDate);
            if (rescue.length > 0) {
              suggestedResults = rescue.slice(0, 3);
            }
          } catch { /* skip rescue on error — non-blocking */ }
        }
      }

      // Sort combined results with artist/master preference for all-type searches.
      // Explicit type searches keep strict relevance ordering.
      allResults.sort((a, b) => {
        const sa = scoreSearchResult(a, params.q || "", params.type);
        const sb = scoreSearchResult(b, params.q || "", params.type);
        if (sb !== sa) return sb - sa;
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        return b.discogs_id - a.discogs_id;
      });

      // Trim to limit
      if (allResults.length > limit) {
        allResults = allResults.slice(0, limit);
        hasMore = true;
      }

      // Build cursor from last result
      const lastResult = allResults[allResults.length - 1];
      const nextCursor = lastResult && hasMore
        ? encodeCursor(lastResult.discogs_id, lastResult.relevance)
        : null;

      return {
        results: allResults,
        pagination: {
          cursor: nextCursor,
          has_more: hasMore,
          total_estimate: null,
        },
        meta: {
          query: params.q || "",
          type: params.type ?? null,
          filters_applied: filtersApplied,
          elapsed_ms: Date.now() - start,
          hint,
          degraded,
          degraded_reason: degradedReason,
          suggested_results: suggestedResults,
        },
      };
    } finally {
      await sql`RESET statement_timeout`.execute(conn).catch(() => {});
    }
  });
}
