/**
 * Multi-entity search service — scene-scoped, master-first.
 *
 * Entity types: artist | label | master. Release-level search does not exist
 * in this product (release pages 301 → master; pressing detail lives on
 * Discogs). Callers sending other type values get a 400 at the API edge.
 *
 * Strategy:
 *   - One ranked FTS path per entity type (artist/label/master).
 *   - 'simple'-config tsvectors/tsqueries (migration 033): the catalog is
 *     proper nouns, so no stemming and no stop-word removal — names like
 *     "Them" or "Who" are first-class searchable terms.
 *   - Prefix lane: the last query token matches as a prefix (`tok:*`), so
 *     "aphex tw" finds "Aphex Twin" — typeahead works without a second path.
 *   - master-genre / master-style filters: array-contains on the denormed
 *     TEXT[] columns (GIN-indexed).
 *   - master-year filter: scalar column on catalog.masters.
 *   - master-country filter: `primary_country` denormed column.
 *   - Quality filter (active by default) suppresses entries via enrich.entity_quality.
 *
 * Envelope:
 *   - Min query length: 2, max: 200
 *   - Max page size: 50, default 20
 *   - Cursor-based pagination (exact for single-type queries; the untyped
 *     fan-out interleaves three ranked streams, so its cursor is best-effort)
 *   - 3s per-statement timeout (enforced via pinned connection)
 *   - Fuzzy fallback: artist (full), label/master (stricter cap)
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";
import { getBatchForTable } from "./batch.js";
import { getSuppressedEntityKeys } from "./quality.js";

export type SearchEntityType = "artist" | "label" | "master";

const ALL_TYPES: SearchEntityType[] = ["artist", "label", "master"];

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
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

/**
 * Pinned "top match" card. Returned on the response root (separate from
 * `results`) when the query string is an exact (case-insensitive trim) match
 * to a label name OR artist name. Drives the label-first / artist-first
 * card pinned above the listing on the search page.
 *
 * For labels we attach the editorial palette/blurb/tier so the frontend
 * can render the catalog stamp without a second round trip.
 */
export interface SearchTopMatch {
  type: "label" | "artist";
  discogs_id: number;
  name: string;
  /** Label-only — tier1 / denylist / null. */
  tier: "tier1" | "denylist" | null;
  /** Label-only — { accent, accent_ink } when seeded; null otherwise. */
  palette: { accent: string; accent_ink: string } | null;
  /** Label-only — editorial blurb when seeded. */
  blurb: string | null;
}

/**
 * Approximate per-type counts. Each is the number of matches found up to
 * `TYPE_COUNT_LIMIT` (100); above that we expose `100+` semantics by leaving
 * the count at 100 and setting `*_capped` to true. Used to render the
 * type tabs (`ALL · LABELS · ARTISTS · RELEASES`) without a follow-up call.
 */
export interface SearchTypeCounts {
  artist: number;
  label: number;
  master: number;
  artist_capped?: boolean;
  label_capped?: boolean;
  master_capped?: boolean;
}

