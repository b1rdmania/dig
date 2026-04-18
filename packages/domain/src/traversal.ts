/**
 * Direct graph traversal — slim master-first shape.
 *
 * Supported in dig-db-scene:
 *   - artist  → masters       (catalog.master_artists)
 *   - label   → masters       (catalog.masters.primary_label_discogs_id)
 *   - master  → releases      (catalog.release_shadow — "Notable Versions")
 *   - master  → videos        (catalog.master_videos_unified)
 *
 * Deprecated (returns empty + degraded shape) — release-level data has
 * been removed from the slim DB:
 *   - artist  → releases       (no catalog.releases / release_artists)
 *   - artist  → catalog_releases (replaced by artist → masters)
 *   - artist  → credits        (no release_credits / track_credits)
 *   - label   → releases       (replaced by label → masters via primary_label)
 *   - release → credits        (no release_credits)
 *
 * The deprecated functions are retained as exports so that the API/MCP
 * layer continues to typecheck during the cutover; phase4-api/mcp will
 * remove these endpoints entirely (returning 410 Gone).
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
  /** Optional editorial signal — populated for master links from dig-db-scene */
  scene_weight?: number;
  /** Set on Notable Versions (master_releases) — flags the canonical pressing */
  is_main_release?: boolean;
  /**
   * Back-pointer for release links so callers can route to /master/:master_id.
   * For type="master" links this mirrors `discogs_id` so callers can rely on
   * `link.master_discogs_id` regardless of link kind without a fallback.
   */
  master_discogs_id?: number | null;
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
    degraded?: boolean;
    degraded_reason?: string;
  };
}

export interface MasterVideo {
  url: string;
  title: string | null;
  duration_seconds: number | null;
  release_discogs_id: number;
  source_type: "master" | "release";
  discogs_release_url: string | null;
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

/**
 * Deterministic release-type classifier from a primary format string.
 * The slim shape stores `primary_format` as a single text value rather
 * than a list of descriptions — we still match against the same vocabulary.
 */
export function classifyReleaseType(
  formatHints: string[],
  title?: string | null,
): { release_type: ReleaseType; release_type_label: ReleaseTypeLabel } {
  const lower = formatHints.map((d) => d.toLowerCase());
  const titleLower = (title || "").toLowerCase();

  if (lower.some((d) => d === "album" || d === "lp" || d.includes("album"))) {
    return { release_type: "album", release_type_label: "LP" };
  }
  if (lower.some((d) => d === "single" || d === '7"' || d.includes("single"))) {
    return { release_type: "single_ep", release_type_label: "Single" };
  }
  if (lower.some((d) => d === "ep" || d === '12"' || d.includes("ep") || d.includes('12"'))) {
    return { release_type: "single_ep", release_type_label: "EP" };
  }
  if (
    lower.some((d) => d === "compilation" || d.includes("comp")) ||
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

// ─── Deprecated: artist → releases ───────────────────────────────────────────

/** @deprecated Slim shape carries no release-level data. Use getArtistMasters. */
export async function getArtistReleases(
  _db: Kysely<Database>,
  artistDiscogsId: number,
  _batchId: string,
  _dumpDate: string,
  _limit = DEFAULT_LIMIT,
  _cursor?: string,
): Promise<TraversalResponse> {
  return {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: 0 },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "releases",
      elapsed_ms: 0,
      degraded: true,
      degraded_reason: "release_traversal_disabled",
    },
  };
}

// ─── Active: artist → masters ───────────────────────────────────────────────

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

  // Read denormed primary_format directly from masters — no join to dropped
  // release_formats. Most artists have <200 masters → fetch all then sort.
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
      "catalog.masters.primary_format",
      "catalog.masters.scene_weight",
    ])
    .where("catalog.master_artists.artist_discogs_id", "=", artistDiscogsId)
    .where("catalog.master_artists.batch_id", "=", batchId)
    .limit(MASTERS_FETCH_CAP)
    .execute();

  const classified = rows.map((r) => {
    const fmt = r.primary_format ? [r.primary_format] : [];
    const { release_type, release_type_label } = classifyReleaseType(fmt, r.title);
    return {
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      scene_weight: r.scene_weight,
      release_type,
      release_type_label,
    };
  });

  const filtered = releaseType === "all"
    ? classified
    : classified.filter((r) => r.release_type === releaseType);

  filtered.sort((a, b) => {
    const dir = sort === "newest" ? -1 : 1;
    const ya = a.year ?? (sort === "newest" ? -Infinity : Infinity);
    const yb = b.year ?? (sort === "newest" ? -Infinity : Infinity);
    if (ya !== yb) return (ya - yb) * dir;
    return (a.discogs_id - b.discogs_id) * dir;
  });

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
      master_discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      release_type: r.release_type,
      release_type_label: r.release_type_label,
      scene_weight: r.scene_weight,
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

