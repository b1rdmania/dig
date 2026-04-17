/**
 * Multi-entity search service — slim master-first shape.
 *
 * Entity types in scope: artist | label | master.
 *
 * `release` is retained in the type union for API contract stability during
 * the cutover, but every release-specific code path now returns an empty
 * result with `degraded: true` and `degraded_reason: "release_search_disabled"`.
 * The `dig-db-scene` DB carries no `catalog.releases` table — release-level
 * search makes no sense in the slim product (release pages 301 → master).
 *
 * Strategy (slim):
 *   - One ranked FTS path per entity type (artist/label/master).
 *   - master-genre / master-style filters: `ANY(genres)` / `ANY(styles)` on
 *     the denormed TEXT[] columns (no join to dropped master_genres/styles).
 *   - master-year filter: scalar column on catalog.masters.
 *   - master-country filter: `primary_country` denormed column.
 *   - Quality filter (active by default) suppresses entries via enrich.entity_quality.
 *
 * Envelope (unchanged from full-catalog):
 *   - Min query length: 2, max: 200
 *   - Max page size: 50, default 20
 *   - Cursor-based pagination
 *   - 3s per-statement timeout (enforced via pinned connection)
 *   - Fuzzy fallback: artist (full), label/master (stricter cap)
 *   - Empty-tsquery short-circuit (stop-word-only queries)
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";
import { getBatchForTable } from "./batch.js";
import { getSuppressedEntityKeys } from "./quality.js";

export type SearchEntityType = "artist" | "label" | "master" | "release";

/** Entity types the slim DB can actually search. Used for default fan-out. */
const SUPPORTED_TYPES: SearchEntityType[] = ["artist", "label", "master"];

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
  /** Zero-result rescue — see full doc on the field below. */
  rescue?: boolean;
}

export interface SearchResult {
  type: SearchEntityType;
  discogs_id: number;
  master_discogs_id: number | null;
  name: string | null;
  title: string | null;
  /**
   * For type="master": denormed primary artist name from catalog.masters.
   * Null for other entity types (or when the master row has no primary artist).
   */
  primary_artist: string | null;
  /**
   * For type="master": denormed primary label name from catalog.masters.
   * Null for other entity types (or when the master row has no primary label).
   */
  primary_label: string | null;
  year: number | null;
  country: string | null;
  data_quality: string;
  relevance: number;
  is_main_release: boolean;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
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
    fallback_used?: boolean;
    fallback_profile?: string | null;
    suggested_results?: SearchResult[] | null;
  };
}

export interface SearchError {
  code: string;
  message: string;
}

// --- Timeout rate tracking -------------------------------------------------

const TIMEOUT_WINDOW_MS = 15 * 60 * 1000;
const TIMEOUT_ALERT_THRESHOLD = 0.01; // 1%

interface TimeoutBucket { total: number; timeouts: number; windowStart: number }
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

  if (bucket.total >= 10 && bucket.timeouts / bucket.total > TIMEOUT_ALERT_THRESHOLD) {
    console.warn(
      `[dig:search] TIMEOUT_RATE_HIGH category=${category} ` +
      `timeouts=${bucket.timeouts}/${bucket.total} ` +
      `rate=${(bucket.timeouts / bucket.total * 100).toFixed(1)}% ` +
      `window=${Math.round((now - bucket.windowStart) / 1000)}s`,
    );
  }
}

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

// --- Lane classification (kept for API logging / metrics) ------------------

export type SearchLane = "core" | "heavy";

export function classifySearchLane(_params: SearchParams): SearchLane {
  // In the slim shape there are no release filters → no heavy lane.
  // Kept as an export to preserve the public API surface; always returns "core".
  return "core";
}

// --- Constants -------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const MIN_RANK_THRESHOLD = 0.0001;
const SIMILARITY_ARTIST = 0.3;
const SIMILARITY_LABEL_MASTER = 0.5;
const FUZZY_CAP_LABEL_MASTER = 5;

const BROAD_TERMS = new Set([
  "love", "remix", "the", "you", "live", "blue", "rock", "jazz", "house",
  "soul", "baby", "night", "dance", "dream", "world", "heart", "time",
  "best", "gold", "fire", "magic", "party", "super", "radio", "black",
  "white", "sweet", "angel", "crazy", "happy", "dj",
]);

