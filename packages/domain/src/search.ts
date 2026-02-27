/**
 * Multi-entity search service.
 *
 * Enforces query envelope from phase2-query-envelope.md:
 * - Min query length: 2 chars
 * - Max query length: 200 chars
 * - Max page size: 50, default 20
 * - Cursor-based pagination
 * - 2s per-statement timeout (enforced via pinned connection)
 * - Fuzzy fallback on artist/label/master only (not releases)
 * - Broad query detection → degraded-but-useful response
 * - Minimum rank threshold to filter low-relevance noise
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";

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
}

export interface SearchResult {
  type: SearchEntityType;
  discogs_id: number;
  name: string | null;
  title: string | null;
  year: number | null;
  country: string | null;
  data_quality: string;
  relevance: number;
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
  };
}

export interface SearchError {
  code: string;
  message: string;
}

const SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
/** Minimum ts_rank_cd score to include in results — filters common-term noise */
const MIN_RANK_THRESHOLD = 0.0001;

/** High-frequency single terms that trigger degraded mode on releases */
const BROAD_TERMS = new Set([
  "love", "remix", "the", "you", "live", "blue", "rock", "jazz", "house",
  "soul", "baby", "night", "dance", "dream", "world", "heart", "time",
  "best", "gold", "fire", "magic", "party", "super", "radio", "black",
  "white", "sweet", "angel", "crazy", "happy", "dj",
]);

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

async function getBatchInfo(db: Kysely<Database>): Promise<{ batchId: string; dumpDate: string }> {
  const batch = await db
    .selectFrom("ingest.dump_batches")
    .select(["id", "dump_date"])
    .where("status", "in", ["active", "qa"])
    .orderBy("created_at", "desc")
    .executeTakeFirstOrThrow();
  return { batchId: batch.id, dumpDate: batch.dump_date };
}

async function searchSingleType(
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

  // Build the query
  let query = db
    .selectFrom(tableName as any)
    .select([
      "discogs_id",
      `${nameCol} as display_name`,
      "data_quality",
    ] as any[])
    .where("batch_id" as any, "=", batchId);

  // FTS ranking — use websearch_to_tsquery for stricter matching on releases
  if (params.q) {
    const tsqueryFn = type === "release"
      ? sql`websearch_to_tsquery('english', ${params.q})`
      : sql`plainto_tsquery('english', ${params.q})`;
    query = query
      .where(sql`search_vector @@ ${tsqueryFn}` as any)
      .select(sql`ts_rank_cd(search_vector, ${tsqueryFn})`.as("rank") as any);
  } else {
    query = query.select(sql`0`.as("rank") as any);
  }

  // Add year/country for types that have them
  if (type === "master") {
    query = query.select("year" as any);
  } else if (type === "release") {
    query = query
      .select(["release_year as year", "country"] as any[]);
  }

  // Apply filters
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

  // Genre/style filters via subquery
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

  // Minimum rank threshold — filters low-relevance noise from common terms
  if (params.q) {
    const tsqueryFn = type === "release"
      ? sql`websearch_to_tsquery('english', ${params.q})`
      : sql`plainto_tsquery('english', ${params.q})`;
    query = query.where(sql`ts_rank_cd(search_vector, ${tsqueryFn}) > ${MIN_RANK_THRESHOLD}` as any);
  }

  // Cursor-based pagination
  if (cursorData && params.q) {
    const tsqueryFn = type === "release"
      ? sql`websearch_to_tsquery('english', ${params.q})`
      : sql`plainto_tsquery('english', ${params.q})`;
    query = query.where(sql`(ts_rank_cd(search_vector, ${tsqueryFn}), discogs_id) < (${cursorData.rank}, ${cursorData.discogs_id})` as any);
  } else if (cursorData) {
    query = query.where("discogs_id" as any, ">", cursorData.discogs_id);
  }

  // Order by rank desc, then discogs_id for tie-breaking
  if (params.q) {
    query = query.orderBy(sql`rank` as any, "desc").orderBy("discogs_id" as any, "desc");
  } else {
    query = query.orderBy("discogs_id" as any, "asc");
  }

  query = query.limit(limit + 1);

  const rows = await (query as any).execute();
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  const results: SearchResult[] = resultRows.map((row: any) => ({
    type,
    discogs_id: row.discogs_id,
    name: isNameType ? row.display_name : null,
    title: isNameType ? null : row.display_name,
    year: row.year ?? null,
    country: row.country ?? null,
    data_quality: row.data_quality,
    relevance: row.rank ? Math.min(1, Math.max(0, Number(row.rank))) : 0,
    provenance: {
      source: "discogs" as const,
      dump_date: dumpDate,
      discogs_id: row.discogs_id,
    },
  }));

  return { results, hasMore };
}

/**
 * Degraded search path for broad release queries.
 * Skips ts_rank_cd sort (expensive on 400k+ rows), returns recent matches instead.
 * Fast and deterministic — no sort on computed rank.
 */
