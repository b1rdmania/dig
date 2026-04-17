import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

/**
 * Label detail for the slim, master-first dig-db-scene shape.
 *
 * Reads from:
 *   - catalog.labels (denormed `aliases_text TEXT[]`)
 *   - catalog.label_urls (preserved as a relational table)
 *   - enrich.label_editorial (tier1 / denylist signal + redesign metadata —
 *     drives the label-color identity, blurb, founded/closed dates that the
 *     new label page depends on. See migration 027.)
 */
export interface LabelEditorial {
  /** "tier1" = canonical scene label, "denylist" = excluded. */
  tier: "tier1" | "denylist" | null;
  /**
   * 2-colour palette used to tint the label page chrome (catalog number
   * sticker, hairline above the label name, dot in search results).
   * `null` for unrated long-tail labels — the page should fall back to
   * ink-on-paper without the palette.
   */
  palette: { accent: string; accent_ink: string } | null;
  /** ≤50-word hand-written editorial blurb (serif italic on the page). */
  blurb: string | null;
  founded_year: number | null;
  closed_year: number | null;
  is_active: boolean;
  /** "Ghent, BE" / "Berlin, DE" / etc. */
  location: string | null;
}

export interface LabelDetail {
  discogs_id: number;
  name: string;
  profile: string | null;
  contact_info: string | null;
  parent_label: { discogs_id: number | null; name: string | null };
  data_quality: string;
  /** Denormed aliases (no per-alias discogs_id in the slim shape) */
  aliases: string[];
  /**
   * @deprecated kept for backwards compat. Prefer `editorial.tier`.
   * Will be removed once the web client switches to reading from `editorial`.
   */
  tier: "tier1" | "denylist" | null;
  /** Full editorial metadata for the redesign. */
  editorial: LabelEditorial;
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
      .select([
        "tier",
        "palette",
        "blurb",
        "founded_year",
        "closed_year",
        "is_active",
        "location",
      ])
      .where("discogs_label_id", "=", discogsId)
      .executeTakeFirst(),
  ]);

  const tier = editorial?.tier ?? null;
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
    tier,
    editorial: {
      tier,
      palette: editorial?.palette ?? null,
      blurb: editorial?.blurb ?? null,
      founded_year: editorial?.founded_year ?? null,
      closed_year: editorial?.closed_year ?? null,
      is_active: editorial?.is_active ?? true,
      location: editorial?.location ?? null,
    },
    urls: urls.map((u) => u.url),
    provenance: { source: "discogs", dump_date: dumpDate, discogs_id: label.discogs_id },
  };
}
