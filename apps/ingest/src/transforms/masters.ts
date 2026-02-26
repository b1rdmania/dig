/**
 * Canonical transform: raw_entities (master) → catalog.masters + child tables
 */

import type { Kysely, Database } from "@dig/db";
import type { XmlNode } from "../parser.js";
import { children, childText, attr, text, parseInt_safe, chunkedInsert } from "./helpers.js";

export async function transformMasters(
  db: Kysely<Database>,
  batchId: string,
  rows: Array<{ discogs_id: number; raw_payload: XmlNode }>
): Promise<{ masters: number; artists: number; genres: number; styles: number; videos: number }> {
  let masterCount = 0;
  let artistCount = 0;
  let genreCount = 0;
  let styleCount = 0;
  let videoCount = 0;

  const masterRows = rows.map((row) => {
    const data = row.raw_payload;
    const year = parseInt_safe(childText(data, "year"));
    return {
      discogs_id: row.discogs_id,
      title: childText(data, "title") || `[Untitled Master ${row.discogs_id}]`,
      main_release_discogs_id: parseInt_safe(childText(data, "main_release")),
      year: year === 0 ? null : year, // 0 = unknown in Discogs
      data_quality: childText(data, "data_quality") || "Needs Vote",
      batch_id: batchId,
    };
  });

  if (masterRows.length > 0) {
    await db
      .insertInto("catalog.masters")
      .values(masterRows)
      .onConflict((oc) =>
        oc.columns(["batch_id", "discogs_id"]).doUpdateSet({
          title: (eb) => eb.ref("excluded.title"),
          main_release_discogs_id: (eb) => eb.ref("excluded.main_release_discogs_id"),
          year: (eb) => eb.ref("excluded.year"),
          data_quality: (eb) => eb.ref("excluded.data_quality"),
        })
      )
      .execute();
    masterCount = masterRows.length;
  }

  // Child tables
  const artistRows: Array<{
    master_discogs_id: number; artist_discogs_id: number; artist_name: string;
    anv: string | null; join_relation: string | null; position: number; batch_id: string;
  }> = [];
  const genreRows: Array<{ master_discogs_id: number; genre: string; batch_id: string }> = [];
  const styleRows: Array<{ master_discogs_id: number; style: string; batch_id: string }> = [];
  const videoRows: Array<{
    master_discogs_id: number; url: string; duration_seconds: number | null;
    title: string | null; description: string | null; batch_id: string;
  }> = [];

  for (const row of rows) {
    const data = row.raw_payload;
    const mid = row.discogs_id;

    // Artists
    const artistsWrapper = children(data, "artists");
    if (artistsWrapper.length > 0) {
      const artistList = children(artistsWrapper[0], "artist");
      for (let i = 0; i < artistList.length; i++) {
        const a = artistList[i];
        const aid = parseInt_safe(childText(a, "id"));
        const name = childText(a, "name");
        if (aid !== null && name) {
          artistRows.push({
            master_discogs_id: mid,
            artist_discogs_id: aid,
            artist_name: name,
            anv: childText(a, "anv") || null,
            join_relation: childText(a, "join") || null,
            position: i,
            batch_id: batchId,
          });
        }
      }
    }

    // Genres
    const genresWrapper = children(data, "genres");
    if (genresWrapper.length > 0) {
      for (const g of children(genresWrapper[0], "genre")) {
        const genre = text(g);
        if (genre) genreRows.push({ master_discogs_id: mid, genre, batch_id: batchId });
      }
    }

    // Styles
    const stylesWrapper = children(data, "styles");
    if (stylesWrapper.length > 0) {
      for (const s of children(stylesWrapper[0], "style")) {
        const style = text(s);
        if (style) styleRows.push({ master_discogs_id: mid, style, batch_id: batchId });
      }
    }

    // Videos
    const videosWrapper = children(data, "videos");
    if (videosWrapper.length > 0) {
      for (const v of children(videosWrapper[0], "video")) {
        const url = attr(v, "src");
        if (url) {
          videoRows.push({
            master_discogs_id: mid,
            url,
            duration_seconds: parseInt_safe(attr(v, "duration")),
            title: childText(v, "title") || null,
            description: childText(v, "description") || null,
            batch_id: batchId,
          });
        }
      }
    }
  }

  if (artistRows.length > 0) {
    await chunkedInsert(db, "catalog.master_artists", artistRows,
      (oc: any) => oc.columns(["batch_id", "master_discogs_id", "position"]).doNothing());
    artistCount = artistRows.length;
  }

  if (genreRows.length > 0) {
    await chunkedInsert(db, "catalog.master_genres", genreRows,
      (oc: any) => oc.columns(["batch_id", "master_discogs_id", "genre"]).doNothing());
    genreCount = genreRows.length;
  }

  if (styleRows.length > 0) {
    await chunkedInsert(db, "catalog.master_styles", styleRows,
      (oc: any) => oc.columns(["batch_id", "master_discogs_id", "style"]).doNothing());
    styleCount = styleRows.length;
  }

  if (videoRows.length > 0) {
    await chunkedInsert(db, "catalog.master_videos", videoRows,
      (oc: any) => oc.columns(["batch_id", "master_discogs_id", "url"]).doNothing());
    videoCount = videoRows.length;
  }

  return { masters: masterCount, artists: artistCount, genres: genreCount, styles: styleCount, videos: videoCount };
}