async function searchBroadRelease(
  db: Kysely<Database>,
  params: SearchParams,
  batchId: string,
  dumpDate: string,
  limit: number,
  cursorData: DecodedCursor | null,
): Promise<{ results: SearchResult[]; hasMore: boolean }> {
  const tsqueryFn = sql`websearch_to_tsquery('english', ${params.q})`;

  let query = db
    .selectFrom("catalog.releases" as any)
    .select([
      "discogs_id",
      "title as display_name",
      "data_quality",
      "release_year as year",
      "country",
    ] as any[])
    .where("batch_id" as any, "=", batchId)
    .where(sql`search_vector @@ ${tsqueryFn}` as any)
    .orderBy("discogs_id" as any, "desc")
    .limit(limit + 1);

  if (cursorData) {
    query = query.where("discogs_id" as any, "<", cursorData.discogs_id);
  }

  const rows = await (query as any).execute();
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  return {
    results: resultRows.map((row: any) => ({
      type: "release" as const,
      discogs_id: row.discogs_id,
      name: null,
      title: row.display_name,
      year: row.year ?? null,
      country: row.country ?? null,
      data_quality: row.data_quality,
      relevance: 0,
      provenance: {
        source: "discogs" as const,
        dump_date: dumpDate,
        discogs_id: row.discogs_id,
      },
    })),
    hasMore,
  };
}

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

  const rows = await sql<any>`
    SELECT discogs_id, ${sql.ref(nameCol)} as display_name, data_quality,
           similarity(${sql.ref(nameCol)}, ${query}) as sim
    FROM ${sql.table(tableName)}
    WHERE batch_id = ${batchId}
      AND ${sql.ref(nameCol)} % ${query}
    ORDER BY sim DESC
    LIMIT 10
  `.execute(db);

  return rows.rows.map((row: any) => ({
    type,
    discogs_id: row.discogs_id,
    name: isNameType ? row.display_name : null,
    title: isNameType ? null : row.display_name,
    year: null,
    country: null,
    data_quality: row.data_quality,
    relevance: Number(row.sim),
    provenance: {
      source: "discogs" as const,
      dump_date: dumpDate,
      discogs_id: row.discogs_id,
    },
  }));
}

export async function search(
  db: Kysely<Database>,
  params: SearchParams,
): Promise<SearchResponse> {
  const start = Date.now();

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursorData = params.cursor ? decodeCursor(params.cursor) : null;

  const broad = isBroadQuery(params);

  // Use a single connection with statement_timeout to enforce per-query time limits.
  // Kysely's connection() ensures all queries run on the same pooled connection.
  return await db.connection().execute(async (conn) => {
    await sql`SET statement_timeout = '2s'`.execute(conn);

    try {
      const { batchId, dumpDate } = await getBatchInfo(conn);

      const filtersApplied: Record<string, string | number> = {};
      if (params.genre) filtersApplied.genre = params.genre;
      if (params.style) filtersApplied.style = params.style;
      if (params.year !== undefined) filtersApplied.year = params.year;
      if (params.yearMin !== undefined) filtersApplied.year_min = params.yearMin;
      if (params.yearMax !== undefined) filtersApplied.year_max = params.yearMax;
      if (params.country) filtersApplied.country = params.country;

      // If a specific type is requested, search just that type
      const types: SearchEntityType[] = params.type
        ? [params.type]
        : ["artist", "label", "master", "release"];

      let allResults: SearchResult[] = [];
      let hasMore = false;
      let hint: string | null = null;
      let degraded = false;

      for (const entityType of types) {
        try {
          // Broad queries on releases use the degraded fast path (no rank sort)
          if (broad && entityType === "release") {
            const { results, hasMore: typeHasMore } = await searchBroadRelease(
              conn, params, batchId, dumpDate, limit, cursorData,
            );
            allResults.push(...results);
            if (typeHasMore) hasMore = true;
            degraded = true;
            hint = "Broad query \u2014 showing recent matches. Add filters or more search terms for ranked results.";
            continue;
          }

          const { results, hasMore: typeHasMore } = await searchSingleType(
            conn, entityType, params, batchId, dumpDate, limit, cursorData,
          );
          allResults.push(...results);
          if (typeHasMore) hasMore = true;
        } catch (err: any) {
          // If a single entity type query times out (57014), skip it gracefully
          if (err.code === "57014") {
            hint = hint ?? "Some results may be incomplete due to query complexity";
            continue;
          }
          throw err;
        }
      }

      // If FTS returned nothing and we have a query, try fuzzy fallback
      if (allResults.length === 0 && params.q && params.q.length >= 4) {
        for (const entityType of types) {
          if (entityType === "release") {
            hint = hint ?? "Try a different spelling";
            continue;
          }
          try {
            const fuzzyResults = await fuzzyFallback(conn, entityType, params.q, batchId, dumpDate);
            allResults.push(...fuzzyResults);
          } catch (err: any) {
            if (err.code === "57014") {
              hint = hint ?? "Some results may be incomplete due to query complexity";
              continue;
            }
            throw err;
          }
        }
      }

      // Sort combined results by relevance (degraded results have relevance=0, will sort to end)
      allResults.sort((a, b) => b.relevance - a.relevance);

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
        },
      };
    } finally {
      await sql`RESET statement_timeout`.execute(conn).catch(() => {});
    }
  });
}