/**
 * Detect broad single-token queries. Retained for callers that log this
 * signal — in the slim shape we no longer take a different code path on it
 * (no release table, no GIN-on-FTS heavy path), but it remains a useful
 * UX hint indicator.
 */
export function isBroadQuery(params: SearchParams): boolean {
  if (!params.q) return false;
  if (params.genre || params.style || params.year !== undefined
    || params.yearMin !== undefined || params.yearMax !== undefined
    || params.country) return false;
  const trimmed = params.q.trim();
  const isSingleToken = !trimmed.includes(" ");
  if (!isSingleToken) return false;
  if (trimmed.length <= 5) return true;
  return BROAD_TERMS.has(trimmed.toLowerCase());
}

interface DecodedCursor { discogs_id: number; rank: number }

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

const ENGLISH_STOP_WORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "but", "by", "for",
  "from", "had", "has", "have", "he", "her", "his", "how", "i", "if", "in",
  "into", "is", "it", "its", "just", "me", "my", "no", "not", "of", "on",
  "or", "our", "s", "she", "so", "t", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "to", "too", "us", "very", "was", "we",
  "what", "when", "which", "who", "will", "with", "would", "you", "your",
]);

function isEmptyTsquery(q: string): boolean {
  const tokens = q.toLowerCase().trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return true;
  return tokens.every((t) => ENGLISH_STOP_WORDS.has(t));
}

/** Slim shape: only artist / label / master have batch-resolvable backing tables. */
const ENTITY_TABLE: Partial<Record<SearchEntityType, string>> = {
  artist: "catalog.artists",
  label: "catalog.labels",
  master: "catalog.masters",
};

async function getBatchMap(
  db: Kysely<Database>,
  types: SearchEntityType[],
): Promise<Map<SearchEntityType, { batchId: string; dumpDate: string }>> {
  const map = new Map<SearchEntityType, { batchId: string; dumpDate: string }>();
  const seen = new Map<string, { batchId: string; dumpDate: string }>();
  for (const t of types) {
    const table = ENTITY_TABLE[t];
    if (!table) continue;
    if (seen.has(table)) {
      map.set(t, seen.get(table)!);
      continue;
    }
    try {
      const info = await getBatchForTable(db, table);
      seen.set(table, info);
      map.set(t, info);
    } catch {
      // No batch for this entity type — skip
    }
  }
  return map;
}

// --- Ranked search (sole path) --------------------------------------------

async function searchRanked(
  db: Kysely<Database>,
  type: "artist" | "label" | "master",
  params: SearchParams,
  batchId: string,
  dumpDate: string,
  limit: number,
  cursorData: DecodedCursor | null,
): Promise<{ results: SearchResult[]; hasMore: boolean }> {
  const tableName = type === "artist" ? "catalog.artists"
                  : type === "label"  ? "catalog.labels"
                                      : "catalog.masters";
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

  if (params.q) {
    const tsqueryFn = sql`plainto_tsquery('english', ${params.q})`;
    const qLower = params.q.toLowerCase().trim();
    query = query
      .where(sql`search_vector @@ ${tsqueryFn}` as any)
      .select(sql`(
        ts_rank_cd(search_vector, ${tsqueryFn})
        + CASE WHEN lower(${sql.ref(nameCol)}) = ${qLower} THEN 10
               WHEN lower(${sql.ref(nameCol)}) LIKE ${qLower + "%"} THEN 2
               ELSE 0 END
      )`.as("rank") as any)
      .where(sql`ts_rank_cd(search_vector, ${tsqueryFn}) > ${MIN_RANK_THRESHOLD}` as any);
  } else {
    query = query.select(sql`0`.as("rank") as any);
  }

  // Master-only structured columns
  if (type === "master") {
    query = query.select([
      "year",
      "primary_country as country",
      "primary_artist_name",
      "primary_label_name",
    ] as any[]);

    if (params.year !== undefined) {
      query = query.where("year" as any, "=", params.year);
    }
    if (params.yearMin !== undefined) {
      query = query.where("year" as any, ">=", params.yearMin);
    }
    if (params.yearMax !== undefined) {
      query = query.where("year" as any, "<=", params.yearMax);
    }
    if (params.country) {
      query = query.where("primary_country" as any, "=", params.country);
    }
    if (params.genre) {
      // Denormed TEXT[] on catalog.masters — uses GIN(genres) index
      query = query.where(sql`${sql.ref("genres")} @> ARRAY[${params.genre}]::text[]` as any);
    }
    if (params.style) {
      query = query.where(sql`${sql.ref("styles")} @> ARRAY[${params.style}]::text[]` as any);
    }
  }

  if (cursorData && params.q) {
    const tsqueryFn = sql`plainto_tsquery('english', ${params.q})`;
    query = query.where(
      sql`(ts_rank_cd(search_vector, ${tsqueryFn}), discogs_id) < (${cursorData.rank}, ${cursorData.discogs_id})` as any,
    );
  } else if (cursorData) {
    query = query.where("discogs_id" as any, "<", cursorData.discogs_id);
  }

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
      master_discogs_id: null,
      name: isNameType ? row.display_name : null,
      title: isNameType ? null : row.display_name,
      primary_artist: type === "master" ? (row.primary_artist_name ?? null) : null,
      primary_label: type === "master" ? (row.primary_label_name ?? null) : null,
      year: row.year ?? null,
      country: row.country ?? null,
      data_quality: row.data_quality,
      relevance: row.rank ? Math.min(1, Math.max(0, Number(row.rank))) : 0,
      // Slim shape doesn't carry release-level main-release flag; kept false.
      is_main_release: false,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: row.discogs_id },
    })),
    hasMore,
  };
}