/**
 * Slim shim for the legacy "catalog releases" endpoint that previously
 * merged masters + standalone releases. In the slim shape there are no
 * standalone releases → this is just `getArtistMasters` under a different name.
 */
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
  const r = await getArtistMasters(db, artistDiscogsId, batchId, dumpDate, limit, cursor, sort, releaseType);
  return { ...r, meta: { ...r.meta, link_type: "catalog_releases" } };
}

// ─── Active: label → masters ────────────────────────────────────────────────

/**
 * Returns the masters released on a given label.
 *
 * `sort` modes:
 *   - "id" (default, stable cursor) — by discogs_id ASC. Used by the legacy
 *     /v1/labels/:id/releases endpoint and the master page's label badge.
 *   - "chronological" — by year ASC, discogs_id ASC. Powers the redesigned
 *     label-page catalog spine. When set, also LEFT JOINs release_shadow on
 *     the main pressing to surface the catalog number (RS 91040, etc).
 *
 * Replaces the old release-level traversal which was the only way to find a
 * label's catalog in the full-catalog shape.
 */
export interface LabelMasterLink extends TraversalLink {
  /** Catalog number from the main pressing — only populated for sort=chronological. */
  catalog_number?: string | null;
  /** Primary artist credit text — only populated for sort=chronological. */
  primary_artist?: string | null;
}

export async function getLabelReleases(
  db: Kysely<Database>,
  labelDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
  sort: "id" | "chronological" = "id",
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  if (sort === "chronological") {
    // Year-sorted catalog spine. We fetch up to MAX_LIMIT + 1 in one shot,
    // then slice in JS — chronological cursor pagination over (year,
    // discogs_id) gets ugly with NULLs and isn't worth the complexity for
    // labels with <= 200 in-scope masters (the cap below).
    const rows = await db
      .selectFrom("catalog.masters")
      .leftJoin("catalog.release_shadow", (join) =>
        join
          .onRef("catalog.release_shadow.master_discogs_id", "=", "catalog.masters.discogs_id")
          .on("catalog.release_shadow.is_main_release", "=", true),
      )
      .select([
        "catalog.masters.discogs_id",
        "catalog.masters.title",
        "catalog.masters.year",
        "catalog.masters.primary_country as country",
        "catalog.masters.primary_format as format",
        "catalog.masters.scene_weight",
        "catalog.masters.primary_artist_name as primary_artist",
        // catalog.release_shadow doesn't currently store catalog_number on
        // dig-db-scene (the slim shape dropped catalog.release_labels).
        // Surface it as null for now; if/when we backfill release_shadow
        // with catalog numbers this returns it for free.
        sql<string | null>`NULL`.as("catalog_number"),
      ])
      .where("catalog.masters.primary_label_discogs_id", "=", labelDiscogsId)
      .where("catalog.masters.batch_id", "=", batchId)
      .orderBy("catalog.masters.year", "asc")
      .orderBy("catalog.masters.discogs_id", "asc")
      .limit(lim)
      .execute();

    return {
      links: rows.map<LabelMasterLink>((r) => ({
        type: "master",
        discogs_id: r.discogs_id,
        master_discogs_id: r.discogs_id,
        title: r.title ?? undefined,
        year: r.year,
        country: r.country,
        format: r.format,
        scene_weight: r.scene_weight,
        catalog_number: r.catalog_number,
        primary_artist: r.primary_artist,
        provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
      })),
      pagination: {
        cursor: null,
        has_more: rows.length === lim,
        total_estimate: null,
      },
      meta: {
        source_type: "label",
        source_discogs_id: labelDiscogsId,
        link_type: "spine",
        elapsed_ms: Date.now() - start,
      },
    };
  }

  let query = db
    .selectFrom("catalog.masters")
    .select([
      "discogs_id",
      "title",
      "year",
      "primary_country as country",
      "primary_format as format",
      "scene_weight",
    ])
    .where("primary_label_discogs_id", "=", labelDiscogsId)
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
      type: "master" as const,
      discogs_id: r.discogs_id,
      master_discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      country: r.country,
      format: r.format,
      scene_weight: r.scene_weight,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: r.discogs_id },
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
      // Kept as "releases" for API contract continuity; the linked entities
      // are masters, but the endpoint name in the legacy API is /releases.
      link_type: "releases",
      elapsed_ms: Date.now() - start,
    },
  };
}

