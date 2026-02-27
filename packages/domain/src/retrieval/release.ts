import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

export interface ReleaseDetail {
  discogs_id: number;
  title: string;
  country: string | null;
  release_year: number | null;
  released_raw: string | null;
  status: string;
  notes: string | null;
  data_quality: string;
  master_discogs_id: number | null;
  is_main_release: boolean | null;
  artists: Array<{ discogs_id: number; name: string; role: string | null; join_relation: string | null }>;
  labels: Array<{ discogs_id: number; name: string; catalog_number: string | null }>;
  formats: Array<{ name: string; qty: number | null; descriptions: string[] | null }>;
  genres: string[];
  styles: string[];
  tracks: Array<{
    position_raw: string | null;
    title: string | null;
    duration_seconds: number | null;
    disc: number | null;
    credits: Array<{ artist_discogs_id: number; artist_name: string; role: string | null }>;
  }>;
  credits: Array<{ artist_discogs_id: number; artist_name: string; role: string | null }>;
  identifiers: Array<{ type: string; value: string; description: string | null }>;
  companies: Array<{ discogs_id: number; name: string; entity_type: string | null }>;
  videos: Array<{ url: string; title: string | null; duration_seconds: number | null }>;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export async function getRelease(
  db: Kysely<Database>,
  discogsId: number,
  batchId: string,
  dumpDate: string,
): Promise<ReleaseDetail | null> {
  const release = await db
    .selectFrom("catalog.releases")
    .select([
      "discogs_id", "title", "country", "release_year", "released_raw",
      "status", "notes", "data_quality", "master_discogs_id", "is_main_release",
    ])
    .where("discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();

  if (!release) return null;

  const [artists, labels, formats, genres, styles, credits, identifiers, companies, videos] =
    await Promise.all([
      db.selectFrom("catalog.release_artists")
        .select(["artist_discogs_id as discogs_id", "artist_name as name", "role", "join_relation"])
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .orderBy("position", "asc")
        .execute(),
      db.selectFrom("catalog.release_labels")
        .select(["label_discogs_id as discogs_id", "label_name as name", "catno as catalog_number"])
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .execute(),
      db.selectFrom("catalog.release_formats")
        .select(["name", "qty", "descriptions"])
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .orderBy("position", "asc")
        .execute(),
      db.selectFrom("catalog.release_genres")
        .select("genre")
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .execute(),
      db.selectFrom("catalog.release_styles")
        .select("style")
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .execute(),
      db.selectFrom("catalog.release_credits")
        .select(["artist_discogs_id", "artist_name", "role"])
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .execute(),
      db.selectFrom("catalog.release_identifiers")
        .select(["type", "value", "description"])
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .execute(),
      db.selectFrom("catalog.release_companies")
        .select(["company_discogs_id as discogs_id", "company_name as name", "entity_type"])
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .execute(),
      db.selectFrom("catalog.release_videos")
        .select(["url", "title", "duration_seconds"])
        .where("release_discogs_id", "=", discogsId)
        .where("batch_id", "=", batchId)
        .execute(),
    ]);

  // Fetch tracks with their credits
  const tracks = await db
    .selectFrom("catalog.tracks")
    .select(["id", "position_raw", "title", "duration_seconds", "disc_number"])
    .where("release_discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .orderBy("position", "asc")
    .execute();

  // Batch-fetch track credits
  const trackIds = tracks.map((t) => t.id);
  const trackCredits = trackIds.length > 0
    ? await db
        .selectFrom("catalog.track_credits")
        .select(["track_id", "artist_discogs_id", "artist_name", "role"])
        .where("track_id", "in", trackIds)
        .where("batch_id", "=", batchId)
        .execute()
    : [];

  const creditsByTrack = new Map<number, typeof trackCredits>();
  for (const tc of trackCredits) {
    const existing = creditsByTrack.get(tc.track_id) ?? [];
    existing.push(tc);
    creditsByTrack.set(tc.track_id, existing);
  }

  return {
    discogs_id: release.discogs_id,
    title: release.title,
    country: release.country,
    release_year: release.release_year,
    released_raw: release.released_raw,
    status: release.status,
    notes: release.notes,
    data_quality: release.data_quality,
    master_discogs_id: release.master_discogs_id,
    is_main_release: release.is_main_release,
    artists: artists.map((a) => ({
      discogs_id: a.discogs_id,
      name: a.name,
      role: a.role,
      join_relation: a.join_relation,
    })),
    labels: labels.map((l) => ({
      discogs_id: l.discogs_id,
      name: l.name,
      catalog_number: l.catalog_number,
    })),
    formats: formats.map((f) => ({
      name: f.name,
      qty: f.qty,
      descriptions: f.descriptions,
    })),
    genres: genres.map((g) => g.genre),
    styles: styles.map((s) => s.style),
    tracks: tracks.map((t) => ({
      position_raw: t.position_raw,
      title: t.title,
      duration_seconds: t.duration_seconds,
      disc: t.disc_number,
      credits: (creditsByTrack.get(t.id) ?? []).map((c) => ({
        artist_discogs_id: c.artist_discogs_id,
        artist_name: c.artist_name,
        role: c.role,
      })),
    })),
    credits: credits.map((c) => ({
      artist_discogs_id: c.artist_discogs_id,
      artist_name: c.artist_name,
      role: c.role,
    })),
    identifiers: identifiers.map((i) => ({
      type: i.type,
      value: i.value,
      description: i.description,
    })),
    companies: companies.map((c) => ({
      discogs_id: c.discogs_id,
      name: c.name,
      entity_type: c.entity_type,
    })),
    videos: videos.map((v) => ({
      url: v.url,
      title: v.title,
      duration_seconds: v.duration_seconds,
    })),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: release.discogs_id },
  };
}
