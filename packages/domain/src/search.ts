/**
 * Multi-entity search service.
 *
 * Enforces query envelope from phase2-query-envelope.md:
 * - Min query length: 2 chars
 * - Max query length: 200 chars
 * - Max page size: 100, default 20
 * - Cursor-based pagination
 * - 5s statement timeout
 * - Fuzzy fallback on artist/label/master only (not releases)
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
  };
}

export interface SearchError {
  code: string;
  message: string;
}

const SIMILARITY_THRESHOLD = 0.3;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const STATEMENT_TIMEOUT_MS = 5000;

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

  // FTS ranking
  if (params.q) {
    query = query
      .where(sql`search_vector @@ plainto_tsquery('english', ${params.q})` as any)
      .select(sql`ts_rank_cd(search_vector, plainto_tsquery('english', ${params.q}))`.as("rank") as any);
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

  // Cursor-based pagination
  if (cursorData && params.q) {
    query = query.where(sql`(ts_rank_cd(search_vector, plainto_tsquery('english', ${params.q})), discogs_id) < (${cursorData.rank}, ${cursorData.discogs_id})` as any);
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

  // Set statement timeout for this session
  await sql`SET LOCAL statement_timeout = '5s'`.execute(db);

  const { batchId, dumpDate } = await getBatchInfo(db);

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

  for (const entityType of types) {
    const { results, hasMore: typeHasMore } = await searchSingleType(
      db, entityType, params, batchId, dumpDate, limit, cursorData,
    );
    allResults.push(...results);
    if (typeHasMore) hasMore = true;
  }

  // If FTS returned nothing and we have a query, try fuzzy fallback
  if (allResults.length === 0 && params.q && params.q.length >= 4) {
    for (const entityType of types) {
      if (entityType === "release") {
        hint = "Try a different spelling";
        continue;
      }
      const fuzzyResults = await fuzzyFallback(db, entityType, params.q, batchId, dumpDate);
      allResults.push(...fuzzyResults);
    }
  }

  // Sort combined results by relevance
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
    },
  };
}
