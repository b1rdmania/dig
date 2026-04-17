import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

/**
 * Release retrieval — DEPRECATED in the slim master-first shape.
 *
 * `dig-db-scene` does NOT carry full release-level metadata (no
 * catalog.releases, release_artists, release_credits, tracks, etc.). The
 * only release surface is `catalog.release_shadow`, which carries the
 * minimum needed to render "Notable Versions" on the master page and to
 * link out to discogs.com.
 *
 * Behaviour during cutover (phase 4):
 *   - `getRelease()` always returns null. Existing /v1/releases/:id callers
 *     therefore get a clean 404 instead of a 500. The phase4-api task will
 *     replace this with an explicit 410 Gone + Location header.
 *   - `getReleaseShadow()` resolves a release_discogs_id to its master_id
 *     so the API/frontend can issue a 301 redirect to /master/:master_id.
 *
 * The full ReleaseDetail interface is retained so consumers that import
 * the type still typecheck — it'll be dropped in the same change that
 * removes the /v1/releases/* surface.
 */
export interface ReleaseDetail {
  discogs_id: number;
  title: string;
  country: string | null;
  release_year: number | null;
  released_raw: string | null;
  status: string;
  notes: string | null;
  data_quality: string;
  master_discogs_id: number | null;
  is_main_release: boolean | null;
  artists: Array<{ discogs_id: number; name: string; role: string | null; join_relation: string | null }>;
  labels: Array<{ discogs_id: number; name: string; catalog_number: string | null }>;
  formats: Array<{ name: string; qty: number | null; descriptions: string[] | null }>;
  genres: string[];
  styles: string[];
  tracks: Array<{
    position_raw: string | null;
    title: string | null;
    duration_seconds: number | null;
    disc: number | null;
    credits: Array<{ artist_discogs_id: number; artist_name: string; role: string | null }>;
  }>;
  credits: Array<{ artist_discogs_id: number; artist_name: string; role: string | null }>;
  identifiers: Array<{ type: string; value: string; description: string | null }>;
  companies: Array<{ discogs_id: number; name: string; entity_type: string | null }>;
  videos: Array<{ url: string; title: string | null; duration_seconds: number | null }>;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

/** @deprecated The slim shape carries no release detail. Always returns null. */
export async function getRelease(
  _db: Kysely<Database>,
  _discogsId: number,
  _batchId: string,
  _dumpDate: string,
): Promise<ReleaseDetail | null> {
  return null;
}

/** Minimal release info from catalog.release_shadow — drives 301 → /master/:id. */
export interface ReleaseShadow {
  release_discogs_id: number;
  master_discogs_id: number | null;
  title: string;
  release_year: number | null;
  country: string | null;
  label: string | null;
  format: string | null;
  is_main_release: boolean;
  has_tracklist_delta: boolean;
  has_remix_signal: boolean;
  discogs_url: string | null;
}

export async function getReleaseShadow(
  db: Kysely<Database>,
  discogsId: number,
): Promise<ReleaseShadow | null> {
  const row = await db
    .selectFrom("catalog.release_shadow")
    .select([
      "release_discogs_id",
      "master_discogs_id",
      "title",
      "release_year",
      "country",
      "label",
      "format",
      "is_main_release",
      "has_tracklist_delta",
      "has_remix_signal",
      "discogs_url",
    ])
    .where("release_discogs_id", "=", discogsId)
    .executeTakeFirst();

  return row ?? null;
}
