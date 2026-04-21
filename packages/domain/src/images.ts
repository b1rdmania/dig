/**
 * Entity image lookups.
 *
 * Reads enrich.entity_images, populated by scripts/harvest-entity-images.ts
 * (Wikidata SPARQL → P18/P154 → Special:FilePath URLs).
 *
 * The proxy/cover-art pattern stays in apps/api/routes/v1/images.ts; this
 * module is purely DB lookup + URL shaping (Wikimedia Commons supports
 * `?width=NNN` for in-flight thumbnailing — we expose helpers for it so
 * callers can request, e.g., a 1200px hero or a 256px avatar without
 * needing their own image pipeline).
 */

import { type Kysely, sql } from "kysely";
import type { Database } from "@dig/db";

export type ImageKind = "logo" | "photo" | "hero";
export type ImageEntityType = "label" | "artist";

export interface EntityImage {
  kind: ImageKind;
  source: string;
  source_id: string | null;
  source_url: string;
  /** Pre-shaped URL with thumb width applied where supported. */
  url: string;
  attribution: string | null;
  license: string | null;
}

export interface EntityImagesResponse {
  entity_type: ImageEntityType;
  discogs_id: number;
  images: EntityImage[];
}

/**
 * Convert a raw Special:FilePath URL into a shaped one with `width`.
 *
 * Wikimedia auto-thumbnails when the `width` query string is present and the
 * underlying file is a raster format (jpg/png). For SVG it scales losslessly.
 *
 * If the URL isn't a Commons FilePath, we return it as-is.
 */
export function shapeCommonsUrl(rawUrl: string, width: number | null): string {
  if (!rawUrl) return rawUrl;
  // Wikidata returns http:// URLs; force https:// to avoid mixed-content
  // warnings when our app is served over https://. Commons supports both.
  let url = rawUrl.startsWith("http://") ? `https://${rawUrl.slice(7)}` : rawUrl;
  if (!width || width <= 0) return url;
  if (!url.includes("commons.wikimedia.org/wiki/Special:FilePath/")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}width=${Math.round(width)}`;
}

/**
 * Get all image rows for a single entity, optionally filtered by kind.
 *
 * If `width` is provided, the returned `url` is shaped for that pixel
 * width (helpful for hero-vs-avatar contexts on the same entity).
 */
export async function getEntityImages(
  db: Kysely<Database>,
  entityType: ImageEntityType,
  discogsId: number,
  opts: { kind?: ImageKind | null; width?: number | null } = {},
): Promise<EntityImagesResponse> {
  const kind = opts.kind ?? null;
  const width = opts.width ?? null;

  const { rows } = await sql<{
    image_kind: ImageKind;
    source: string;
    source_id: string | null;
    source_url: string;
    attribution: string | null;
    license: string | null;
  }>`
    SELECT image_kind, source, source_id, source_url, attribution, license
    FROM enrich.entity_images
    WHERE entity_type = ${entityType}
      AND discogs_id  = ${discogsId}
      ${kind ? sql`AND image_kind = ${kind}` : sql``}
    ORDER BY
      -- Hand-curated overrides win over machine-harvested rows. We seed
      -- source='manual' rows for entities whose Wikidata entry has no P18
      -- (the scene genuinely lacks those assets) and pick them here.
      CASE source WHEN 'manual' THEN 0 ELSE 1 END,
      CASE image_kind
        WHEN 'logo'  THEN 1
        WHEN 'photo' THEN 2
        WHEN 'hero'  THEN 3
        ELSE 4
      END
  `.execute(db);

  return {
    entity_type: entityType,
    discogs_id: discogsId,
    images: rows.map((r) => ({
      kind: r.image_kind,
      source: r.source,
      source_id: r.source_id,
      source_url: r.source_url,
      url: shapeCommonsUrl(r.source_url, width),
      attribution: r.attribution,
      license: r.license,
    })),
  };
}

/**
 * Bulk lookup — used by list pages (label index, scene wall, etc.) so we
 * don't N+1 single-image queries. Returns a map keyed by discogs_id.
 */
export async function getEntityImagesBulk(
  db: Kysely<Database>,
  entityType: ImageEntityType,
  discogsIds: number[],
  opts: { kind?: ImageKind | null; width?: number | null } = {},
): Promise<Map<number, EntityImage[]>> {
  if (discogsIds.length === 0) return new Map();
  const kind = opts.kind ?? null;
  const width = opts.width ?? null;

  const { rows } = await sql<{
    discogs_id: number;
    image_kind: ImageKind;
    source: string;
    source_id: string | null;
    source_url: string;
    attribution: string | null;
    license: string | null;
  }>`
    SELECT discogs_id, image_kind, source, source_id, source_url, attribution, license
    FROM enrich.entity_images
    WHERE entity_type = ${entityType}
      AND discogs_id = ANY(${discogsIds})
      ${kind ? sql`AND image_kind = ${kind}` : sql``}
  `.execute(db);

  const map = new Map<number, EntityImage[]>();
  for (const r of rows) {
    const arr = map.get(r.discogs_id) ?? [];
    arr.push({
      kind: r.image_kind,
      source: r.source,
      source_id: r.source_id,
      source_url: r.source_url,
      url: shapeCommonsUrl(r.source_url, width),
      attribution: r.attribution,
      license: r.license,
    });
    map.set(r.discogs_id, arr);
  }
  return map;
}
