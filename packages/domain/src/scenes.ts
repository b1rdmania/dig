/**
 * Curated scenes — Phase C catalog wall primitive.
 *
 * Reads from `enrich.scenes` / `enrich.scene_labels` / `enrich.scene_bridges`.
 * Joins through `enrich.label_editorial` for palette + founding metadata, and
 * through `catalog.masters` for ranked discography.
 *
 * Three public APIs:
 *
 *   - listScenes()      → cards for the /scenes index
 *   - getScene(slug)    → full scene detail incl. labels + bridges
 *   - getSceneWall(...) → hydrated catalog-wall payload (per-label release lists)
 *
 * The "wall" payload is what powers the homepage and scene pages: each member
 * label is returned with its top-N scene-weighted masters, ordered by year
 * ascending so the strip reads top-down like a discography sheet.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";

export type SceneAxis = "geography" | "sound" | "era" | "cluster" | "bridge" | "micro";
export type SceneRole = "core" | "adjacent" | "bridge";
export type BridgeKind = "artist" | "label" | "sound";

export interface ScenePalette {
  accent: string;
  accent_ink: string;
}

export interface SceneSummary {
  slug: string;
  name: string;
  city: string | null;
  era_start: number | null;
  era_end: number | null;
  axis: SceneAxis;
  parent_slug: string | null;
  depth: number;
  hero_label_id: number | null;
  blurb: string | null;
  palette: ScenePalette | null;
  label_count: number;
}

export interface SceneLabelMember {
  discogs_id: number;
  name: string;
  role: SceneRole;
  rank: number;
  palette: ScenePalette | null;
  founded_year: number | null;
  closed_year: number | null;
  is_active: boolean;
  location: string | null;
  master_count: number;
}

export interface SceneBridgeLink {
  from_slug: string;
  to_slug: string;
  via_kind: BridgeKind;
  via_id: number | null;
  via_name: string | null;
  blurb: string | null;
}

export interface SceneDetail extends SceneSummary {
  labels: SceneLabelMember[];
  bridges_out: SceneBridgeLink[];
  bridges_in: SceneBridgeLink[];
}

export interface WallStripRelease {
  master_discogs_id: number;
  title: string;
  primary_artist_name: string | null;
  year: number | null;
  scene_weight: number;
}

export interface WallStripLabel extends SceneLabelMember {
  era: { start: number | null; end: number | null };
  total_masters: number;
  releases: WallStripRelease[];
}

export interface SceneWall extends SceneSummary {
  labels: WallStripLabel[];
  density: "compact" | "medium" | "full";
  per_label_cap: number;
}

const PER_LABEL_DEFAULTS: Record<"compact" | "medium" | "full", number> = {
  compact: 12,
  medium: 25,
  full: 200,
};

// ---------------------------------------------------------------------------
// listScenes — index cards
// ---------------------------------------------------------------------------

export async function listScenes(
  db: Kysely<Database>,
  batchId: string,
): Promise<SceneSummary[]> {
  const rows = await sql<{
    slug: string;
    name: string;
    city: string | null;
    era_start: number | null;
    era_end: number | null;
    axis: SceneAxis;
    parent_slug: string | null;
    depth: number;
    hero_label_id: number | null;
    blurb: string | null;
    palette: ScenePalette | null;
    hero_palette: ScenePalette | null;
    label_count: string;
  }>`
    SELECT
      s.slug,
      s.name,
      s.city,
      s.era_start,
      s.era_end,
      s.axis,
      s.parent_slug,
      s.depth,
      s.hero_label_id,
      s.blurb,
      s.palette,
      le.palette AS hero_palette,
      (SELECT COUNT(*) FROM enrich.scene_labels sl WHERE sl.scene_slug = s.slug) AS label_count
    FROM enrich.scenes s
    LEFT JOIN enrich.label_editorial le ON le.discogs_label_id = s.hero_label_id
    ORDER BY
      CASE s.axis
        WHEN 'geography' THEN 0
        WHEN 'cluster'   THEN 1
        WHEN 'sound'     THEN 2
        WHEN 'era'       THEN 3
        WHEN 'bridge'    THEN 4
        ELSE 5
      END,
      s.era_start ASC NULLS LAST,
      s.name ASC
  `.execute(db);

  // batchId reserved for future use (e.g. excluding scenes whose labels are
  // entirely out-of-batch); currently scenes are batch-agnostic.
  void batchId;

  return rows.rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    city: r.city,
    era_start: r.era_start,
    era_end: r.era_end,
    axis: r.axis,
    parent_slug: r.parent_slug,
    depth: r.depth,
    hero_label_id: r.hero_label_id,
    blurb: r.blurb,
    palette: r.palette ?? r.hero_palette ?? null,
    label_count: parseInt(r.label_count, 10),
  }));
}

// ---------------------------------------------------------------------------
// getScene — single scene + labels + bridges
// ---------------------------------------------------------------------------

export async function getScene(
  db: Kysely<Database>,
  slug: string,
  batchId: string,
): Promise<SceneDetail | null> {
  const sceneRow = await sql<{
    slug: string;
    name: string;
    city: string | null;
    era_start: number | null;
    era_end: number | null;
    axis: SceneAxis;
    parent_slug: string | null;
    depth: number;
    hero_label_id: number | null;
    blurb: string | null;
    palette: ScenePalette | null;
    hero_palette: ScenePalette | null;
  }>`
    SELECT
      s.slug, s.name, s.city, s.era_start, s.era_end, s.axis,
      s.parent_slug, s.depth, s.hero_label_id, s.blurb, s.palette,
      le.palette AS hero_palette
    FROM enrich.scenes s
    LEFT JOIN enrich.label_editorial le ON le.discogs_label_id = s.hero_label_id
    WHERE s.slug = ${slug}
  `.execute(db);
  if (sceneRow.rows.length === 0) return null;
  const s = sceneRow.rows[0];

  const [labels, bridgesOut, bridgesIn] = await Promise.all([
    fetchSceneLabels(db, slug, batchId),
    fetchBridges(db, slug, "out"),
    fetchBridges(db, slug, "in"),
  ]);

  return {
    slug: s.slug,
    name: s.name,
    city: s.city,
    era_start: s.era_start,
    era_end: s.era_end,
    axis: s.axis,
    parent_slug: s.parent_slug,
    depth: s.depth,
    hero_label_id: s.hero_label_id,
    blurb: s.blurb,
    palette: s.palette ?? s.hero_palette ?? null,
    label_count: labels.length,
    labels,
    bridges_out: bridgesOut,
    bridges_in: bridgesIn,
  };
}

async function fetchSceneLabels(
  db: Kysely<Database>,
  sceneSlug: string,
  batchId: string,
): Promise<SceneLabelMember[]> {
  const rows = await sql<{
    discogs_id: number;
    name: string;
    role: SceneRole;
    rank: number;
    palette: ScenePalette | null;
    founded_year: number | null;
    closed_year: number | null;
    is_active: boolean;
    location: string | null;
    master_count: string;
  }>`
    SELECT
      l.discogs_id,
      l.name,
      sl.role,
      sl.rank,
      le.palette,
      le.founded_year,
      le.closed_year,
      COALESCE(le.is_active, TRUE) AS is_active,
      le.location,
      (
        SELECT COUNT(*)
        FROM catalog.masters m
        WHERE m.primary_label_discogs_id = l.discogs_id
          AND m.batch_id = ${batchId}
      ) AS master_count
    FROM enrich.scene_labels sl
    JOIN catalog.labels l ON l.discogs_id = sl.discogs_label_id
                          AND l.batch_id = ${batchId}
    LEFT JOIN enrich.label_editorial le ON le.discogs_label_id = sl.discogs_label_id
    WHERE sl.scene_slug = ${sceneSlug}
    ORDER BY sl.rank ASC, l.name ASC
  `.execute(db);

  return rows.rows.map((r) => ({
    discogs_id: r.discogs_id,
    name: r.name,
    role: r.role,
    rank: r.rank,
    palette: r.palette,
    founded_year: r.founded_year,
    closed_year: r.closed_year,
    is_active: r.is_active,
    location: r.location,
    master_count: parseInt(r.master_count, 10),
  }));
}

async function fetchBridges(
  db: Kysely<Database>,
  slug: string,
  direction: "in" | "out",
): Promise<SceneBridgeLink[]> {
  const rows =
    direction === "out"
      ? await sql<{
          from_slug: string;
          to_slug: string;
          via_kind: BridgeKind;
          via_id: number | null;
          via_name: string | null;
          blurb: string | null;
        }>`
          SELECT from_slug, to_slug, via_kind, via_id, via_name, blurb
          FROM enrich.scene_bridges
          WHERE from_slug = ${slug}
          ORDER BY to_slug ASC, via_kind ASC, via_name ASC
        `.execute(db)
      : await sql<{
          from_slug: string;
          to_slug: string;
          via_kind: BridgeKind;
          via_id: number | null;
          via_name: string | null;
          blurb: string | null;
        }>`
          SELECT from_slug, to_slug, via_kind, via_id, via_name, blurb
          FROM enrich.scene_bridges
          WHERE to_slug = ${slug}
          ORDER BY from_slug ASC, via_kind ASC, via_name ASC
        `.execute(db);
  return rows.rows;
}

// ---------------------------------------------------------------------------
// getSceneWall — the hydrated catalog wall payload
// ---------------------------------------------------------------------------

export async function getSceneWall(
  db: Kysely<Database>,
  slug: string,
  batchId: string,
  opts: { density?: "compact" | "medium" | "full"; perLabel?: number } = {},
): Promise<SceneWall | null> {
  const scene = await getScene(db, slug, batchId);
  if (!scene) return null;

  const density = opts.density ?? "compact";
  const perLabel = opts.perLabel ?? PER_LABEL_DEFAULTS[density];

  const labelIds = scene.labels.map((l) => l.discogs_id);
  if (labelIds.length === 0) {
    return {
      ...scene,
      density,
      per_label_cap: perLabel,
      labels: [],
    };
  }

  // Pull top-N masters per label using a window function. Ranked by
  // scene_weight DESC then year ASC (so the most-essential, then the
  // earliest tie-breaks). Capped per-label.
  const masters = await sql<{
    primary_label_discogs_id: number;
    discogs_id: number;
    title: string;
    primary_artist_name: string | null;
    year: number | null;
    scene_weight: number;
    rn: string;
  }>`
    WITH ranked AS (
      SELECT
        m.primary_label_discogs_id,
        m.discogs_id,
        m.title,
        m.primary_artist_name,
        m.year,
        m.scene_weight,
        ROW_NUMBER() OVER (
          PARTITION BY m.primary_label_discogs_id
          ORDER BY m.scene_weight DESC, m.year ASC NULLS LAST, m.discogs_id ASC
        ) AS rn
      FROM catalog.masters m
      WHERE m.primary_label_discogs_id = ANY(${labelIds}::int[])
        AND m.batch_id = ${batchId}
        AND (m.year IS NULL OR (m.year >= ${scene.era_start ?? 0} AND m.year <= ${scene.era_end ?? 9999}))
    )
    SELECT
      primary_label_discogs_id,
      discogs_id,
      title,
      primary_artist_name,
      year,
      scene_weight,
      rn::text
    FROM ranked
    WHERE rn <= ${perLabel}
    ORDER BY primary_label_discogs_id ASC, year ASC NULLS LAST, discogs_id ASC
  `.execute(db);

  const byLabel = new Map<number, WallStripRelease[]>();
  const eraByLabel = new Map<number, { start: number | null; end: number | null }>();
  for (const m of masters.rows) {
    const arr = byLabel.get(m.primary_label_discogs_id) ?? [];
    arr.push({
      master_discogs_id: m.discogs_id,
      title: m.title,
      primary_artist_name: m.primary_artist_name,
      year: m.year,
      scene_weight: m.scene_weight,
    });
    byLabel.set(m.primary_label_discogs_id, arr);

    if (m.year != null) {
      const cur = eraByLabel.get(m.primary_label_discogs_id) ?? { start: null, end: null };
      cur.start = cur.start == null ? m.year : Math.min(cur.start, m.year);
      cur.end = cur.end == null ? m.year : Math.max(cur.end, m.year);
      eraByLabel.set(m.primary_label_discogs_id, cur);
    }
  }

  const wallLabels: WallStripLabel[] = scene.labels.map((l) => ({
    ...l,
    era: eraByLabel.get(l.discogs_id) ?? { start: null, end: null },
    total_masters: l.master_count,
    releases: byLabel.get(l.discogs_id) ?? [],
  }));

  return {
    ...scene,
    density,
    per_label_cap: perLabel,
    labels: wallLabels,
  };
}

// ---------------------------------------------------------------------------
// getScenePlaylist — the scene as one pressed-play playlist
// ---------------------------------------------------------------------------

export interface ScenePlaylistRecord {
  master_discogs_id: number;
  title: string;
  primary_artist_name: string | null;
  year: number | null;
  video_id: string;
}

export interface ScenePlaylist {
  slug: string;
  name: string;
  video_count: number;
  /** YouTube anonymous playlist over every record's first video. */
  playlist_url: string | null;
  records: ScenePlaylistRecord[];
}