// ─── Active: label → roster (top artists by master count) ───────────────────

export interface LabelRosterEntry {
  artist_discogs_id: number;
  name: string;
  master_count: number;
  first_year: number | null;
  last_year: number | null;
}

export interface LabelRosterResponse {
  roster: LabelRosterEntry[];
  meta: {
    source_type: "label";
    source_discogs_id: number;
    link_type: "roster";
    elapsed_ms: number;
    total_artists: number;
  };
}

/**
 * Returns the top-N artists who appear on a label, ranked by # of in-scope
 * masters released on that label. Powers the redesigned label-page roster
 * column. Joins `catalog.master_artists` to `catalog.masters` filtered by
 * `primary_label_discogs_id`, then to `catalog.artists` for the name.
 */
export async function getLabelRoster(
  db: Kysely<Database>,
  labelDiscogsId: number,
  batchId: string,
  limit = 20,
): Promise<LabelRosterResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), 100);

  const rows = await sql<{
    artist_discogs_id: number;
    name: string;
    master_count: string;
    first_year: number | null;
    last_year: number | null;
  }>`
    SELECT
      ma.artist_discogs_id,
      a.name,
      COUNT(*)::text   AS master_count,
      MIN(m.year)      AS first_year,
      MAX(m.year)      AS last_year
    FROM catalog.master_artists ma
    JOIN catalog.masters m
      ON m.discogs_id = ma.master_discogs_id
     AND m.batch_id   = ma.batch_id
    JOIN catalog.artists a
      ON a.discogs_id = ma.artist_discogs_id
     AND a.batch_id   = ma.batch_id
    WHERE m.primary_label_discogs_id = ${labelDiscogsId}
      AND m.batch_id = ${batchId}
    GROUP BY ma.artist_discogs_id, a.name
    ORDER BY COUNT(*) DESC, MIN(m.year) ASC, a.name ASC
    LIMIT ${lim + 1}
  `.execute(db);

  const hasMore = rows.rows.length > lim;
  const top = hasMore ? rows.rows.slice(0, lim) : rows.rows;

  return {
    roster: top.map((r) => ({
      artist_discogs_id: r.artist_discogs_id,
      name: r.name,
      master_count: parseInt(r.master_count, 10),
      first_year: r.first_year,
      last_year: r.last_year,
    })),
    meta: {
      source_type: "label",
      source_discogs_id: labelDiscogsId,
      link_type: "roster",
      elapsed_ms: Date.now() - start,
      total_artists: hasMore ? -1 : top.length,
    },
  };
}

// ─── Active: label → style breakdown (genre profile) ───────────────────────

export interface LabelStyleEntry {
  /** Style name (e.g. "Detroit Techno", "Acid House"). */
  style: string;
  /** Number of in-scope masters tagged with this style under this label. */
  master_count: number;
  /** Share of the label's total tagged masters (0–1, rounded to 4dp). */
  share: number;
}

export interface LabelStylesResponse {
  styles: LabelStyleEntry[];
  meta: {
    source_type: "label";
    source_discogs_id: number;
    link_type: "styles";
    /** Sum of master_count across all styles in the response. */
    total_tagged_masters: number;
    elapsed_ms: number;
  };
}