// --- Fuzzy fallback --------------------------------------------------------

async function fuzzyFallback(
  db: Kysely<Database>,
  type: "artist" | "label" | "master",
  query: string,
  batchId: string,
  dumpDate: string,
): Promise<SearchResult[]> {
  const tableName = type === "artist" ? "catalog.artists"
                  : type === "label"  ? "catalog.labels"
                                      : "catalog.masters";
  const nameCol = type === "artist" || type === "label" ? "name" : "title";
  const isNameType = type === "artist" || type === "label";

  const threshold = type === "artist" ? SIMILARITY_ARTIST : SIMILARITY_LABEL_MASTER;
  const fuzzyLimit = type === "artist" ? 10 : FUZZY_CAP_LABEL_MASTER;

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
    primary_artist: null,
    primary_label: null,
    year: null,
    country: null,
    data_quality: row.data_quality,
    relevance: Number(row.sim),
    is_main_release: false,
    provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: row.discogs_id },
  }));
}

function scoreSearchResult(result: SearchResult, rawQuery: string, explicitType?: SearchEntityType): number {
  const relevanceScore = result.relevance * 100;

  if (explicitType) {
    const display = (result.name || result.title || "").toLowerCase();
    const q = rawQuery.trim().toLowerCase();
    let bonus = 0;
    if (q.length > 0 && display.length > 0) {
      if (display === q) bonus += 500;
      else if (display.startsWith(q)) bonus += 100;
    }
    return relevanceScore + bonus;
  }

  // Master-first product → bias the multi-type ranking accordingly.
  // Masters lead, then artists, then labels (the only three searchable in slim).
  const typeWeight: Record<SearchEntityType, number> = {
    master: 200,
    artist: 150,
    label: 60,
    release: 0,
  };

  const display = (result.name || result.title || "").toLowerCase();
  const q = rawQuery.trim().toLowerCase();
  let bonus = 0;
  if (q.length > 0 && display.length > 0) {
    if (display === q) bonus += 1200;
    else if (display.startsWith(q)) bonus += 220;
    else if (display.includes(q)) bonus += 80;
  }
  return typeWeight[result.type] + relevanceScore + bonus;
}

// --- Main entry point ------------------------------------------------------

