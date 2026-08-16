/**
 * In-process TTL cache with the slice of the ioredis surface this app uses
 * (get / set-with-EX). Replaces Upstash Redis (2026-08-16): the only Redis
 * consumers were the cover-URL cache, the market snapshot cache, and the
 * rate-limit store — and rate limiting now happens at the Cloudflare edge.
 *
 * Per machine, not shared; that is fine for a read-through cache in front of
 * Cover Art Archive. Bounded so a crawl can't turn it into an OOM.
 */
export type CacheLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: string, ttlSeconds: number): Promise<unknown>;
};

type Entry = { value: string; expiresAt: number };

export class MemoryCache implements CacheLike {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly maxEntries = 50_000, private readonly now: () => number = Date.now) {}

  async get(key: string): Promise<string | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expiresAt <= this.now()) {
      this.map.delete(key);
      return null;
    }
    // Refresh insertion order so eviction is least-recently-used.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  async set(key: string, value: string, _ex: string, ttlSeconds: number): Promise<"OK"> {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    return "OK";
  }

  get size(): number {
    return this.map.size;
  }
}
