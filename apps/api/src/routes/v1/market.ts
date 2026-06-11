/**
 * Discogs market snapshot — Phase 2.
 * Returns lowest listed price and items for sale for a release.
 *
 * Data source: GET https://api.discogs.com/marketplace/stats/{release_id}
 * Auth: personal access token via Authorization: Discogs token={key}
 * Rate limit: 240 req/min with token (we stay well within via 7-day cache).
 *
 * Cache policy: 7-day TTL in Redis (key: market:{discogs_release_id}).
 * Fail-soft: returns { market: null } on any external error.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { parseDiscogsId } from "./util.js";

const ENABLED = process.env.MARKET_SNAPSHOT_ENABLED === "true";
const DISCOGS_API_KEY = process.env.DISCOGS_API_KEY ?? "";
const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days
const FETCH_TIMEOUT_MS = 3000;

export interface MarketSnapshot {
  lowest_price: number | null;
  num_for_sale: number | null;
  last_sold_price: number | null;
  currency: string;
  fetched_at: string;
  source: "discogs_marketplace";
}

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: string, ttl: number): Promise<unknown>;
};

async function fetchFromDiscogs(releaseId: number): Promise<MarketSnapshot | null> {
  if (!DISCOGS_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://api.discogs.com/marketplace/stats/${releaseId}`,
      {
        headers: {
          Authorization: `Discogs token=${DISCOGS_API_KEY}`,
          "User-Agent": "DigBaby/1.0 +https://dig.baby",
        },
        signal: controller.signal,
      },
    );

    if (!res.ok) return null;

    const data = await res.json() as {
      lowest_price?: { value?: number; currency?: string } | null;
      num_for_sale?: number | null;
      blocked_from_sale?: boolean;
    };

    // Blocked listings are not shown
    if (data.blocked_from_sale) return null;

    return {
      lowest_price: data.lowest_price?.value ?? null,
      num_for_sale: data.num_for_sale ?? null,
      last_sold_price: null, // not available via this endpoint
      currency: data.lowest_price?.currency ?? "USD",
      fetched_at: new Date().toISOString(),
      source: "discogs_marketplace",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getMarket(
  redis: RedisLike | null,
  releaseId: number,
): Promise<MarketSnapshot | null> {
  if (!ENABLED) return null;

  const cacheKey = `market:${releaseId}`;

  // Cache read
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached === "__none__") return null;
      if (cached) return JSON.parse(cached) as MarketSnapshot;
    } catch { /* fail open */ }
  }

  // External fetch
  const snapshot = await fetchFromDiscogs(releaseId).catch(() => null);

  // Cache write (store __none__ sentinel on miss so we don't hammer the API)
  if (redis) {
    try {
      const value = snapshot ? JSON.stringify(snapshot) : "__none__";
      await redis.set(cacheKey, value, "EX", CACHE_TTL);
    } catch { /* fail open */ }
  }

  return snapshot;
}

export function registerMarketRoutes(
  app: FastifyInstance,
  redis: RedisLike | null,
): void {
  app.get(
    "/v1/releases/:discogs_id/market",
    async (req: FastifyRequest<{ Params: { discogs_id: string } }>, reply) => {
      const id = parseDiscogsId(req.params.discogs_id);
      if (!id) {
        return reply.status(400).send({
          error: { code: "INVALID_REQUEST", message: "Invalid release ID", details: null },
        });
      }

      const market = await getMarket(redis, id).catch(() => null);
      return reply.send({ market: market ?? null });
    },
  );
}