export async function search(
  db: Kysely<Database>,
  params: SearchParams,
): Promise<SearchResponse> {
  const start = Date.now();

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursorData = params.cursor ? decodeCursor(params.cursor) : null;

  // Stop-word-only short-circuit
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

  // type=release in the slim shape: no-op with a clear degraded reason.
  if (params.type === "release") {
    return {
      results: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        query: params.q || "",
        type: "release",
        filters_applied: {},
        elapsed_ms: Date.now() - start,
        hint: "Release-level search is disabled in the slim catalog. Search for masters instead.",
        degraded: true,
        degraded_reason: "release_search_disabled",
      },
    };
  }

  const filtersApplied: Record<string, string | number> = {};
  if (params.genre) filtersApplied.genre = params.genre;
  if (params.style) filtersApplied.style = params.style;
  if (params.year !== undefined) filtersApplied.year = params.year;
  if (params.yearMin !== undefined) filtersApplied.year_min = params.yearMin;
  if (params.yearMax !== undefined) filtersApplied.year_max = params.yearMax;
  if (params.country) filtersApplied.country = params.country;

  // Default fan-out is the three searchable types (no release).
  const types: Array<"artist" | "label" | "master"> = params.type
    ? [params.type as "artist" | "label" | "master"]
    : (SUPPORTED_TYPES.filter((t) => t !== "release") as Array<"artist" | "label" | "master">);

  const batchMap = await getBatchMap(db, types);

  return await db.connection().execute(async (conn) => {
    await sql`SET statement_timeout = '3s'`.execute(conn);

    try {
      const perTypeLimit = params.type ? limit : Math.max(5, Math.ceil(limit * 0.5));

      let allResults: SearchResult[] = [];
      let hasMore = false;
      let hint: string | null = null;
      let degraded = false;
      let degradedReason: string | null = null;
      let fallbackUsed = false;
      let fallbackProfile: string | null = null;
      const primaryTimedOutTypes = new Set<"artist" | "label" | "master">();

      for (const entityType of types) {
        const batchInfo = batchMap.get(entityType);
        if (!batchInfo) continue;
        const { batchId, dumpDate } = batchInfo;

        try {
          const { results, hasMore: typeHasMore } = await searchRanked(
            conn, entityType, params, batchId, dumpDate, perTypeLimit, cursorData,
          );
          allResults.push(...results);
          if (typeHasMore) hasMore = true;
          trackRequest(entityType, false);
        } catch (err: any) {
          if (err.code === "57014") {
            primaryTimedOutTypes.add(entityType);
            trackRequest(entityType, true);
            hint = hint ?? "Some results may be incomplete due to query complexity";
            degraded = true;
            degradedReason = degradedReason ?? "statement_timeout";
            continue;
          }
          throw err;
        }
      }

      // Quality filter — fail-open if table is missing
      if ((params.quality ?? "active") === "active" && allResults.length > 0) {
        try {
          const suppressed = await getSuppressedEntityKeys(conn, allResults);
          if (suppressed.size > 0) {
            allResults = allResults.filter((r) => !suppressed.has(`${r.type}:${r.discogs_id}`));
          }
        } catch {
          /* fail open */
        }
      }

      // Fuzzy fallback when ranked path produced nothing
      if (allResults.length === 0 && params.q && params.q.length >= 4) {
        for (const entityType of types) {
          const fuzzyBatch = batchMap.get(entityType);
          if (!fuzzyBatch) continue;
          try {
            const fuzzyResults = await fuzzyFallback(conn, entityType, params.q, fuzzyBatch.batchId, fuzzyBatch.dumpDate);
            allResults.push(...fuzzyResults);
            trackRequest(`${entityType}_fuzzy`, false);
            if (fuzzyResults.length > 0 && primaryTimedOutTypes.has(entityType)) {
              fallbackUsed = true;
              fallbackProfile = `${entityType}_fast_path_v1`;
            }
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

      // Zero-result rescue for explicit (or untyped) artist queries
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
          } catch { /* non-blocking */ }
        }
      }

      // Combined ranking with master-first bias
      allResults.sort((a, b) => {
        const sa = scoreSearchResult(a, params.q || "", params.type);
        const sb = scoreSearchResult(b, params.q || "", params.type);
        if (sb !== sa) return sb - sa;
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        return b.discogs_id - a.discogs_id;
      });

      if (allResults.length > limit) {
        allResults = allResults.slice(0, limit);
        hasMore = true;
      }

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
          fallback_used: fallbackUsed || undefined,
          fallback_profile: fallbackUsed ? fallbackProfile : undefined,
          suggested_results: suggestedResults,
        },
      };
    } finally {
      await sql`RESET statement_timeout`.execute(conn).catch(() => {});
    }
  });
}
