/**
 * Canonical transform: raw_entities (release) → catalog.releases + child tables
 *
 * This handles both core release columns and all fanout tables:
 * - release_artists, release_credits, release_labels, release_formats
 * - release_genres, release_styles, release_identifiers
 * - release_companies, release_videos
 * - tracks, track_credits
 */

import type { Kysely, Database } from "@dig/db";
import { sql } from "@dig/db";
import type { XmlNode } from "../parser.js";
import {
  children, childText, attr, text,
  parseInt_safe, parseBool, parseDate, parseDuration,
  chunkedInsert,
} from "./helpers.js";

export interface ReleaseTransformCounts {
  releases: number;
  release_artists: number;
  release_credits: number;
  release_labels: number;
  release_formats: number;
  release_genres: number;
  release_styles: number;
  release_identifiers: number;
  release_companies: number;
  release_videos: number;
  tracks: number;
  track_credits: number;
}

export async function transformReleases(
  db: Kysely<Database>,
  batchId: string,
  rows: Array<{ discogs_id: number; raw_payload: XmlNode }>
): Promise<ReleaseTransformCounts> {
  const counts: ReleaseTransformCounts = {
    releases: 0, release_artists: 0, release_credits: 0, release_labels: 0,
    release_formats: 0, release_genres: 0, release_styles: 0,
    release_identifiers: 0, release_companies: 0, release_videos: 0,
    tracks: 0, track_credits: 0,
  };

  // --- Core releases ---
  const releaseRows = rows.map((row) => {
    const data = row.raw_payload;
    const releasedRaw = childText(data, "released");
    const { year, month, day } = parseDate(releasedRaw);

    // master_id has is_main_release as attribute
    const masterIds = children(data, "master_id");
    let masterDiscogsId: number | null = null;
    let isMainRelease: boolean | null = null;
    if (masterIds.length > 0) {
      masterDiscogsId = parseInt_safe(masterIds[0]["#text"] as string ?? "");
      isMainRelease = parseBool(attr(masterIds[0], "is_main_release"));
    }

    return {
      discogs_id: row.discogs_id,
      status: attr(data, "status") || "Accepted",
      title: childText(data, "title") || `[Untitled Release ${row.discogs_id}]`,
      country: childText(data, "country") || null,
      released_raw: releasedRaw || null,
      release_year: year,
      release_month: month,
      release_day: day,
      notes: childText(data, "notes") || null,
      data_quality: childText(data, "data_quality") || "Needs Vote",
      master_discogs_id: masterDiscogsId,
      is_main_release: isMainRelease,
      batch_id: batchId,
    };
  });

  if (releaseRows.length > 0) {
    await db
      .insertInto("catalog.releases")
      .values(releaseRows)
      .onConflict((oc) =>
        oc.columns(["batch_id", "discogs_id"]).doUpdateSet({
          status: (eb) => eb.ref("excluded.status"),
          title: (eb) => eb.ref("excluded.title"),
          country: (eb) => eb.ref("excluded.country"),
          released_raw: (eb) => eb.ref("excluded.released_raw"),
          release_year: (eb) => eb.ref("excluded.release_year"),
          release_month: (eb) => eb.ref("excluded.release_month"),
          release_day: (eb) => eb.ref("excluded.release_day"),
          notes: (eb) => eb.ref("excluded.notes"),
          data_quality: (eb) => eb.ref("excluded.data_quality"),
          master_discogs_id: (eb) => eb.ref("excluded.master_discogs_id"),
          is_main_release: (eb) => eb.ref("excluded.is_main_release"),
        })
      )
      .execute();
    counts.releases = releaseRows.length;
  }

  // --- Fanout tables ---
  // Collect all child rows, then bulk insert each table

  type ArtistRow = { release_discogs_id: number; artist_discogs_id: number; artist_name: string; anv: string | null; join_relation: string | null; role: string | null; position: number; batch_id: string };
  type CreditRow = { release_discogs_id: number; artist_discogs_id: number; artist_name: string; anv: string | null; role: string | null; batch_id: string };
  type LabelRow = { release_discogs_id: number; label_discogs_id: number; label_name: string; catno: string | null; batch_id: string };
  type FormatRow = { release_discogs_id: number; name: string; qty: number | null; text: string | null; descriptions: string[] | null; position: number; batch_id: string };
  type GenreRow = { release_discogs_id: number; genre: string; batch_id: string };
  type StyleRow = { release_discogs_id: number; style: string; batch_id: string };
  type IdentRow = { release_discogs_id: number; type: string; value: string; description: string | null; batch_id: string };
  type CompanyRow = { release_discogs_id: number; company_discogs_id: number; company_name: string; catno: string | null; entity_type: string | null; entity_type_name: string | null; batch_id: string };
  type VideoRow = { release_discogs_id: number; url: string; duration_seconds: number | null; title: string | null; description: string | null; batch_id: string };
  type TrackRow = { release_discogs_id: number; position_raw: string | null; disc_number: number | null; track_number: string | null; title: string | null; duration_raw: string | null; duration_seconds: number | null; position: number; batch_id: string };
  type TrackCreditInput = { releaseDiscogsId: number; trackPosition: number; artistDiscogsId: number; artistName: string; anv: string | null; role: string | null };

  const artistRows: ArtistRow[] = [];
  const creditRows: CreditRow[] = [];
  const labelRows: LabelRow[] = [];
  const formatRows: FormatRow[] = [];
  const genreRows: GenreRow[] = [];
  const styleRows: StyleRow[] = [];
  const identRows: IdentRow[] = [];
  const companyRows: CompanyRow[] = [];
  const videoRows: VideoRow[] = [];
  const trackRows: TrackRow[] = [];
  const trackCreditInputs: TrackCreditInput[] = [];

  for (const row of rows) {
    const data = row.raw_payload;
    const rid = row.discogs_id;

    // Release artists
    const artistsW = children(data, "artists");
    if (artistsW.length > 0) {
      const al = children(artistsW[0], "artist");
      for (let i = 0; i < al.length; i++) {
        const a = al[i];
        const aid = parseInt_safe(childText(a, "id"));
        const name = childText(a, "name");
        if (aid !== null && name) {
          artistRows.push({
            release_discogs_id: rid, artist_discogs_id: aid, artist_name: name,
            anv: childText(a, "anv") || null, join_relation: childText(a, "join") || null,
            role: childText(a, "role") || null, position: i, batch_id: batchId,
          });
        }
      }
    }

    // Extra artists (credits)
    const extraW = children(data, "extraartists");
    if (extraW.length > 0) {
      for (const a of children(extraW[0], "artist")) {
        const aid = parseInt_safe(childText(a, "id"));
        const name = childText(a, "name");
        if (aid !== null && name) {
          creditRows.push({
            release_discogs_id: rid, artist_discogs_id: aid, artist_name: name,
            anv: childText(a, "anv") || null, role: childText(a, "role") || null,
            batch_id: batchId,
          });
        }
      }
    }

    // Labels
    const labelsW = children(data, "labels");
    if (labelsW.length > 0) {
      for (const l of children(labelsW[0], "label")) {
        const lid = parseInt_safe(attr(l, "id"));
        const name = attr(l, "name");
        if (lid !== null && name) {
          labelRows.push({
            release_discogs_id: rid, label_discogs_id: lid, label_name: name,
            catno: attr(l, "catno") || null, batch_id: batchId,
          });
        }
      }
    }

    // Formats
    const formatsW = children(data, "formats");
    if (formatsW.length > 0) {
      const fl = children(formatsW[0], "format");
      for (let i = 0; i < fl.length; i++) {
        const f = fl[i];
        const descsW = children(f, "descriptions");
        let descriptions: string[] | null = null;
        if (descsW.length > 0) {
          const dl = children(descsW[0], "description").map((d) => text(d)).filter(Boolean);
          if (dl.length > 0) descriptions = dl;
        }
        formatRows.push({
          release_discogs_id: rid, name: attr(f, "name") || "Unknown",
          qty: parseInt_safe(attr(f, "qty")), text: attr(f, "text") || null,
          descriptions, position: i, batch_id: batchId,
        });
      }
    }

    // Genres
    const genresW = children(data, "genres");
    if (genresW.length > 0) {
      for (const g of children(genresW[0], "genre")) {
        const genre = text(g);
        if (genre) genreRows.push({ release_discogs_id: rid, genre, batch_id: batchId });
      }
    }

    // Styles
    const stylesW = children(data, "styles");
    if (stylesW.length > 0) {
      for (const s of children(stylesW[0], "style")) {
        const style = text(s);
        if (style) styleRows.push({ release_discogs_id: rid, style, batch_id: batchId });
      }
    }

    // Identifiers
    const identsW = children(data, "identifiers");
    if (identsW.length > 0) {
      for (const id of children(identsW[0], "identifier")) {
        const type = attr(id, "type");
        const value = attr(id, "value");
        if (type && value) {
          identRows.push({
            release_discogs_id: rid, type, value,
            description: attr(id, "description") || null, batch_id: batchId,
          });
        }
      }
    }

    // Companies
    const companiesW = children(data, "companies");
    if (companiesW.length > 0) {
      for (const c of children(companiesW[0], "company")) {
        const cid = parseInt_safe(childText(c, "id"));
        const name = childText(c, "name");
        if (cid !== null && name) {
          companyRows.push({
            release_discogs_id: rid, company_discogs_id: cid, company_name: name,
            catno: childText(c, "catno") || null,
            entity_type: childText(c, "entity_type") || null,
            entity_type_name: childText(c, "entity_type_name") || null,
            batch_id: batchId,
          });
        }
      }
    }

    // Videos
    const videosW = children(data, "videos");
    if (videosW.length > 0) {
      for (const v of children(videosW[0], "video")) {
        const url = attr(v, "src");
        if (url) {
          videoRows.push({
            release_discogs_id: rid, url,
            duration_seconds: parseInt_safe(attr(v, "duration")),
            title: childText(v, "title") || null,
            description: childText(v, "description") || null,
            batch_id: batchId,
          });
        }
      }
    }

    // Tracks
    const tracklistW = children(data, "tracklist");
    if (tracklistW.length > 0) {
      const tl = children(tracklistW[0], "track");
      for (let i = 0; i < tl.length; i++) {
        const t = tl[i];
        const posRaw = childText(t, "position");
        const durRaw = childText(t, "duration");
        const parsed = parseTrackPosition(posRaw);
        trackRows.push({
          release_discogs_id: rid, position_raw: posRaw || null,
          disc_number: parsed.disc, track_number: parsed.track,
          title: childText(t, "title") || null,
          duration_raw: durRaw || null,
          duration_seconds: parseDuration(durRaw),
          position: i, batch_id: batchId,
        });

        // Track credits (extraartists within track)
        const trackExtraW = children(t, "extraartists");
        if (trackExtraW.length > 0) {
          for (const a of children(trackExtraW[0], "artist")) {
            const aid = parseInt_safe(childText(a, "id"));
            const name = childText(a, "name");
            if (aid !== null && name) {
              trackCreditInputs.push({
                releaseDiscogsId: rid, trackPosition: i,
                artistDiscogsId: aid, artistName: name,
                anv: childText(a, "anv") || null,
                role: childText(a, "role") || null,
              });
            }
          }
        }
      }
    }
  }

  // --- Bulk inserts ---

  if (artistRows.length > 0) {
    await chunkedInsert(db, "catalog.release_artists", artistRows,
      (oc: any) => oc.columns(["batch_id", "release_discogs_id", "position"]).doNothing());
    counts.release_artists = artistRows.length;
  }

  if (creditRows.length > 0) {
    await chunkedInsert(db, "catalog.release_credits", creditRows,
      (oc: any) => oc.doNothing());
    counts.release_credits = creditRows.length;
  }

  if (labelRows.length > 0) {
    await chunkedInsert(db, "catalog.release_labels", labelRows,
      (oc: any) => oc.doNothing());
    counts.release_labels = labelRows.length;
  }

  if (formatRows.length > 0) {
    await chunkedInsert(db, "catalog.release_formats", formatRows,
      (oc: any) => oc.columns(["batch_id", "release_discogs_id", "position"]).doNothing());
    counts.release_formats = formatRows.length;
  }

  if (genreRows.length > 0) {
    await chunkedInsert(db, "catalog.release_genres", genreRows,
      (oc: any) => oc.columns(["batch_id", "release_discogs_id", "genre"]).doNothing());
    counts.release_genres = genreRows.length;
  }

  if (styleRows.length > 0) {
    await chunkedInsert(db, "catalog.release_styles", styleRows,
      (oc: any) => oc.columns(["batch_id", "release_discogs_id", "style"]).doNothing());
    counts.release_styles = styleRows.length;
  }

  if (identRows.length > 0) {
    await chunkedInsert(db, "catalog.release_identifiers", identRows,
      (oc: any) => oc.doNothing());
    counts.release_identifiers = identRows.length;
  }

  if (companyRows.length > 0) {
    await chunkedInsert(db, "catalog.release_companies", companyRows,
      (oc: any) => oc.columns(["batch_id", "release_discogs_id", "company_discogs_id", "entity_type"]).doNothing());
    counts.release_companies = companyRows.length;
  }

  if (videoRows.length > 0) {
    await chunkedInsert(db, "catalog.release_videos", videoRows,
      (oc: any) => oc.columns(["batch_id", "release_discogs_id", "url"]).doNothing());
    counts.release_videos = videoRows.length;
  }

  if (trackRows.length > 0) {
    await chunkedInsert(db, "catalog.tracks", trackRows,
      (oc: any) => oc.columns(["batch_id", "release_discogs_id", "position"]).doNothing());
    counts.tracks = trackRows.length;
  }

  // Track credits need track_id FK — resolve via batch lookup
  if (trackCreditInputs.length > 0) {
    // Get track IDs for this batch's releases
    const releaseIds = [...new Set(trackCreditInputs.map((tc) => tc.releaseDiscogsId))];
    const trackIdMap = new Map<string, number>();

    for (let i = 0; i < releaseIds.length; i += 500) {
      const chunk = releaseIds.slice(i, i + 500);
      const trackIdRows = await db
        .selectFrom("catalog.tracks")
        .select(["id", "release_discogs_id", "position"])
        .where("batch_id", "=", batchId)
        .where("release_discogs_id", "in", chunk)
        .execute();

      for (const t of trackIdRows) {
        trackIdMap.set(`${t.release_discogs_id}:${t.position}`, t.id);
      }
    }

    const tcRows: Array<{
      track_id: number; artist_discogs_id: number; artist_name: string;
      anv: string | null; role: string | null; batch_id: string;
    }> = [];

    for (const tc of trackCreditInputs) {
      const trackId = trackIdMap.get(`${tc.releaseDiscogsId}:${tc.trackPosition}`);
      if (trackId !== undefined) {
        tcRows.push({
          track_id: trackId, artist_discogs_id: tc.artistDiscogsId,
          artist_name: tc.artistName, anv: tc.anv, role: tc.role,
          batch_id: batchId,
        });
      }
    }

    if (tcRows.length > 0) {
      await chunkedInsert(db, "catalog.track_credits", tcRows,
        (oc: any) => oc.doNothing());
      counts.track_credits = tcRows.length;
    }
  }

  return counts;
}

/**
 * Parse track position string into disc/track components.
 * See normalization-dictionary-v1.md §6 for patterns.
 */
function parseTrackPosition(raw: string): { disc: number | null; track: string | null } {
  if (!raw || !raw.trim()) return { disc: null, track: null };
  const s = raw.trim();

  // CD disc format: "1-3" → disc 1, track "3"
  const cdMatch = s.match(/^(\d+)-(\d+)$/);
  if (cdMatch) {
    const disc = parseInt(cdMatch[1], 10);
    return { disc: disc > 0 && disc <= 9999 ? disc : null, track: cdMatch[2] };
  }

  // Vinyl side: "A1", "B2", "AA" etc → disc 1, track as-is
  const vinylMatch = s.match(/^[A-Za-z]/);
  if (vinylMatch) {
    return { disc: 1, track: s };
  }

  // Simple numeric: "3" → disc 1, track "3"
  const numMatch = s.match(/^\d+$/);
  if (numMatch) {
    return { disc: 1, track: s };
  }

  // Sub-track: "1.1" → disc 1, track "1.1"
  const subMatch = s.match(/^\d+\.\d+$/);
  if (subMatch) {
    return { disc: 1, track: s };
  }

  // Fallback
  return { disc: null, track: s };
}
