import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

export interface ArtistDetail {
  discogs_id: number;
  name: string;
  real_name: string | null;
  profile: string | null;
  data_quality: string;
  aliases: Array<{ discogs_id: number | null; name: string }>;
  name_variations: string[];
  members: Array<{ discogs_id: number | null; name: string }>;
  groups: Array<{ discogs_id: number | null; name: string }>;
  urls: string[];
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export async function getArtist(
  db: Kysely<Database>,
  discogsId: number,
  batchId: string,
  dumpDate: string,
): Promise<ArtistDetail | null> {
  const artist = await db
    .selectFrom("catalog.artists")
    .select(["discogs_id", "name", "real_name", "profile", "data_quality"])
    .where("discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();

  if (!artist) return null;

  const [aliases, nameVars, members, groups, urls] = await Promise.all([
    db.selectFrom("catalog.artist_aliases")
      .select(["alias_discogs_id as discogs_id", "alias_name as name"])
      .where("artist_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
    db.selectFrom("catalog.artist_name_variations")
      .select("name")
      .where("artist_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
    db.selectFrom("catalog.artist_members")
      .select(["member_discogs_id as discogs_id", "member_name as name"])
      .where("artist_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
    db.selectFrom("catalog.artist_groups")
      .select(["group_discogs_id as discogs_id", "group_name as name"])
      .where("artist_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
    db.selectFrom("catalog.artist_urls")
      .select("url")
      .where("artist_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
  ]);

  return {
    discogs_id: artist.discogs_id,
    name: artist.name,
    real_name: artist.real_name,
    profile: artist.profile,
    data_quality: artist.data_quality,
    aliases: aliases.map((a) => ({ discogs_id: a.discogs_id, name: a.name })),
    name_variations: nameVars.map((v) => v.name),
    members: members.map((m) => ({ discogs_id: m.discogs_id, name: m.name })),
    groups: groups.map((g) => ({ discogs_id: g.discogs_id, name: g.name })),
    urls: urls.map((u) => u.url),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: artist.discogs_id },
  };
}
