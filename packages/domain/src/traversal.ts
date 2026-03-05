/**
 * Direct graph traversal — v1 scope only.
 *
 * Supported links:
 * - artist → releases (via release_artists)
 * - artist → masters (via master_artists)
 * - label → releases (via release_labels)
 * - master → releases (via releases.master_discogs_id)
 * - release → credits (via release_credits)
 */

import { type Kysely, sql } from "kysely";
import type { Database } from "@dig/db";

export type ReleaseType = "album" | "single_ep" | "compilation" | "other";
export type ReleaseTypeLabel = "LP" | "EP" | "Single" | "Comp" | "Other";

export interface TraversalLink {
  type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  name?: string;
  title?: string;
  year?: number | null;
  role?: string | null;
  country?: string | null;
  format?: string | null;
  release_type?: ReleaseType;
  release_type_label?: ReleaseTypeLabel;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export interface TraversalResponse {
  links: TraversalLink[];
  pagination: {
    cursor: string | null;
    has_more: boolean;
    total_estimate: number | null;
  };
  meta: {
    source_type: string;
    source_discogs_id: number;
    link_type: string;
    elapsed_ms: number;
  };
}

export interface MasterVideo {
  url: string;
  title: string | null;
  duration_seconds: number | null;
  release_discogs_id: number;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export interface MasterVideosResponse {
  videos: MasterVideo[];
  meta: {
    source_type: "master";
    source_discogs_id: number;
    elapsed_ms: number;
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MASTERS_FETCH_CAP = 500;

/** Deterministic release-type classifier from format descriptions. */
export function classifyReleaseType(
  descriptions: string[],
  title?: string | null,
): { release_type: ReleaseType; release_type_label: ReleaseTypeLabel } {
  const lower = descriptions.map((d) => d.toLowerCase());
  const titleLower = (title || "").toLowerCase();

  // Priority 1: Album / LP
  if (lower.some((d) => d === "album" || d === "lp")) {
    return { release_type: "album", release_type_label: "LP" };
  }

  // Priority 2: Single / 7"
  if (lower.some((d) => d === "single" || d === '7"')) {
    return { release_type: "single_ep", release_type_label: "Single" };
  }

  // Priority 3: EP / 12"
  if (lower.some((d) => d === "ep" || d === '12"')) {
    return { release_type: "single_ep", release_type_label: "EP" };
  }

  // Priority 4: Compilation
  if (
    lower.some((d) => d === "compilation") ||
    titleLower.includes("greatest hits") ||
    titleLower.includes("best of") ||
    titleLower.includes("anthology")
  ) {
    return { release_type: "compilation", release_type_label: "Comp" };
  }

  return { release_type: "other", release_type_label: "Other" };
}

function encodeCursor(discogsId: number): string {
  return Buffer.from(JSON.stringify({ discogs_id: discogsId })).toString("base64url");
}

function decodeCursor(cursor: string): number | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    return typeof parsed.discogs_id === "number" ? parsed.discogs_id : null;
  } catch {
    return null;
  }
}

export async function getArtistReleases(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.release_artists")
    .innerJoin("catalog.releases", (join) =>
      join
        .onRef("catalog.releases.discogs_id", "=", "catalog.release_artists.release_discogs_id")
        .on("catalog.releases.batch_id", "=", batchId),
    )
    .select([
      "catalog.releases.discogs_id",
      "catalog.releases.title",
      "catalog.releases.release_year as year",
    ])
    .where("catalog.release_artists.artist_discogs_id", "=", artistDiscogsId)
    .where("catalog.release_artists.batch_id", "=", batchId)
    .orderBy("catalog.releases.discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("catalog.releases.discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "release",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "releases",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getArtistMasters(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
  sort: "newest" | "oldest" = "newest",
  releaseType: ReleaseType | "all" = "all",
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  // Fetch all masters with aggregated format descriptions via subquery.
  // Most artists have <200 masters so fetching all is fine for classification + filtering.
  const rows = await db
    .selectFrom("catalog.master_artists")
    .innerJoin("catalog.masters", (join) =>
      join
        .onRef("catalog.masters.discogs_id", "=", "catalog.master_artists.master_discogs_id")
        .on("catalog.masters.batch_id", "=", batchId),
    )
    .select([
      "catalog.masters.discogs_id",
      "catalog.masters.title",
      "catalog.masters.year",
    ])
    .select(
      sql<string[] | null>`(
        SELECT array_agg(DISTINCT d)
        FROM catalog.release_formats rf,
             unnest(rf.descriptions) AS d
        WHERE rf.release_discogs_id = catalog.masters.main_release_discogs_id
          AND rf.batch_id = ${batchId}
      )`.as("format_descriptions"),
    )
    .where("catalog.master_artists.artist_discogs_id", "=", artistDiscogsId)
    .where("catalog.master_artists.batch_id", "=", batchId)
    .limit(MASTERS_FETCH_CAP)
    .execute();

  // Classify each master
  const classified = rows.map((r) => {
    const descs = (r as any).format_descriptions as string[] | null;
    const { release_type, release_type_label } = classifyReleaseType(descs ?? [], r.title);
    return { discogs_id: r.discogs_id, title: r.title, year: r.year, release_type, release_type_label };
  });

  // Filter by release type
  const filtered = releaseType === "all"
    ? classified
    : classified.filter((r) => r.release_type === releaseType);

  // Sort
  filtered.sort((a, b) => {
    const dir = sort === "newest" ? -1 : 1;
    const ya = a.year ?? (sort === "newest" ? -Infinity : Infinity);
    const yb = b.year ?? (sort === "newest" ? -Infinity : Infinity);
    if (ya !== yb) return (ya - yb) * dir;
    return (a.discogs_id - b.discogs_id) * dir;
  });

  // Paginate using cursor (discogs_id)
  let startIdx = 0;
  if (afterId !== null) {
    const cursorIdx = filtered.findIndex((r) => r.discogs_id === afterId);
    startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
  }

  const page = filtered.slice(startIdx, startIdx + lim);
  const hasMore = startIdx + lim < filtered.length;

  return {
    links: page.map((r) => ({
      type: "master" as const,
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      release_type: r.release_type,
      release_type_label: r.release_type_label,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: filtered.length,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "masters",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getLabelReleases(
  db: Kysely<Database>,
  labelDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.release_labels")
    .innerJoin("catalog.releases", (join) =>
      join
        .onRef("catalog.releases.discogs_id", "=", "catalog.release_labels.release_discogs_id")
        .on("catalog.releases.batch_id", "=", batchId),
    )
    .select([
      "catalog.releases.discogs_id",
      "catalog.releases.title",
      "catalog.releases.release_year as year",
    ])
    .where("catalog.release_labels.label_discogs_id", "=", labelDiscogsId)
    .where("catalog.release_labels.batch_id", "=", batchId)
    .orderBy("catalog.releases.discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("catalog.releases.discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "release",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "label",
      source_discogs_id: labelDiscogsId,
      link_type: "releases",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getMasterReleases(
  db: Kysely<Database>,
  masterDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.releases")
    .select([
      "discogs_id",
      "title",
      "release_year as year",
      "country",
    ])
    .select(
      sql<string | null>`(
        SELECT f.name FROM catalog.release_formats f
        WHERE f.release_discogs_id = catalog.releases.discogs_id
          AND f.batch_id = catalog.releases.batch_id
        ORDER BY f.position LIMIT 1
      )`.as("format"),
    )
    .where("master_discogs_id", "=", masterDiscogsId)
    .where("batch_id", "=", batchId)
    .orderBy("discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "release",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      country: (r as any).country ?? null,
      format: (r as any).format ?? null,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "master",
      source_discogs_id: masterDiscogsId,
      link_type: "releases",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getMasterVideos(
  db: Kysely<Database>,
  masterDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = 200,
): Promise<MasterVideosResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), 500);

  const rows = await db
    .selectFrom("catalog.releases as r")
    .innerJoin("catalog.release_videos as rv", (join) =>
      join
        .onRef("rv.release_discogs_id", "=", "r.discogs_id")
        .onRef("rv.batch_id", "=", "r.batch_id"),
    )
    .select([
      "rv.url",
      "rv.title",
      "rv.duration_seconds",
      "rv.release_discogs_id",
    ])
    .where("r.master_discogs_id", "=", masterDiscogsId)
    .where("r.batch_id", "=", batchId)
    .orderBy("r.is_main_release", "desc")
    .orderBy("r.release_year", "asc")
    .orderBy("r.discogs_id", "asc")
    .limit(lim)
    .execute();

  return {
    videos: rows.map((row) => ({
      url: row.url,
      title: row.title,
      duration_seconds: row.duration_seconds,
      release_discogs_id: row.release_discogs_id,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: row.release_discogs_id },
    })),
    meta: {
      source_type: "master",
      source_discogs_id: masterDiscogsId,
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getReleaseCredits(
  db: Kysely<Database>,
  releaseDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.release_credits")
    .select(["artist_discogs_id as discogs_id", "artist_name as name", "role"])
    .where("release_discogs_id", "=", releaseDiscogsId)
    .where("batch_id", "=", batchId)
    .orderBy("artist_discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("artist_discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "artist",
      discogs_id: r.discogs_id,
      name: r.name,
      role: r.role,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "release",
      source_discogs_id: releaseDiscogsId,
      link_type: "credits",
      elapsed_ms: Date.now() - start,
    },
  };
}
