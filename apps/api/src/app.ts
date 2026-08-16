/**
 * Fastify app factory — used by both server.ts (production) and tests.
 * Separating app creation from listening allows Fastify inject in tests.
 *
 * Hardening:
 * - Two-tier rate limiting (RATE_LIMITS below is the single source of truth;
 *   docs/rate-limit-policy.md mirrors it): anonymous by IP, keyed by validated
 *   X-API-Key. Unknown keys are silently downgraded to the anonymous tier.
 * - Rate limiting always registers: Redis store when REDIS_URL is set,
 *   per-process in-memory store otherwise (fail closed, never disabled).
 * - Structured request logging on every response
 * - CORS for browser clients (open by default for the public read API;
 *   set CORS_ORIGINS to restrict)
 * - Health endpoint with timeout stats
 * - Consistent error format on all paths
 */
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import Redis from "ioredis";
import { MemoryCache } from "./memory-cache.js";
import { randomUUID } from "node:crypto";
import { createDb } from "@dig/db";
import { healthCheck, getTimeoutStats } from "@dig/domain";
import { validApiKey, rawApiKey, hasConfiguredKeys, isRateLimitExempt } from "./auth.js";
import { registerSearchRoutes } from "./routes/v1/search.js";
import { registerEntityRoutes } from "./routes/v1/entities.js";
import { registerTraversalRoutes } from "./routes/v1/traversal.js";
import { registerCoverRoutes } from "./routes/v1/covers.js";
import { registerEventRoutes } from "./routes/v1/events.js";
import { registerEnrichmentRoutes } from "./routes/v1/enrichment.js";
import { registerSeoRoutes } from "./routes/v1/seo.js";
import { registerUsageRoutes } from "./routes/v1/usage.js";
import { initUsagePersistence, recordApiRequest, shutdownUsagePersistence } from "./metrics/usage.js";
import { registerAskRoutes } from "./routes/v1/ask.js";
import { registerMarketRoutes } from "./routes/v1/market.js";
import { registerScenesRoutes } from "./routes/v1/scenes.js";

export interface AppDeps {
  databaseUrl: string;
  redisUrl?: string;
  enableRateLimit?: boolean;
}

// --- Rate-limit policy (single source of truth) ---
// Anonymous (by IP): 400 req/min — browsing an entity page fires a burst of
// fetches and the Ask Dig bag backfill adds ~50 more, so 180 pinched real
// single-user sessions. Keyed (validated X-API-Key): 1000 req/min — the
// dig-web SSR traffic rides this tier (all visitors share the web machine's
// egress IP, so it must never fall to the anonymous bucket).
// Keep docs/rate-limit-policy.md in sync.
export const RATE_LIMITS = {
  anonymous: 400,
  keyed: 1000,
} as const;

const RATE_WINDOW = "1 minute";