/**
 * Returns the top-N styles for a label by master count, with the share of
 * total tagged masters. Drives the genre-breakdown ASCII bar on the label
 * page. `styles` are unnested from the `catalog.masters.styles TEXT[]`
 * column — no join needed.
 *
 * Note: `share` is computed against the label's *tagged* masters only —
 * if the label has 100 masters but only 60 carry style tags, a style with
 * 30 hits reports 30/60 = 0.5, not 30/100. This matches user mental model
 * ("most of what's tagged is house") more closely than a raw release share.
 */
export async function getLabelStyles(
  db: Kysely<Database>,
  labelDiscogsId: number,
  batchId: string,
  limit = 8,
): Promise<LabelStylesResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), 30);

  const rows = await sql<{
    style: string;
    master_count: string;
  }>`
    WITH per_master AS (
      SELECT m.discogs_id, unnest(m.styles) AS style
      FROM catalog.masters m
      WHERE m.primary_label_discogs_id = ${labelDiscogsId}
        AND m.batch_id = ${batchId}
        AND cardinality(m.styles) > 0
    )
    SELECT style, COUNT(*)::text AS master_count
    FROM per_master
    GROUP BY style
    ORDER BY COUNT(*) DESC, style ASC
    LIMIT ${lim}
  `.execute(db);

  const totalRows = await sql<{ n: string }>`
    SELECT COUNT(DISTINCT m.discogs_id)::text AS n
    FROM catalog.masters m
    WHERE m.primary_label_discogs_id = ${labelDiscogsId}
      AND m.batch_id = ${batchId}
      AND cardinality(m.styles) > 0
  `.execute(db);

  const totalTagged = parseInt(totalRows.rows[0]?.n ?? "0", 10);

  return {
    styles: rows.rows.map((r) => {
      const n = parseInt(r.master_count, 10);
      return {
        style: r.style,
        master_count: n,
        share: totalTagged > 0 ? Math.round((n / totalTagged) * 10000) / 10000 : 0,
      };
    }),
    meta: {
      source_type: "label",
      source_discogs_id: labelDiscogsId,
      link_type: "styles",
      total_tagged_masters: totalTagged,
      elapsed_ms: Date.now() - start,
    },
  };
}

// ─── Active: artist → primary labels (for "Labelmates" derivation) ─────────

export interface ArtistPrimaryLabelEntry {
  /** Discogs label ID. */
  discogs_label_id: number;
  /** Display name (denormed from catalog.masters.primary_label_name). */
  name: string;
  /** Number of in-scope masters by this artist on this label. */
  master_count: number;
}

/**
 * Returns the labels an artist has the most in-scope masters on, ordered
 * descending by master count. Used to derive the "primary label" for the
 * Labelmates surface on the artist page (we take the top result and call
 * `getLabelRoster` on it, excluding the source artist).
 *
 * Important: `catalog.master_artists` carries every artist credit per
 * master; we DISTINCT-COUNT by `m.discogs_id` so a credit on a 3-artist
 * collab still only counts as one master for each artist.
 */
export async function getArtistPrimaryLabels(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  limit = 5,
): Promise<ArtistPrimaryLabelEntry[]> {
  const lim = Math.min(Math.max(limit, 1), 20);

  const rows = await sql<{
    discogs_label_id: number;
    name: string;
    master_count: string;
  }>`
    SELECT
      m.primary_label_discogs_id AS discogs_label_id,
      m.primary_label_name       AS name,
      COUNT(DISTINCT m.discogs_id)::text AS master_count
    FROM catalog.master_artists ma
    JOIN catalog.masters m
      ON m.discogs_id = ma.master_discogs_id
     AND m.batch_id   = ma.batch_id
    WHERE ma.artist_discogs_id = ${artistDiscogsId}
      AND ma.batch_id          = ${batchId}
      AND m.primary_label_discogs_id IS NOT NULL
      AND m.primary_label_name       IS NOT NULL
    GROUP BY m.primary_label_discogs_id, m.primary_label_name
    ORDER BY COUNT(DISTINCT m.discogs_id) DESC, m.primary_label_name ASC
    LIMIT ${lim}
  `.execute(db);

  return rows.rows.map((r) => ({
    discogs_label_id: r.discogs_label_id,
    name: r.name,
    master_count: parseInt(r.master_count, 10),
  }));
}

// ─── Active: master → releases (Notable Versions) ───────────────────────────