export interface SearchResponse {
  results: SearchResult[];
  /** Pinned top match (exact label/artist name hit). Null if no exact match. */
  top_match: SearchTopMatch | null;
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
    /** Approximate counts across all three searchable types. */
    type_counts?: SearchTypeCounts;
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

// --- Constants -------------------------------------------------------------

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 200;
const MIN_RANK_THRESHOLD = 0.0001;
const SIMILARITY_ARTIST = 0.3;
const SIMILARITY_LABEL_MASTER = 0.5;
const FUZZY_CAP_LABEL_MASTER = 5;

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

/** Bound tsquery complexity for adversarial many-token inputs. */
const MAX_QUERY_TOKENS = 12;

/**
 * Build the tsquery text for the 'simple' config: lowercase alphanumeric
 * tokens AND-ed together, with the final token prefix-matched so partial
 * typing still hits ("aphex tw" → "aphex & tw:*").
 *
 * Returns null when the input contains no indexable tokens (punctuation-only).
 * Tokens are stripped to letters/digits, so the result is safe to feed to
 * to_tsquery without further escaping.
 */
export function buildTsquery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, MAX_QUERY_TOKENS);
  if (tokens.length === 0) return null;
  const last = tokens[tokens.length - 1];
  return [...tokens.slice(0, -1), `${last}:*`].join(" & ");
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
  type: SearchEntityType,
  params: SearchParams,
  batchId: string,
  dumpDate: string,
  limit: number,
  cursorData: DecodedCursor | null,
): Promise<{ results: SearchResult[]; hasMore: boolean; rawRanks: Map<number, number> }> {
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

  const tsquery = params.q ? buildTsquery(params.q) : null;
  if (tsquery) {
    const tsqueryFn = sql`to_tsquery('simple', ${tsquery})`;
    const qLower = params.q!.toLowerCase().trim();
    query = query
      .where(sql`search_vector @@ ${tsqueryFn}` as any)
      .select(sql`(
        ts_rank_cd(search_vector, ${tsqueryFn})
        + CASE WHEN lower(${sql.ref(nameCol)}) = ${qLower} THEN 10
               WHEN lower(${sql.ref(nameCol)}) LIKE ${qLower + "%"} THEN 2
               ELSE 0 END
      )`.as("rank") as any)
      // Raw (unboosted) ts_rank_cd — this is the quantity the pagination
      // cursor predicate compares against, so it must be what we encode.
      .select(sql`ts_rank_cd(search_vector, ${tsqueryFn})`.as("raw_rank") as any)
      .where(sql`ts_rank_cd(search_vector, ${tsqueryFn}) > ${MIN_RANK_THRESHOLD}` as any);
  } else if (type === "master") {
    // Filter-only master search: rank by curation weight instead of falling
    // back to discogs_id-desc (which is meaningless newest-ID-first noise).
    // raw_rank carries the integer weight — the cursor predicate and encode
    // must agree on this quantity. rank is weight/100 so it flows through the
    // relevance clamp (weights are 0..~30) and keeps node-side sort ordering.
    query = query
      .select(sql`COALESCE(scene_weight, 0) / 100.0`.as("rank") as any)
      .select(sql`COALESCE(scene_weight, 0)`.as("raw_rank") as any);
  } else {
    query = query
      .select(sql`0`.as("rank") as any)
      .select(sql`0`.as("raw_rank") as any);
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

  if (cursorData && tsquery) {
    const tsqueryFn = sql`to_tsquery('simple', ${tsquery})`;
    query = query.where(
      sql`(ts_rank_cd(search_vector, ${tsqueryFn}), discogs_id) < (${cursorData.rank}, ${cursorData.discogs_id})` as any,
    );
  } else if (cursorData && type === "master") {
    query = query.where(
      sql`(COALESCE(scene_weight, 0), discogs_id) < (${cursorData.rank}, ${cursorData.discogs_id})` as any,
    );
  } else if (cursorData) {
    query = query.where("discogs_id" as any, "<", cursorData.discogs_id);
  }

  if (tsquery) {
    query = query.orderBy(sql`rank` as any, "desc").orderBy("discogs_id" as any, "desc");
  } else if (type === "master") {
    query = query.orderBy(sql`COALESCE(scene_weight, 0)` as any, "desc").orderBy("discogs_id" as any, "desc");
  } else {
    query = query.orderBy("discogs_id" as any, "desc");
  }

  query = query.limit(limit + 1);

  const rows = await (query as any).execute();
  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;

  const rawRanks = new Map<number, number>();
  for (const row of resultRows) {
    rawRanks.set(row.discogs_id, Number(row.raw_rank ?? 0));
  }

  return {
    results: resultRows.map((row: any) => ({
      type,
      discogs_id: row.discogs_id,
      name: isNameType ? row.display_name : null,
      title: isNameType ? null : row.display_name,
      primary_artist: type === "master" ? (row.primary_artist_name ?? null) : null,
      primary_label: type === "master" ? (row.primary_label_name ?? null) : null,
      year: row.year ?? null,
      country: row.country ?? null,
      data_quality: row.data_quality,
      relevance: row.rank ? Math.min(1, Math.max(0, Number(row.rank))) : 0,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: row.discogs_id },
    })),
    hasMore,
    rawRanks,
  };
}