export const YOUTUBE_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

/**
 * Top scene-weighted masters across the scene's member labels, each paired
 * with its first YouTube video. Per-label capped so one prolific label can't
 * own the playlist, globally capped at `cap` (YouTube's anonymous
 * watch_videos playlists silently truncate around 50 entries).
 *
 * Clamped to the scene's era bounds, and unlike the wall a known in-era
 * year is required — a tier-1 label's back catalog (West End's disco
 * years) must not front a scene billed 1988-2008.
 */
export async function getScenePlaylist(
  db: Kysely<Database>,
  slug: string,
  batchId: string,
  opts: { cap?: number; perLabel?: number } = {},
): Promise<ScenePlaylist | null> {
  const scene = await getScene(db, slug, batchId);
  if (!scene) return null;

  const cap = opts.cap ?? 50;
  const perLabel = opts.perLabel ?? 8;
  const labelIds = scene.labels.map((l) => l.discogs_id);
  if (labelIds.length === 0) {
    return { slug: scene.slug, name: scene.name, video_count: 0, playlist_url: null, records: [] };
  }

  const rows = await sql<{
    discogs_id: number;
    title: string;
    primary_artist_name: string | null;
    year: number | null;
    url: string;
  }>`
    WITH ranked AS (
      SELECT
        m.discogs_id,
        m.title,
        m.primary_artist_name,
        m.year,
        m.scene_weight,
        ROW_NUMBER() OVER (
          PARTITION BY m.primary_label_discogs_id
          ORDER BY m.scene_weight DESC, m.year ASC NULLS LAST, m.discogs_id ASC
        ) AS rn
      FROM catalog.masters m
      WHERE m.primary_label_discogs_id = ANY(${labelIds}::int[])
        AND m.batch_id = ${batchId}
        AND m.year >= ${scene.era_start ?? 0} AND m.year <= ${scene.era_end ?? 9999}
    ),
    vids AS (
      SELECT DISTINCT ON (v.master_discogs_id)
        v.master_discogs_id,
        v.url
      FROM catalog.master_videos_unified v
      WHERE v.master_discogs_id IN (SELECT discogs_id FROM ranked WHERE rn <= ${perLabel})
        AND (v.url LIKE '%youtube.com%' OR v.url LIKE '%youtu.be%')
      ORDER BY v.master_discogs_id, v.id ASC
    )
    SELECT r.discogs_id, r.title, r.primary_artist_name, r.year, v.url
    FROM ranked r
    JOIN vids v ON v.master_discogs_id = r.discogs_id
    WHERE r.rn <= ${perLabel}
    ORDER BY r.scene_weight DESC, r.year ASC NULLS LAST, r.discogs_id ASC
    LIMIT ${cap}
  `.execute(db);

  const records: ScenePlaylistRecord[] = [];
  for (const r of rows.rows) {
    const m = YOUTUBE_ID_RE.exec(r.url);
    if (!m) continue;
    records.push({
      master_discogs_id: r.discogs_id,
      title: r.title,
      primary_artist_name: r.primary_artist_name,
      year: r.year,
      video_id: m[1],
    });
  }

  const playlistUrl =
    records.length > 0
      ? `https://www.youtube.com/watch_videos?video_ids=${records.map((r) => r.video_id).join(",")}`
      : null;

  return {
    slug: scene.slug,
    name: scene.name,
    video_count: records.length,
    playlist_url: playlistUrl,
    records,
  };
}