/**
 * Returns the alternate releases of a master from `catalog.release_shadow`.
 * This is the "Notable Versions" surface on the slim master page — minimal
 * metadata, no rich detail page.
 *
 * Ordering: main release first, then by year ascending, then discogs_id.
 * `_batchId` is accepted for API parity but ignored (release_shadow is built
 * once per scope and doesn't carry batch_id).
 */
export async function getMasterReleases(
  db: Kysely<Database>,
  masterDiscogsId: number,
  _batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.release_shadow")
    .select([
      "release_discogs_id as discogs_id",
      "title",
      "release_year as year",
      "country",
      "format",
      "is_main_release",
    ])
    .where("master_discogs_id", "=", masterDiscogsId)
    .orderBy("is_main_release", "desc")
    .orderBy("release_year", "asc")
    .orderBy("release_discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("release_discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "release" as const,
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      country: r.country,
      format: r.format,
      is_main_release: r.is_main_release,
      master_discogs_id: masterDiscogsId,
      provenance: { source: "discogs" as const, dump_date: dumpDate, discogs_id: r.discogs_id },
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

// ─── Active: master → videos ────────────────────────────────────────────────

/**
 * Returns the unified video feed for a master from
 * `catalog.master_videos_unified`. Built once at scope-build time from
 * master + release videos with deduplication by URL.
 */
export async function getMasterVideos(
  db: Kysely<Database>,
  masterDiscogsId: number,
  _batchId: string,
  dumpDate: string,
  limit = 200,
): Promise<MasterVideosResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), 500);

  const rows = await db
    .selectFrom("catalog.master_videos_unified")
    .select([
      "url",
      "title",
      "duration_seconds",
      "source_type",
      "source_release_discogs_id",
      "discogs_release_url",
    ])
    .where("master_discogs_id", "=", masterDiscogsId)
    // Master-sourced videos first, then release-sourced
    .orderBy("source_type", "asc")
    .orderBy("id", "asc")
    .limit(lim)
    .execute();

  return {
    videos: rows.map((row) => ({
      url: row.url,
      title: row.title,
      duration_seconds: row.duration_seconds,
      release_discogs_id: row.source_release_discogs_id ?? masterDiscogsId,
      source_type: row.source_type as "master" | "release",
      discogs_release_url: row.discogs_release_url,
      provenance: {
        source: "discogs",
        dump_date: dumpDate,
        discogs_id: row.source_release_discogs_id ?? masterDiscogsId,
      },
    })),
    meta: {
      source_type: "master",
      source_discogs_id: masterDiscogsId,
      elapsed_ms: Date.now() - start,
    },
  };
}

// ─── Deprecated: release → credits ──────────────────────────────────────────

/** @deprecated Slim shape carries no release_credits. */
export async function getReleaseCredits(
  _db: Kysely<Database>,
  releaseDiscogsId: number,
  _batchId: string,
  _dumpDate: string,
  _limit = DEFAULT_LIMIT,
  _cursor?: string,
): Promise<TraversalResponse> {
  return {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: 0 },
    meta: {
      source_type: "release",
      source_discogs_id: releaseDiscogsId,
      link_type: "credits",
      elapsed_ms: 0,
      degraded: true,
      degraded_reason: "release_traversal_disabled",
    },
  };
}

// ─── Role-family classifier (kept as a pure helper) ─────────────────────────

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

// ─── Deprecated: artist → credits ───────────────────────────────────────────

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
    degraded?: boolean;
    degraded_reason?: string;
  };
}

/** @deprecated Slim shape carries no release_credits / track_credits. */
export async function getArtistCredits(
  _db: Kysely<Database>,
  artistDiscogsId: number,
  _batchId: string,
  _dumpDate: string,
  _limit = DEFAULT_LIMIT,
  _cursor?: string,
  _roleFamily?: RoleFamily | "all",
): Promise<ArtistCreditsResponse> {
  // Reference sql to keep it as an explicit dependency for the file even
  // though we no longer issue a query — preserves grep-discoverability when
  // re-introducing a credits surface in a future enrichment pass.
  void sql;
  return {
    links: [],
    pagination: { cursor: null, has_more: false, total_estimate: 0 },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "credits",
      elapsed_ms: 0,
      degraded: true,
      degraded_reason: "credits_traversal_disabled",
    },
  };
}