export async function buildApp(deps: AppDeps): Promise<{
  app: FastifyInstance;
  db: ReturnType<typeof createDb>;
}> {
  const app = Fastify({ logger: false });
  const db = createDb(deps.databaseUrl);
  initUsagePersistence(db);

  // --- CORS ---
  // Open by default: this is a public, credential-less read API consumed by
  // browsers and agents on arbitrary origins. Set CORS_ORIGINS (comma-
  // separated) to restrict to an allowlist.
  const corsOrigins = (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Anthropic-API-Key", "X-Request-Id"],
    exposedHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "X-Request-Id",
    ],
  });

  // --- Cache (cover + market). Redis only if REDIS_URL is set; otherwise a
  // bounded in-process cache. Redis is no longer required in production —
  // rate limiting is enforced at the Cloudflare edge (2026-08-16).
  const redis = deps.redisUrl ? new Redis(deps.redisUrl) : null;
  const cache = redis ?? new MemoryCache();

  // --- Rate limiting ---
  // Always registered (unless explicitly disabled for tests). Without Redis we
  // fall back to the plugin's per-process in-memory store rather than running
  // unthrottled — weaker across multiple machines, but fail-closed.
  if (deps.enableRateLimit !== false) {
    if (!redis) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        code: "RATE_LIMIT_MEMORY_STORE",
        message: "REDIS_URL not set — rate limiting uses per-process in-memory store (edge limit is Cloudflare)",
      }));
    }
    if (!hasConfiguredKeys()) {
      console.warn(JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        code: "API_KEYS_NOT_CONFIGURED",
        message: "API_KEYS not set — all requests are treated as anonymous tier",
      }));
    }
    await app.register(rateLimit, {
      max: (req: FastifyRequest) =>
        validApiKey(req) ? RATE_LIMITS.keyed : RATE_LIMITS.anonymous,
      timeWindow: RATE_WINDOW,
      ...(redis ? { redis } : {}),
      // Exempt keys (RATE_LIMIT_EXEMPT_KEYS) skip the store entirely — see auth.ts.
      allowList: (req: FastifyRequest) => isRateLimitExempt(req),
      // Unknown/absent keys bucket by IP — otherwise an attacker could mint a
      // fresh bucket per request by rotating bogus key values.
      keyGenerator: (req: FastifyRequest) => validApiKey(req) ?? req.ip,
      addHeadersOnExceeding: {
        "x-ratelimit-limit": true,
        "x-ratelimit-remaining": true,
        "x-ratelimit-reset": true,
      },
      addHeaders: {
        "x-ratelimit-limit": true,
        "x-ratelimit-remaining": true,
        "x-ratelimit-reset": true,
        "retry-after": true,
      },
    });
  }

  // --- Request ID ---
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const requestId = (req.headers["x-request-id"] as string) || randomUUID();
    (req as any).requestId = requestId;
    reply.header("X-Request-Id", requestId);
  });

  // --- Structured request logging ---
  app.addHook("onResponse", async (req: FastifyRequest, reply: FastifyReply) => {
    const elapsed = reply.elapsedTime;
    const route = req.routeOptions?.url ?? req.url;
    const status = reply.statusCode;
    const requestId = (req as any).requestId ?? "-";
    const apiKey = rawApiKey(req);
    const apiKeyValid = apiKey ? validApiKey(req) !== undefined : null;

    // Categorize route for monitoring
    let category = "other";
    if (route.includes("/events")) category = "telemetry";
    else if (route.includes("/search")) category = "search";
    else if (route.includes("/health")) category = "health";
    else if (route.includes("/release_shadow")) category = "retrieval";
    else if (route.includes("/cover")) category = "retrieval";
    else if (route.includes("/market")) category = "retrieval";
    else if (route.includes("/masters") || route.includes("/artists") || route.includes("/labels") || route.includes("/releases")) {
      category = route.includes("/:discogs_id/") ? "traversal" : "retrieval";
    }

    // Structured log line — parseable by Fly logs, grep, or future log aggregator
    console.log(JSON.stringify({
      ts: new Date().toISOString(),
      req_id: requestId,
      method: req.method,
      route,
      status,
      elapsed_ms: Math.round(elapsed),
      category,
      ip: req.ip,
      api_key: apiKey ? apiKey.slice(0, 8) + "..." : null,
      api_key_valid: apiKeyValid,
    }));

    recordApiRequest({
      category: category as "search" | "retrieval" | "traversal" | "telemetry" | "health" | "other",
      route,
      status,
      elapsedMs: Math.round(elapsed),
    });
  });

  // --- Global error handler ---
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests",
          details: { retry_after: 60 },
        },
      });
    }

    // DB connection pool exhausted — pg-pool throws when connectionTimeoutMillis
    // expires with no available connection. Return 503 QUERY_TIMEOUT so callers
    // can distinguish infrastructure saturation from a code error.
    const isPoolExhaustion = error.message?.includes("timeout exceeded when trying to connect");
    if (isPoolExhaustion) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        code: "POOL_EXHAUSTION",
        message: error.message,
      }));
      return reply.status(503).send({
        error: {
          code: "QUERY_TIMEOUT",
          message: "Database connection pool exhausted — try again shortly",
          details: null,
        },
      });
    }

    const status = error.statusCode ?? 500;
    if (status >= 500) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        code: "INTERNAL_ERROR",
        message: error.message,
        stack: error.stack,
      }));
    }
    return reply.status(status).send({
      error: {
        code: status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST",
        message: status >= 500 ? "Internal server error" : error.message,
        details: null,
      },
    });
  });

  // --- Health endpoint ---
  app.get("/v1/health", async (_req, reply) => {
    const status = await healthCheck(db);
    const timeoutStats = getTimeoutStats();
    const httpStatus = status.status === "ok" ? 200 : 503;
    return reply.status(httpStatus).send({
      ...status,
      timeout_stats: timeoutStats,
    });
  });

  // --- Phase 2/3 routes ---
  registerSearchRoutes(app, db);
  registerEntityRoutes(app, db);
  registerTraversalRoutes(app, db);
  registerCoverRoutes(app, db, cache);
  registerEventRoutes(app);
  registerEnrichmentRoutes(app, db);
  registerSeoRoutes(app, db);
  registerUsageRoutes(app, db);
  registerAskRoutes(app, db);
  registerMarketRoutes(app, cache);
  registerScenesRoutes(app, db);

  app.addHook("onClose", async () => {
    await shutdownUsagePersistence();
  });

  return { app, db };
}
