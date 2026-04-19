/**
 * Migration 032: enrich.entity_images.
 *
 * Stores resolved image URLs (logos, photos, hero shots) for labels and
 * artists. Sources are external (Wikidata Commons via P18/P154,
 * MusicBrainz "image" relations) — we cache URL + attribution but do
 * NOT store the binary blobs (the API proxies through Cover Art Archive
 * for releases; same shape applies here, with a Redis cache layer).
 *
 * Key columns:
 *   - entity_type   ('label' | 'artist')
 *   - discogs_id    Discogs entity id (FK-shaped, no constraint to keep
 *                   harvester writes cheap)
 *   - image_kind    ('logo' | 'photo' | 'hero')
 *                   logo  = label/group mark (P154)
 *                   photo = portrait / band photo (P18 on Wikidata,
 *                           "image" relation on MusicBrainz)
 *                   hero  = wide/landscape variant for page background
 *   - source        ('wikidata' | 'musicbrainz' | 'manual' | ...)
 *   - source_id     Wikidata QID, MBID, or null for manual
 *   - source_url    Original URL (Special:FilePath on Commons, etc.)
 *                   Always store this; it is the canonical reference
 *                   the proxy resolves against.
 *   - file_url      Optional CDN/proxied URL (we may populate later)
 *   - width/height  Pixel dimensions when known (Wikidata returns these
 *                   in iiprop; null otherwise)
 *   - attribution   Human-readable credit, e.g. "Photo by X, CC BY-SA 4.0
 *                   via Wikimedia Commons"
 *   - license       SPDX-ish identifier ('CC0-1.0', 'CC-BY-SA-4.0',
 *                   'CC-BY-3.0', 'public-domain', 'fair-use', etc.)
 *
 * Uniqueness: one image per (entity_type, discogs_id, image_kind).
 * The harvester uses ON CONFLICT to upsert when re-fetching.
 *
 * Down: drops the table.
 */
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.entity_images (
      id            BIGSERIAL   PRIMARY KEY,
      entity_type   TEXT        NOT NULL CHECK (entity_type IN ('label', 'artist')),
      discogs_id    INTEGER     NOT NULL,
      image_kind    TEXT        NOT NULL CHECK (image_kind IN ('logo', 'photo', 'hero')),
      source        TEXT        NOT NULL,
      source_id     TEXT,
      source_url    TEXT        NOT NULL,
      file_url      TEXT,
      width         INTEGER,
      height        INTEGER,
      attribution   TEXT,
      license       TEXT,
      fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_images
      ON enrich.entity_images (entity_type, discogs_id, image_kind)
  `.execute(db);

  // Lookup by entity (covers both label + artist page reads)
  await sql`
    CREATE INDEX IF NOT EXISTS idx_entity_images_entity
      ON enrich.entity_images (entity_type, discogs_id)
  `.execute(db);

  // Source provenance lookups (e.g. "find all images sourced from QID X")
  await sql`
    CREATE INDEX IF NOT EXISTS idx_entity_images_source
      ON enrich.entity_images (source, source_id)
      WHERE source_id IS NOT NULL
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.entity_images IS
      'Resolved image URLs (logos, photos, hero) for labels and artists. Sourced from Wikidata Commons (P18/P154) and MusicBrainz image relations. Stores URL + attribution; binary content is fetched on demand via the API image proxy with Redis caching.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.entity_images`.execute(db);
}
