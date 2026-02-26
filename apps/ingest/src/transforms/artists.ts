/**
 * Canonical transform: raw_entities (artist) → catalog.artists + child tables
 */

import type { Kysely, Database } from "@dig/db";
import type { XmlNode } from "../parser.js";
import { children, childText, attr, parseInt_safe, chunkedInsert } from "./helpers.js";

export async function transformArtists(
  db: Kysely<Database>,
  batchId: string,
  rows: Array<{ discogs_id: number; raw_payload: XmlNode }>
): Promise<{ artists: number; urls: number; nvs: number; aliases: number; groups: number; members: number }> {
  let artistCount = 0;
  let urlCount = 0;
  let nvsCount = 0;
  let aliasCount = 0;
  let groupCount = 0;
  let memberCount = 0;

  // Batch core artists
  const artistRows = rows.map((row) => {
    const data = row.raw_payload;
    return {
      discogs_id: row.discogs_id,
      name: childText(data, "name") || `[Unknown Artist ${row.discogs_id}]`,
      real_name: childText(data, "realname") || null,
      profile: childText(data, "profile") || null,
      data_quality: childText(data, "data_quality") || "Needs Vote",
      batch_id: batchId,
    };
  });

  if (artistRows.length > 0) {
    await db
      .insertInto("catalog.artists")
      .values(artistRows)
      .onConflict((oc) =>
        oc.columns(["batch_id", "discogs_id"]).doUpdateSet({
          name: (eb) => eb.ref("excluded.name"),
          real_name: (eb) => eb.ref("excluded.real_name"),
          profile: (eb) => eb.ref("excluded.profile"),
          data_quality: (eb) => eb.ref("excluded.data_quality"),
        })
      )
      .execute();
    artistCount = artistRows.length;
  }

  // Collect child rows across all entities in this batch
  const urlRows: Array<{ artist_discogs_id: number; url: string; batch_id: string }> = [];
  const nvsRows: Array<{ artist_discogs_id: number; name: string; batch_id: string }> = [];
  const aliasRows: Array<{ artist_discogs_id: number; alias_name: string; alias_discogs_id: number | null; batch_id: string }> = [];
  const groupRows: Array<{ artist_discogs_id: number; group_name: string; group_discogs_id: number | null; batch_id: string }> = [];
  const memberRows: Array<{ artist_discogs_id: number; member_name: string; member_discogs_id: number | null; batch_id: string }> = [];

  for (const row of rows) {
    const data = row.raw_payload;
    const discogsId = row.discogs_id;

    // URLs
    const urlsWrapper = children(data, "urls");
    if (urlsWrapper.length > 0) {
      for (const urlNode of children(urlsWrapper[0], "url")) {
        const url = urlNode["#text"] as string;
        if (url) urlRows.push({ artist_discogs_id: discogsId, url, batch_id: batchId });
      }
    }

    // Name variations
    const nvsWrapper = children(data, "namevariations");
    if (nvsWrapper.length > 0) {
      for (const nvNode of children(nvsWrapper[0], "name")) {
        const name = nvNode["#text"] as string;
        if (name) nvsRows.push({ artist_discogs_id: discogsId, name, batch_id: batchId });
      }
    }

    // Aliases
    const aliasWrapper = children(data, "aliases");
    if (aliasWrapper.length > 0) {
      for (const aliasNode of children(aliasWrapper[0], "name")) {
        const name = aliasNode["#text"] as string;
        const id = parseInt_safe(attr(aliasNode, "id"));
        if (name) aliasRows.push({ artist_discogs_id: discogsId, alias_name: name, alias_discogs_id: id, batch_id: batchId });
      }
    }

    // Groups
    const groupWrapper = children(data, "groups");
    if (groupWrapper.length > 0) {
      for (const groupNode of children(groupWrapper[0], "name")) {
        const name = groupNode["#text"] as string;
        const id = parseInt_safe(attr(groupNode, "id"));
        if (name) groupRows.push({ artist_discogs_id: discogsId, group_name: name, group_discogs_id: id, batch_id: batchId });
      }
    }

    // Members
    const memberWrapper = children(data, "members");
    if (memberWrapper.length > 0) {
      for (const memberNode of children(memberWrapper[0], "name")) {
        const name = memberNode["#text"] as string;
        const id = parseInt_safe(attr(memberNode, "id"));
        if (name) memberRows.push({ artist_discogs_id: discogsId, member_name: name, member_discogs_id: id, batch_id: batchId });
      }
    }
  }

  // Write child tables in bulk (chunked to stay under param limit)
  if (urlRows.length > 0) {
    await chunkedInsert(db, "catalog.artist_urls", urlRows,
      (oc: any) => oc.columns(["batch_id", "artist_discogs_id", "url"]).doNothing());
    urlCount = urlRows.length;
  }

  if (nvsRows.length > 0) {
    await chunkedInsert(db, "catalog.artist_name_variations", nvsRows,
      (oc: any) => oc.columns(["batch_id", "artist_discogs_id", "name"]).doNothing());
    nvsCount = nvsRows.length;
  }

  if (aliasRows.length > 0) {
    await chunkedInsert(db, "catalog.artist_aliases", aliasRows,
      (oc: any) => oc.columns(["batch_id", "artist_discogs_id", "alias_name"]).doNothing());
    aliasCount = aliasRows.length;
  }

  if (groupRows.length > 0) {
    await chunkedInsert(db, "catalog.artist_groups", groupRows,
      (oc: any) => oc.columns(["batch_id", "artist_discogs_id", "group_name"]).doNothing());
    groupCount = groupRows.length;
  }

  if (memberRows.length > 0) {
    await chunkedInsert(db, "catalog.artist_members", memberRows,
      (oc: any) => oc.columns(["batch_id", "artist_discogs_id", "member_name"]).doNothing());
    memberCount = memberRows.length;
  }

  return { artists: artistCount, urls: urlCount, nvs: nvsCount, aliases: aliasCount, groups: groupCount, members: memberCount };
}
