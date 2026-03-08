/**
 * Direct graph traversal — v1 scope only.
 *
 * Supported links:
 * - artist → releases (via release_artists)
 * - artist → masters (via master_artists)
 * - artist → credits (via release_credits + track_credits)
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

export async function getArtistCatalogReleases(
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

  // Query 1 — masters path (same as getArtistMasters)
  const masterRows = await db
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

  // Query 2 — release primary path (release_artists)
  const releaseRows = await db
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
      "catalog.releases.master_discogs_id",
    ])
    .select(
      sql<string[] | null>`(
        SELECT array_agg(DISTINCT d)
        FROM catalog.release_formats rf,
             unnest(rf.descriptions) AS d
        WHERE rf.release_discogs_id = catalog.releases.discogs_id
          AND rf.batch_id = ${batchId}
      )`.as("format_descriptions"),
    )
    .where("catalog.release_artists.artist_discogs_id", "=", artistDiscogsId)
    .where("catalog.release_artists.batch_id", "=", batchId)
    .limit(MASTERS_FETCH_CAP)
    .execute();

  // Merge + deduplicate: key = "m:<master_id>" or "r:<release_id>"
  type CatalogEntry = {
    key: string;
    type: "master" | "release";
    discogs_id: number;
    title: string | null;
    year: number | null;
    format_descriptions: string[] | null;
  };

  const map = new Map<string, CatalogEntry>();

  // First pass: add all masters
  for (const r of masterRows) {
    const key = `m:${r.discogs_id}`;
    map.set(key, {
      key,
      type: "master",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      format_descriptions: (r as any).format_descriptions as string[] | null,
    });
  }

  // Second pass: add release_artists rows, deduplicating against masters
  for (const r of releaseRows) {
    const masterDiscogs = (r as any).master_discogs_id as number | null;
    if (masterDiscogs != null) {
      const masterKey = `m:${masterDiscogs}`;
      if (map.has(masterKey)) {
        // Master already present — skip, master wins
        continue;
      }
      // Master referenced but not in our master_artists results —
      // represent via master key so it won't duplicate if we see it again
      map.set(masterKey, {
        key: masterKey,
        type: "master",
        discogs_id: masterDiscogs,
        title: r.title,
        year: (r as any).year as number | null,
        format_descriptions: (r as any).format_descriptions as string[] | null,
      });
    } else {
      // No master link — standalone release
      const key = `r:${r.discogs_id}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          type: "release",
          discogs_id: r.discogs_id,
          title: r.title,
          year: (r as any).year as number | null,
          format_descriptions: (r as any).format_descriptions as string[] | null,
        });
      }
    }
  }

  // Classify each entry
  const classified = Array.from(map.values()).map((entry) => {
    const { release_type, release_type_label } = classifyReleaseType(
      entry.format_descriptions ?? [],
      entry.title,
    );
    return { ...entry, release_type, release_type_label };
  });

  // Filter by release type
  const filtered = releaseType === "all"
    ? classified
    : classified.filter((r) => r.release_type === releaseType);

  // Sort by year + discogs_id
  filtered.sort((a, b) => {
    const dir = sort === "newest" ? -1 : 1;
    const ya = a.year ?? (sort === "newest" ? -Infinity : Infinity);
    const yb = b.year ?? (sort === "newest" ? -Infinity : Infinity);
    if (ya !== yb) return (ya - yb) * dir;
    return (a.discogs_id - b.discogs_id) * dir;
  });

  // Cursor paginate after sort
  let startIdx = 0;
  if (afterId !== null) {
    const cursorIdx = filtered.findIndex((r) => r.discogs_id === afterId);
    startIdx = cursorIdx >= 0 ? cursorIdx + 1 : 0;
  }

  const page = filtered.slice(startIdx, startIdx + lim);
  const hasMore = startIdx + lim < filtered.length;

  return {
    links: page.map((r) => ({
      type: r.type,
      discogs_id: r.discogs_id,
      title: r.title ?? undefined,
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
      link_type: "catalog_releases",
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
      "catalog.releases.master_discogs_id",
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
      master_discogs_id: (r as any).master_discogs_id ?? null,
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

// ─── Role-family classifier ───────────────────────────────────────────────────

export type RoleFamily = "writing" | "arranging" | "performance" | "production" | "other";

const ROLE_FAMILY_PATTERNS: Array<{ family: RoleFamily; patterns: RegExp[] }> = [
  { family: "writing",     patterns: [/writ/i, /compos/i, /lyric/i, /author/i] },
  { family: "arranging",   patterns: [/arrang/i, /orchestrat/i, /conduct/i, /direct/i] },
  { family: "performance", patterns: [/perform/i, /vocals?/i, /guitar/i, /bass/i, /drums?/i, /keys/i, /piano/i, /trumpet/i, /saxophone/i, /violin/i, /voice/i, /singer/i, /rapper/i, /dj/i, /turntabl/i, /instrum/i] },
  { family: "production",  patterns: [/produc/i, /remix/i, /mix/i, /master/i, /engineer/i, /record/i, /studio/i, /program/i] },
];

export function classifyRoleFamily(role: string | null): RoleFamily {
  if (!role) return "other";
  for (const { family, patterns } of ROLE_FAMILY_PATTERNS) {
    if (patterns.some((p) => p.test(role))) return family;
  }
  return "other";
}

// ─── Artist credits response shape ───────────────────────────────────────────

export interface ArtistCreditLink {
  release_discogs_id: number;
  title: string | null;
  year: number | null;
  country: string | null;
  roles: string[];
  role_count: number;
  credit_source: "release" | "track" | "both";
  role_family: RoleFamily;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export interface ArtistCreditsResponse {
  links: ArtistCreditLink[];
  pagination: {
    cursor: string | null;
    has_more: boolean;
    total_estimate: number | null;
  };
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    link_type: "credits";
    elapsed_ms: number;
  };
}

// ─── getArtistCredits ─────────────────────────────────────────────────────────

export async function getArtistCredits(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
  roleFamily?: RoleFamily | "all",
): Promise<ArtistCreditsResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  // Fetch release-level credits
  const releaseCreditRows = await sql<{
    release_discogs_id: number;
    role: string | null;
    title: string | null;
    year: number | null;
    country: string | null;
  }>`
    SELECT
      rc.release_discogs_id,
      rc.role,
      r.title,
      r.release_year AS year,
      r.country
    FROM catalog.release_credits rc
    LEFT JOIN catalog.releases r
      ON r.discogs_id = rc.release_discogs_id
      AND r.batch_id = ${batchId}::uuid
    WHERE rc.artist_discogs_id = ${artistDiscogsId}
      AND rc.batch_id = ${batchId}::uuid
      ${afterId !== null ? sql`AND rc.release_discogs_id > ${afterId}` : sql``}
    ORDER BY rc.release_discogs_id ASC
  `.execute(db);

  // Fetch track-level credits (join to tracks to get release_discogs_id)
  const trackCreditRows = await sql<{
    release_discogs_id: number;
    role: string | null;
    title: string | null;
    year: number | null;
    country: string | null;
  }>`
    SELECT
      t.release_discogs_id,
      tc.role,
      r.title,
      r.release_year AS year,
      r.country
    FROM catalog.track_credits tc
    JOIN catalog.tracks t
      ON t.id = tc.track_id
      AND t.batch_id = ${batchId}::uuid
    LEFT JOIN catalog.releases r
      ON r.discogs_id = t.release_discogs_id
      AND r.batch_id = ${batchId}::uuid
    WHERE tc.artist_discogs_id = ${artistDiscogsId}
      AND tc.batch_id = ${batchId}::uuid
      ${afterId !== null ? sql`AND t.release_discogs_id > ${afterId}` : sql``}
    ORDER BY t.release_discogs_id ASC
  `.execute(db);

  // Merge and group by release_discogs_id
  type MergedEntry = {
    title: string | null;
    year: number | null;
    country: string | null;
    releaseRoles: Set<string>;
    trackRoles: Set<string>;
  };

  const byRelease = new Map<number, MergedEntry>();

  for (const row of releaseCreditRows.rows) {
    if (!byRelease.has(row.release_discogs_id)) {
      byRelease.set(row.release_discogs_id, {
        title: row.title,
        year: row.year,
        country: row.country,
        releaseRoles: new Set(),
        trackRoles: new Set(),
      });
    }
    if (row.role) byRelease.get(row.release_discogs_id)!.releaseRoles.add(row.role);
  }

  for (const row of trackCreditRows.rows) {
    if (!byRelease.has(row.release_discogs_id)) {
      byRelease.set(row.release_discogs_id, {
        title: row.title,
        year: row.year,
        country: row.country,
        releaseRoles: new Set(),
        trackRoles: new Set(),
      });
    }
    if (row.role) byRelease.get(row.release_discogs_id)!.trackRoles.add(row.role);
  }

  // Build sorted link list
  let allLinks: ArtistCreditLink[] = Array.from(byRelease.entries())
    .sort(([a], [b]) => a - b)
    .map(([releaseId, entry]) => {
      const roles = Array.from(new Set([...entry.releaseRoles, ...entry.trackRoles]));
      const creditSource: "release" | "track" | "both" =
        entry.releaseRoles.size > 0 && entry.trackRoles.size > 0
          ? "both"
          : entry.releaseRoles.size > 0
          ? "release"
          : "track";
      // Dominant role family: first non-"other" wins, else "other"
      let dominantFamily: RoleFamily = "other";
      for (const r of roles) {
        const f = classifyRoleFamily(r);
        if (f !== "other") { dominantFamily = f; break; }
      }
      return {
        release_discogs_id: releaseId,
        title: entry.title,
        year: entry.year,
        country: entry.country,
        roles,
        role_count: roles.length,
        credit_source: creditSource,
        role_family: dominantFamily,
        provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: releaseId },
      };
    });

  // Apply role_family filter in JS (dataset bounded per artist)
  if (roleFamily && roleFamily !== "all") {
    allLinks = allLinks.filter((l) => l.role_family === roleFamily);
  }

  // Paginate
  const hasMore = allLinks.length > lim;
  const page = hasMore ? allLinks.slice(0, lim) : allLinks;

  return {
    links: page,
    pagination: {
      cursor: hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1].release_discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: allLinks.length,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "credits",
      elapsed_ms: Date.now() - start,
    },
  };
}
