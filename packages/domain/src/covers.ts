/**
 * Cover art resolution service.
 *
 * Resolves cover art URLs for Discogs releases by:
 *   1. Checking Redis cache
 *   2. Looking up MBID in enrich.release_crosswalks
 *   3. Checking Cover Art Archive for the image
 *   4. Caching the result (URL or "none" sentinel)
 *
 * The proxy design lets us add Discogs API images later behind the
 * same interface if/when we get a commercial license.
 */

import { type Kysely, sql } from "kysely";
import type { Database } from "@dig/db";

const CAA_BASE = "https://coverartarchive.org";
const CACHE_PREFIX = "cover:";
const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const CACHE_NONE = "__none__";
const FETCH_TIMEOUT = 5000;

export interface CoverResult {
  url: string | null;
  source: "caa" | "placeholder";
  mbid: string | null;
}

/**
 * Resolve cover art URL for a Discogs release.
 *
 * @param db - Kysely database instance
 * @param redis - ioredis instance (or null to skip cache)
 * @param discogsId - Discogs release ID
 */
export async function getCoverUrl(
  db: Kysely<Database>,
  redis: { get(k: string): Promise<string | null>; set(k: string, v: string, ex: string, t: number): Promise<unknown> } | null,
  discogsId: number,
): Promise<CoverResult> {
  const cacheKey = `${CACHE_PREFIX}${discogsId}`;

  // 1. Check Redis cache
  if (redis) {
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached === CACHE_NONE) {
      return { url: null, source: "placeholder", mbid: null };
    }
    if (cached) {
      // cached value is "mbid|url"
      const sep = cached.indexOf("|");
      return {
        url: cached.slice(sep + 1),
        source: "caa",
        mbid: cached.slice(0, sep),
      };
    }
  }

  // 2. Look up MBID from crosswalk
  const { rows } = await sql<{ mbid: string | null }>`
    SELECT mbid FROM enrich.release_crosswalks
    WHERE discogs_release_id = ${discogsId}
    LIMIT 1
  `.execute(db);

  const mbid = rows[0]?.mbid ?? null;

  if (!mbid) {
    if (redis) await redis.set(cacheKey, CACHE_NONE, "EX", CACHE_TTL).catch(() => {});
    return { url: null, source: "placeholder", mbid: null };
  }

  // 3. Check Cover Art Archive (HEAD request to get redirect URL)
  const caaUrl = `${CAA_BASE}/release/${mbid}/front-500`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const res = await fetch(caaUrl, {
      method: "HEAD",
      redirect: "manual", // Don't follow — we want the Location header
      signal: controller.signal,
      headers: { "User-Agent": "Dig/1.0 (https://dig.baby)" },
    });
    clearTimeout(timeout);

    if (res.status === 307 || res.status === 302) {
      const imageUrl = res.headers.get("location");
      if (imageUrl) {
        if (redis) {
          await redis.set(cacheKey, `${mbid}|${imageUrl}`, "EX", CACHE_TTL).catch(() => {});
        }
        return { url: imageUrl, source: "caa", mbid };
      }
    }

    // 404 or other — no cover art
    if (redis) await redis.set(cacheKey, CACHE_NONE, "EX", CACHE_TTL).catch(() => {});
    return { url: null, source: "placeholder", mbid };
  } catch {
    // Network error, timeout — don't cache failures, let next request retry
    return { url: null, source: "placeholder", mbid };
  }
}
