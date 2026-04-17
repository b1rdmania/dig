import { sql, type Kysely } from "kysely";
import type { Database } from "@dig/db";

/**
 * Master detail for the slim, master-first dig-db-scene shape.
 *
 * Reads exclusively from the denormed/derived tables:
 *   - catalog.masters (with primary_*, genres[], styles[], scene_weight)
 *   - catalog.master_artists (full artist list, denormed names)
 *   - catalog.master_tracks (Frankenstein tracklist from canonical release)
 *   - catalog.master_videos_unified (master + release-sourced videos)
 *
 * Notable Versions (alternate releases) come from `getMasterReleases` in
 * traversal.ts which reads catalog.release_shadow. They are NOT inlined
 * here to keep the master detail call cheap and cacheable; the frontend
 * fetches versions lazily.
 *
 * `released` columns from the legacy release-detail surface (notes, status,
 * identifiers, companies, etc.) are intentionally absent — we don't ship
 * release-level metadata in the slim shape.
 */
export interface MasterDetail {
  discogs_id: number;
  title: string;
  year: number | null;
  /** Discogs main_release id, kept so we can link out to discogs.com */
  main_release_discogs_id: number | null;
  data_quality: string;
  /** New: editorial signal from build-time pruning (higher = more in-scene) */
  scene_weight: number;
  /** Denormed primary attribution (the most likely "by X on Y" header) */
  primary_artist: { discogs_id: number | null; name: string | null };
  primary_label:  { discogs_id: number | null; name: string | null };
  /** "Various" or full artist credit string when there are joins/featuring */
  artists_credit_text: string | null;
  primary_country: string | null;
  primary_format: string | null;
  genres: string[];
  styles: string[];
  /** Full credit list from catalog.master_artists (in declared order) */
  artists: Array<{
    discogs_id: number;
    name: string;
    role: string | null;
    join_relation: string | null;
  }>;
  /** Frankenstein tracklist synthesised from the best in-scope release */
  tracks: Array<{
    position: string | null;
    title: string | null;
    duration_seconds: number | null;
    artists_text: string | null;
    source_release_discogs_id: number | null;
  }>;
  /** Unified master + release video feed (deduped at build time) */
  videos: Array<{
    url: string;
    title: string | null;
    duration_seconds: number | null;
    source_type: "master" | "release";
    source_release_discogs_id: number | null;
    discogs_release_url: string | null;
  }>;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export async function getMaster(
  db: Kysely<Database>,
  discogsId: number,
  batchId: string,
  dumpDate: string,
): Promise<MasterDetail | null> {
  const master = await db
    .selectFrom("catalog.masters")
    .select([
      "discogs_id",
      "title",
      "year",
      "main_release_discogs_id",
      "data_quality",
      "scene_weight",
      "primary_artist_discogs_id",
      "primary_artist_name",
      "primary_label_discogs_id",
      "primary_label_name",
      "artists_credit_text",
      "primary_country",
      "primary_format",
      "genres",
      "styles",
    ])
    .where("discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();

  if (!master) return null;

  const [artists, tracks, videos] = await Promise.all([
    db
      .selectFrom("catalog.master_artists")
      .select([
        "artist_discogs_id as discogs_id",
        "artist_name as name",
        "join_relation",
      ])
      .where("master_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .orderBy("position", "asc")
      .execute(),
    db
      .selectFrom("catalog.master_tracks")
      .select([
        "position",
        "title",
        "duration_seconds",
        "artists_text",
        "source_release_discogs_id",
      ])
      .where("master_discogs_id", "=", discogsId)
      // master_tracks deliberately doesn't carry batch_id — there is at most
      // one canonical tracklist per master in the slim shape.
      .orderBy(sql`(regexp_replace(position, '[^0-9]', '', 'g'))::int NULLS LAST`)
      .orderBy("position", "asc")
      .execute(),
    db
      .selectFrom("catalog.master_videos_unified")
      .select([
        "url",
        "title",
        "duration_seconds",
        "source_type",
        "source_release_discogs_id",
        "discogs_release_url",
      ])
      .where("master_discogs_id", "=", discogsId)
      // master_videos_unified is also batch-agnostic (built from current scope)
      .orderBy("source_type", "asc")
      .orderBy("id", "asc")
      .execute(),
  ]);

  return {
    discogs_id: master.discogs_id,
    title: master.title,
    year: master.year,
    main_release_discogs_id: master.main_release_discogs_id,
    data_quality: master.data_quality,
    scene_weight: master.scene_weight,
    primary_artist: {
      discogs_id: master.primary_artist_discogs_id,
      name: master.primary_artist_name,
    },
    primary_label: {
      discogs_id: master.primary_label_discogs_id,
      name: master.primary_label_name,
    },
    artists_credit_text: master.artists_credit_text,
    primary_country: master.primary_country,
    primary_format: master.primary_format,
    genres: master.genres ?? [],
    styles: master.styles ?? [],
    artists: artists.map((a) => ({
      discogs_id: a.discogs_id,
      name: a.name,
      role: null,
      join_relation: a.join_relation,
    })),
    tracks: tracks.map((t) => ({
      position: t.position,
      title: t.title,
      duration_seconds: t.duration_seconds,
      artists_text: t.artists_text,
      source_release_discogs_id: t.source_release_discogs_id,
    })),
    videos: videos.map((v) => ({
      url: v.url,
      title: v.title,
      duration_seconds: v.duration_seconds,
      source_type: v.source_type as "master" | "release",
      source_release_discogs_id: v.source_release_discogs_id,
      discogs_release_url: v.discogs_release_url,
    })),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: master.discogs_id },
  };
}
