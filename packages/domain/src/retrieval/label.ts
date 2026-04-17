import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

/**
 * Label detail for the slim, master-first dig-db-scene shape.
 *
 * Reads from:
 *   - catalog.labels (denormed `aliases_text TEXT[]`)
 *   - catalog.label_urls (preserved as a relational table)
 *   - enrich.label_editorial (tier1 / denylist signal — drives "Scene canon" UI)
 */
export interface LabelDetail {
  discogs_id: number;
  name: string;
  profile: string | null;
  contact_info: string | null;
  parent_label: { discogs_id: number | null; name: string | null };
  data_quality: string;
  /** Denormed aliases (no per-alias discogs_id in the slim shape) */
  aliases: string[];
  /** Editorial tier from enrich.label_editorial. null = unrated (long-tail). */
  tier: "tier1" | "denylist" | null;
  urls: string[];
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export async function getLabel(
  db: Kysely<Database>,
  discogsId: number,
  batchId: string,
  dumpDate: string,
): Promise<LabelDetail | null> {
  const label = await db
    .selectFrom("catalog.labels")
    .select([
      "discogs_id",
      "name",
      "profile",
      "contact_info",
      "data_quality",
      "parent_label_discogs_id",
      "aliases_text",
    ])
    .where("discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();

  if (!label) return null;

  const [parent, urls, editorial] = await Promise.all([
    label.parent_label_discogs_id
      ? db
          .selectFrom("catalog.labels")
          .select("name")
          .where("discogs_id", "=", label.parent_label_discogs_id)
          .where("batch_id", "=", batchId)
          .executeTakeFirst()
      : Promise.resolve(undefined),
    db
      .selectFrom("catalog.label_urls")
      .select("url")
      .where("label_discogs_id", "=", discogsId)
      .where("batch_id", "=", batchId)
      .execute(),
    db
      .selectFrom("enrich.label_editorial")
      .select("tier")
      .where("discogs_label_id", "=", discogsId)
      .executeTakeFirst(),
  ]);

  return {
    discogs_id: label.discogs_id,
    name: label.name,
    profile: label.profile,
    contact_info: label.contact_info,
    parent_label: {
      discogs_id: label.parent_label_discogs_id,
      name: parent?.name ?? null,
    },
    data_quality: label.data_quality,
    aliases: label.aliases_text ?? [],
    tier: editorial?.tier ?? null,
    urls: urls.map((u) => u.url),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: label.discogs_id },
  };
}
