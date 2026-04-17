import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

/**
 * Artist detail for the slim, master-first dig-db-scene shape.
 *
 * Reads from:
 *   - catalog.artists (with denormed `aliases_text TEXT[]`)
 *   - catalog.artist_urls (preserved as a relational table)
 *
 * Dropped from v1:
 *   - aliases (relational join → replaced by denormed `aliases_text`)
 *   - name_variations  (no UI surface in slim product)
 *   - members / groups (no UI surface in slim product)
 *
 * The shape keeps the dropped fields as empty arrays to preserve the API
 * response contract during the soft-alpha cutover. They become hard-removed
 * once the API/MCP/frontend are updated to stop reading them.
 */
export interface ArtistDetail {
  discogs_id: number;
  name: string;
  real_name: string | null;
  profile: string | null;
  data_quality: string;
  /** Denormed alias names (no per-alias discogs_id in the slim shape) */
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
    .select(["discogs_id", "name", "real_name", "profile", "data_quality", "aliases_text"])
    .where("discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();

  if (!artist) return null;

  const urls = await db
    .selectFrom("catalog.artist_urls")
    .select("url")
    .where("artist_discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .execute();

  const aliasNames = artist.aliases_text ?? [];

  return {
    discogs_id: artist.discogs_id,
    name: artist.name,
    real_name: artist.real_name,
    profile: artist.profile,
    data_quality: artist.data_quality,
    aliases: aliasNames.map((name) => ({ discogs_id: null, name })),
    name_variations: [],
    members: [],
    groups: [],
    urls: urls.map((u) => u.url),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: artist.discogs_id },
  };
}
