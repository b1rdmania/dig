import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

export interface LabelDetail {
  discogs_id: number;
  name: string;
  profile: string | null;
  contact_info: string | null;
  parent_label: { discogs_id: number | null; name: string | null };
  data_quality: string;
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
    .select(["discogs_id", "name", "profile", "contact_info", "data_quality", "parent_label_discogs_id"])
    .where("discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .executeTakeFirst();

  if (!label) return null;

  // Resolve parent label name if exists
  let parentName: string | null = null;
  if (label.parent_label_discogs_id) {
    const parent = await db
      .selectFrom("catalog.labels")
      .select("name")
      .where("discogs_id", "=", label.parent_label_discogs_id)
      .where("batch_id", "=", batchId)
      .executeTakeFirst();
    parentName = parent?.name ?? null;
  }

  const urls = await db
    .selectFrom("catalog.label_urls")
    .select("url")
    .where("label_discogs_id", "=", discogsId)
    .where("batch_id", "=", batchId)
    .execute();

  return {
    discogs_id: label.discogs_id,
    name: label.name,
    profile: label.profile,
    contact_info: label.contact_info,
    parent_label: {
      discogs_id: label.parent_label_discogs_id,
      name: parentName,
    },
    data_quality: label.data_quality,
    urls: urls.map((u) => u.url),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: label.discogs_id },
  };
}
