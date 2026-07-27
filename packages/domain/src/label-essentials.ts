import { sql, type Kysely } from "kysely";
import type { Database, LabelRelatedDirection } from "@dig/db";
import { YOUTUBE_ID_RE } from "./scenes.js";

export type RelatedDirection = LabelRelatedDirection;

export interface CoreRunMaster {
  master_discogs_id: number;
  rank: number;
  source: "auto" | "curated";
  note: string | null;
  // Joined from catalog.masters at query time so the API can render a card
  // with no further round-trips.
  title: string;
  year: number | null;
  primary_artist_name: string | null;
  primary_artist_discogs_id: number | null;
  scene_weight: number | null;
}

export interface RelatedLabel {
  to_label_id: number;
  to_label_name: string;
  direction: RelatedDirection;
  rank: number;
  blurb: string | null;
  // Helpful badges for the UI without an extra query.
  to_label_master_count: number;
  // Optional palette so the related card can pick up the scene-accent colour.
  palette: { accent: string; accent_ink: string } | null;
}

/**
 * Return the curated + auto core run for a label, ordered curated-first then
 * by rank ascending. Capped at 25 (matches the table CHECK constraint).
 *
 * Joins catalog.masters so the API response is self-contained.
 */
export async function getLabelCoreRun(
  db: Kysely<Database>,
  labelId: number,
  limit: number = 10,
): Promise<CoreRunMaster[]> {
  const cap = Math.max(1, Math.min(25, limit));
  const rows = await sql<{
    master_discogs_id: string;
    rank: number;
    source: "auto" | "curated";
    note: string | null;
    title: string;
    year: number | null;
    primary_artist_name: string | null;
    primary_artist_discogs_id: number | null;
    scene_weight: number | null;
  }>`
    SELECT
      cr.master_discogs_id::text AS master_discogs_id,
      cr.rank,
      cr.source,
      cr.note,
      m.title,
      m.year,
      m.primary_artist_name,
      m.primary_artist_discogs_id,
      m.scene_weight
    FROM enrich.label_core_run cr
    JOIN catalog.masters m ON m.discogs_id = cr.master_discogs_id
    WHERE cr.discogs_label_id = ${labelId}
    -- Curated entries always rank above auto, then by explicit rank ascending.
    ORDER BY (cr.source = 'curated') DESC, cr.rank ASC
    LIMIT ${cap}
  `.execute(db);

  return rows.rows.map((r) => ({
    master_discogs_id: Number(r.master_discogs_id),
    rank: r.rank,
    source: r.source,
    note: r.note,
    title: r.title,
    year: r.year,
    primary_artist_name: r.primary_artist_name,
    primary_artist_discogs_id: r.primary_artist_discogs_id,
    scene_weight: r.scene_weight,
  }));
}

/**
 * Outgoing directional related-labels for a label, joined to catalog.labels
 * for the display name and to enrich.label_editorial for the palette.
 */
export async function getLabelRelated(
  db: Kysely<Database>,
  labelId: number,
): Promise<RelatedLabel[]> {
  const rows = await sql<{
    to_label_id: number;
    to_label_name: string | null;
    direction: RelatedDirection;
    rank: number;
    blurb: string | null;
    master_count: string;
    palette: { accent: string; accent_ink: string } | null;
  }>`
    SELECT
      r.to_label_id,
      l.name AS to_label_name,
      r.direction,
      r.rank,
      r.blurb,
      (
        SELECT COUNT(*) FROM catalog.masters m
        WHERE m.primary_label_discogs_id = r.to_label_id
      ) AS master_count,
      le.palette
    FROM enrich.label_related r
    LEFT JOIN catalog.labels l       ON l.discogs_id = r.to_label_id
    LEFT JOIN enrich.label_editorial le ON le.discogs_label_id = r.to_label_id
    WHERE r.from_label_id = ${labelId}
    -- Lower rank first; then by direction so the UI order is stable per label.
    ORDER BY r.rank ASC, r.direction ASC
  `.execute(db);

  return rows.rows
    .filter((r) => r.to_label_name) // skip orphan edges (target label missing in catalog)
    .map((r) => ({
      to_label_id: r.to_label_id,
      to_label_name: r.to_label_name as string,
      direction: r.direction,
      rank: r.rank,
      blurb: r.blurb,
      to_label_master_count: Number(r.master_count) || 0,
      palette: r.palette,
    }));
}

// ---------------------------------------------------------------------------
// getLabelCoreRunPlaylist — the core run as a playable strip
// ---------------------------------------------------------------------------

export interface LabelPlaylistRecord {
  master_discogs_id: number;
  title: string;
  primary_artist_name: string | null;
  year: number | null;
  video_id: string;
}

export interface LabelPlaylist {
  label_discogs_id: number;
  video_count: number;
  /** YouTube anonymous playlist over the run, in curated rank order. */
  playlist_url: string | null;
  records: LabelPlaylistRecord[];
}

/**
 * The label's core run paired with each master's first YouTube video, kept
 * in curated rank order (the run IS the sequencing — no shuffle here).
 * Masters without a video simply drop out of the strip.
 */
export async function getLabelCoreRunPlaylist(
  db: Kysely<Database>,
  labelId: number,
  limit: number = 10,
): Promise<LabelPlaylist> {
  const run = await getLabelCoreRun(db, labelId, limit);
  if (run.length === 0) {
    return { label_discogs_id: labelId, video_count: 0, playlist_url: null, records: [] };
  }

  const ids = run.map((m) => m.master_discogs_id);
  const vids = await sql<{ master_discogs_id: number; url: string }>`
    SELECT DISTINCT ON (v.master_discogs_id)
      v.master_discogs_id,
      v.url
    FROM catalog.master_videos_unified v
    WHERE v.master_discogs_id = ANY(${ids}::int[])
      AND (v.url LIKE '%youtube.com%' OR v.url LIKE '%youtu.be%')
    ORDER BY v.master_discogs_id, v.id ASC
  `.execute(db);
  const urlById = new Map(vids.rows.map((r) => [r.master_discogs_id, r.url]));

  const records: LabelPlaylistRecord[] = [];
  for (const m of run) {
    const url = urlById.get(m.master_discogs_id);
    if (!url) continue;
    const match = YOUTUBE_ID_RE.exec(url);
    if (!match) continue;
    records.push({
      master_discogs_id: m.master_discogs_id,
      title: m.title,
      primary_artist_name: m.primary_artist_name,
      year: m.year,
      video_id: match[1],
    });
  }

  return {
    label_discogs_id: labelId,
    video_count: records.length,
    playlist_url:
      records.length > 0
        ? `https://www.youtube.com/watch_videos?video_ids=${records.map((r) => r.video_id).join(",")}`
        : null,
    records,
  };
}
