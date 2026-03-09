/**
 * Discogs market snapshot — Phase 2.
 * Returns lowest listed price and items for sale for a release.
 *
 * Cache policy: 7-day TTL in Redis (key: market:{discogs_release_id}).
 * Fail-soft: returns { market: null } on any external error.
 *
 * Gated by MARKET_SNAPSHOT_ENABLED env var. Returns null until:
 * 1. MARKET_SNAPSHOT_ENABLED=true is set in Fly secrets.
 * 2. DISCOGS_API_KEY is set (requires a registered Discogs application).
 * 3. Discogs API terms confirmed for this display context.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";

const ENABLED = process.env.MARKET_SNAPSHOT_ENABLED === "true";
const DISCOGS_API_KEY = process.env.DISCOGS_API_KEY ?? "";
const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

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

  // TODO: implement Discogs OAuth or personal access token call
  // GET https://api.discogs.com/marketplace/price_suggestions/{release_id}
  // or GET https://api.discogs.com/releases/{release_id}/marketplace/stats
  // Requires: Authorization: Discogs token={DISCOGS_API_KEY}
  //
  // Implementation stub — returns null until Discogs API key + terms are confirmed.
  void releaseId;
  return null;
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
      const id = Number(req.params.discogs_id);
      if (!Number.isFinite(id) || id <= 0) {
        return reply.status(400).send({
          error: { code: "INVALID_REQUEST", message: "Invalid release ID", details: null },
        });
      }

      const market = await getMarket(redis, id).catch(() => null);
      return reply.send({ market: market ?? null });
    },
  );
}
