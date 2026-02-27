import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

export interface MasterDetail {
  discogs_id: number;
  title: string;
  year: number | null;
  main_release_discogs_id: number | null;
  data_quality: string;
  artists: Array<{ discogs_id: number; name: string; role: string | null; join_relation: string | null }>;
  genres: string[];
  styles: string[];
  videos: Array<{ url: string; title: string | null; duration_seconds: number | null }>;
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
    .select(["discogs_id", "title", "year", "main_release_discogs_id", "data_quality"])
    .where("discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();

  if (!master) return null;

  const [artists, genres, styles, videos] = await Promise.all([
    db.selectFrom("catalog.master_artists")
      .select(["artist_discogs_id as discogs_id", "artist_name as name", "join_relation"])
      .where("master_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .orderBy("position", "asc")
      .execute(),
    db.selectFrom("catalog.master_genres")
      .select("genre")
      .where("master_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
    db.selectFrom("catalog.master_styles")
      .select("style")
      .where("master_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
    db.selectFrom("catalog.master_videos")
      .select(["url", "title", "duration_seconds"])
      .where("master_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
  ]);

  return {
    discogs_id: master.discogs_id,
    title: master.title,
    year: master.year,
    main_release_discogs_id: master.main_release_discogs_id,
    data_quality: master.data_quality,
    artists: artists.map((a) => ({
      discogs_id: a.discogs_id,
      name: a.name,
      role: null,
      join_relation: a.join_relation,
    })),
    genres: genres.map((g) => g.genre),
    styles: styles.map((s) => s.style),
    videos: videos.map((v) => ({
      url: v.url,
      title: v.title,
      duration_seconds: v.duration_seconds,
    })),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: master.discogs_id },
  };
}
