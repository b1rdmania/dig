/**
 * Per-IP throttle for server-rendered entity pages.
 *
 * Every /artist, /label, /master, /scene and /search render fans out into
 * several dig-api calls. A crawler walking entity IDs is the one traffic shape
 * that has actually taken the site down (2026-08-07 wedge; 2026-08-16 OOM kill
 * plus a $150/mo Upstash projection). robots.txt is advisory; this is not.
 *
 * Fixed window, in-process, per machine — deliberately dumb. Humans do not
 * open 60 entity pages a minute; crawlers that hit 429 with Retry-After back
 * off (Google and Bing treat 429 as "slow down", not "gone").
 */

export const THROTTLED_PREFIXES = ["/artist/", "/label/", "/master/", "/scene/", "/search"];
export const LIMIT_PER_WINDOW = 60;
export const WINDOW_MS = 60_000;
const MAX_TRACKED_IPS = 20_000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function isThrottledPath(pathname: string): boolean {
  return THROTTLED_PREFIXES.some((p) => pathname.startsWith(p));
}

export type ThrottleResult = { allowed: true } | { allowed: false; retryAfterSec: number };

/** Records a hit for `ip` and reports whether it is over the limit. */
export function hit(ip: string, now: number = Date.now()): ThrottleResult {
  let b = buckets.get(ip);
  if (!b || now >= b.resetAt) {
    if (buckets.size >= MAX_TRACKED_IPS) prune(now);
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, b);
  }
  b.count += 1;
  if (b.count > LIMIT_PER_WINDOW) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { allowed: true };
}

function prune(now: number): void {
  for (const [ip, b] of buckets) if (now >= b.resetAt) buckets.delete(ip);
  // Still full of live buckets (a distributed crawl)? Drop the oldest half.
  if (buckets.size >= MAX_TRACKED_IPS) {
    let n = Math.floor(buckets.size / 2);
    for (const ip of buckets.keys()) {
      if (n-- <= 0) break;
      buckets.delete(ip);
    }
  }
}

/** Test hook. */
export function resetThrottle(): void {
  buckets.clear();
}
