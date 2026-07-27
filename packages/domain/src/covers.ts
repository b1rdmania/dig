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
import { YOUTUBE_ID_RE } from "./scenes.js";

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

// ---------------------------------------------------------------------------
// getLabelSleeves — a wall of real cover art for a label
// ---------------------------------------------------------------------------

export interface LabelSleeve {
  master_discogs_id: number;
  cover_url: string;
}

type RedisLike = {
  get(k: string): Promise<string | null>;
  set(k: string, v: string, ex: string, t: number): Promise<unknown>;
} | null;

/**
 * Resolve up to `want` sleeve images for a label's top masters — core-run
 * entries first, then by scene weight. Covers come from the Cover Art
 * Archive via the existing per-release resolver (Redis-cached), falling
 * back to the master's first YouTube still (vinyl rips are almost always
 * shot of the sleeve). Nothing comes from Discogs, so the wall stays
 * inside their ToS. Masters with neither drop out.
 */
export async function getLabelSleeves(
  db: Kysely<Database>,
  redis: RedisLike,
  labelId: number,
  batchId: string,
  want: number = 12,
): Promise<LabelSleeve[]> {
  const candidates = await sql<{
    discogs_id: number;
    main_release_discogs_id: number;
  }>`
    SELECT m.discogs_id, m.main_release_discogs_id
    FROM catalog.masters m
    LEFT JOIN enrich.label_core_run cr
      ON cr.master_discogs_id = m.discogs_id
     AND cr.discogs_label_id = ${labelId}
    WHERE m.primary_label_discogs_id = ${labelId}
      AND m.batch_id = ${batchId}
      AND m.main_release_discogs_id IS NOT NULL
    ORDER BY (cr.rank IS NULL) ASC, cr.rank ASC, m.scene_weight DESC, m.year ASC NULLS LAST
    LIMIT ${Math.max(want * 3, 24)}
  `.execute(db);

  // Video-still fallbacks for every candidate in one query.
  const thumbById = new Map<number, string>();
  if (candidates.rows.length > 0) {
    const vids = await sql<{ master_discogs_id: number; url: string }>`
      SELECT DISTINCT ON (v.master_discogs_id) v.master_discogs_id, v.url
      FROM catalog.master_videos_unified v
      WHERE v.master_discogs_id = ANY(${candidates.rows.map((c) => c.discogs_id)}::int[])
        AND (v.url LIKE '%youtube.com%' OR v.url LIKE '%youtu.be%')
      ORDER BY v.master_discogs_id, v.id ASC
    `.execute(db);
    for (const v of vids.rows) {
      const m = YOUTUBE_ID_RE.exec(v.url);
      if (m) thumbById.set(v.master_discogs_id, `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg`);
    }
  }

  const sleeves: LabelSleeve[] = [];
  const BATCH = 8;
  for (let i = 0; i < candidates.rows.length && sleeves.length < want; i += BATCH) {
    const batch = candidates.rows.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (c) => ({
        master_discogs_id: c.discogs_id,
        cover: await getCoverUrl(db, redis, c.main_release_discogs_id),
      })),
    );
    for (const r of results) {
      if (r.status !== "fulfilled" || sleeves.length >= want) continue;
      const url = r.value.cover.url ?? thumbById.get(r.value.master_discogs_id) ?? null;
      if (url) {
        sleeves.push({ master_discogs_id: r.value.master_discogs_id, cover_url: url });
      }
    }
  }
  return sleeves;
}