// --- Fuzzy fallback --------------------------------------------------------

async function fuzzyFallback(
  db: Kysely<Database>,
  type: SearchEntityType,
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
    name: isNameType ? row.display_name : null,
    title: isNameType ? null : row.display_name,
    primary_artist: null,
    primary_label: null,
    year: null,
    country: null,
    data_quality: row.data_quality,
    relevance: Number(row.sim),
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
  // Masters lead, then artists, then labels.
  const typeWeight: Record<SearchEntityType, number> = {
    master: 200,
    artist: 150,
    label: 60,
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

// --- Top-match + per-type counts (for label-first product) -----------------

/** Bound the per-type COUNT to keep the query cheap. */
const TYPE_COUNT_LIMIT = 100;

/**
 * Find an exact (case-insensitive trim) name hit on labels then artists.
 * Returns at most one match — labels win ties because the product is
 * label-anchored. The query attaches editorial fields when present.
 *
 * Cheap: each lookup is a single equality on `lower(trim(name))` against
 * the same name column the search uses; we already have a trgm index on
 * `name`, but for exact matches Postgres uses the equality.
 */
async function findTopMatch(
  db: Kysely<Database>,
  query: string,
  batchMap: Map<SearchEntityType, { batchId: string; dumpDate: string }>,
): Promise<SearchTopMatch | null> {
  const q = query.trim();
  if (q.length < 2) return null;

  const labelBatch = batchMap.get("label");
  if (labelBatch) {
    const row = await sql<{
      discogs_id: number;
      name: string;
      tier: "tier1" | "denylist" | null;
      palette: { accent: string; accent_ink: string } | null;
      blurb: string | null;
    }>`
      SELECT l.discogs_id, l.name, e.tier, e.palette, e.blurb
      FROM catalog.labels l
      LEFT JOIN enrich.label_editorial e ON e.discogs_label_id = l.discogs_id
      WHERE l.batch_id = ${labelBatch.batchId}
        AND lower(trim(l.name)) = lower(trim(${q}))
      ORDER BY (e.tier = 'tier1') DESC NULLS LAST, l.discogs_id ASC
      LIMIT 1
    `.execute(db).catch(() => ({ rows: [] }));
    if (row.rows.length > 0) {
      const r = row.rows[0];
      return {
        type: "label",
        discogs_id: r.discogs_id,
        name: r.name,
        tier: r.tier ?? null,
        palette: r.palette ?? null,
        blurb: r.blurb ?? null,
      };
    }
  }

  const artistBatch = batchMap.get("artist");
  if (artistBatch) {
    const row = await sql<{ discogs_id: number; name: string }>`
      SELECT discogs_id, name
      FROM catalog.artists
      WHERE batch_id = ${artistBatch.batchId}
        AND lower(trim(name)) = lower(trim(${q}))
      ORDER BY discogs_id ASC
      LIMIT 1
    `.execute(db).catch(() => ({ rows: [] }));
    if (row.rows.length > 0) {
      const r = row.rows[0];
      return {
        type: "artist",
        discogs_id: r.discogs_id,
        name: r.name,
        tier: null,
        palette: null,
        blurb: null,
      };
    }
  }

  return null;
}

/**
 * Approximate per-type FTS counts, bounded by TYPE_COUNT_LIMIT.
 * Three short queries; runs on the same connection inside the search txn so
 * we inherit the 3s statement_timeout.
 */
async function getTypeCounts(
  db: Kysely<Database>,
  query: string,
  batchMap: Map<SearchEntityType, { batchId: string; dumpDate: string }>,
): Promise<SearchTypeCounts> {
  const counts: SearchTypeCounts = { artist: 0, label: 0, master: 0 };
  if (!query || query.trim().length < MIN_QUERY_LENGTH) return counts;
  const tsquery = buildTsquery(query);
  if (!tsquery) return counts;

  for (const type of ["artist", "label", "master"] as const) {
    const batch = batchMap.get(type);
    if (!batch) continue;
    const tableName = type === "artist" ? "catalog.artists"
                    : type === "label"  ? "catalog.labels"
                                        : "catalog.masters";
    try {
      const row = await sql<{ n: number }>`
        SELECT COUNT(*)::int AS n FROM (
          SELECT 1 FROM ${sql.table(tableName)}
          WHERE batch_id = ${batch.batchId}
            AND search_vector @@ to_tsquery('simple', ${tsquery})
          LIMIT ${TYPE_COUNT_LIMIT}
        ) sub
      `.execute(db);
      const n = row.rows[0]?.n ?? 0;
      counts[type] = n;
      if (n >= TYPE_COUNT_LIMIT) {
        counts[`${type}_capped`] = true;
      }
    } catch {
      // Fail-open — leave count at 0 for this type
    }
  }
  return counts;
}

// --- Main entry point ------------------------------------------------------

export async function search(
  db: Kysely<Database>,
  params: SearchParams,
): Promise<SearchResponse> {
  const start = Date.now();

  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursorData = params.cursor ? decodeCursor(params.cursor) : null;

  // No indexable tokens (punctuation-only query) — nothing to match.
  // With 'simple' vectors stop-word names like "Them" ARE searchable, so
  // this only fires for queries with no letters or digits at all.
  if (params.q && buildTsquery(params.q) === null) {
    return {
      results: [],
      top_match: null,
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        query: params.q,
        type: params.type ?? null,
        filters_applied: {},
        elapsed_ms: Date.now() - start,
        hint: "Query contains no searchable words. Try letters or numbers.",
        degraded: true,
        degraded_reason: "empty_tsquery",
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

  const types: SearchEntityType[] = params.type ? [params.type] : ALL_TYPES;

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
      const primaryTimedOutTypes = new Set<SearchEntityType>();
      // Raw ts_rank_cd per result (keyed type:id) — used to encode the
      // pagination cursor with the same quantity the SQL predicate compares.
      const rawRankByKey = new Map<string, number>();

      for (const entityType of types) {
        const batchInfo = batchMap.get(entityType);
        if (!batchInfo) continue;
        const { batchId, dumpDate } = batchInfo;

        try {
          const { results, hasMore: typeHasMore, rawRanks } = await searchRanked(
            conn, entityType, params, batchId, dumpDate, perTypeLimit, cursorData,
          );
          allResults.push(...results);
          for (const [id, rank] of rawRanks) rawRankByKey.set(`${entityType}:${id}`, rank);
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
        ? encodeCursor(
            lastResult.discogs_id,
            rawRankByKey.get(`${lastResult.type}:${lastResult.discogs_id}`) ?? 0,
          )
        : null;

      // Pinned top-match + per-type counts. Both are best-effort and run
      // inside the same connection so they share the 3s statement_timeout.
      // Skipped when the caller asks for a specific type — the tabs already
      // give the user the type-filtered view; pinning the same entity above
      // it would be noise.
      let topMatch: SearchTopMatch | null = null;
      let typeCounts: SearchTypeCounts | undefined;
      if (params.q && params.q.length >= MIN_QUERY_LENGTH && !cursorData) {
        if (!params.type) {
          try {
            topMatch = await findTopMatch(conn, params.q, batchMap);
          } catch {
            // non-blocking
          }
        }
        try {
          typeCounts = await getTypeCounts(conn, params.q, batchMap);
        } catch {
          // non-blocking
        }
      }

      return {
        results: allResults,
        top_match: topMatch,
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
          type_counts: typeCounts,
        },
      };
    } finally {
      await sql`RESET statement_timeout`.execute(conn).catch(() => {});
    }
  });
}
