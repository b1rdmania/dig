/**
 * Fastify app factory — used by both server.ts (production) and tests.
 * Separating app creation from listening allows Fastify inject in tests.
 *
 * Phase 3 hardening:
 * - Two-tier rate limiting: anonymous (60/min) + API key (300/min)
 * - Structured request logging on every response
 * - CORS for browser clients
 * - Health endpoint with timeout stats
 * - Consistent error format on all paths
 */
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import rateLimit from "@fastify/rate-limit";
import cors from "@fastify/cors";
import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { createDb } from "@dig/db";
import { healthCheck, getTimeoutStats } from "@dig/domain";
import { registerSearchRoutes } from "./routes/v1/search.js";
import { registerEntityRoutes } from "./routes/v1/entities.js";
import { registerTraversalRoutes } from "./routes/v1/traversal.js";

export interface AppDeps {
  databaseUrl: string;
  redisUrl?: string;
  enableRateLimit?: boolean;
}

// --- Rate-limit policy ---
// Anonymous (by IP): 60 req/min
// Keyed (X-API-Key header): 300 req/min
// These are alpha values — will be adjusted based on production traffic patterns.
const ANON_RATE_LIMIT = 60;
const KEYED_RATE_LIMIT = 300;
const RATE_WINDOW = "1 minute";

function getApiKey(req: FastifyRequest): string | undefined {
  const header = req.headers["x-api-key"];
  return typeof header === "string" && header.length > 0 ? header : undefined;
}

export async function buildApp(deps: AppDeps): Promise<{
  app: FastifyInstance;
  db: ReturnType<typeof createDb>;
}> {
  const app = Fastify({ logger: false });
  const db = createDb(deps.databaseUrl);

  // --- CORS ---
  await app.register(cors, {
    origin: true,
    methods: ["GET", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key"],
    exposedHeaders: [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
      "X-Request-Id",
    ],
  });

  // --- Rate limiting ---
  if (deps.enableRateLimit !== false && deps.redisUrl) {
    const redis = new Redis(deps.redisUrl);
    await app.register(rateLimit, {
      max: (req: FastifyRequest) => getApiKey(req) ? KEYED_RATE_LIMIT : ANON_RATE_LIMIT,
      timeWindow: RATE_WINDOW,
      redis,
      keyGenerator: (req: FastifyRequest) => getApiKey(req) ?? req.ip,
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
    const apiKey = getApiKey(req);

    // Categorize route for monitoring
    let category = "other";
    if (route.includes("/search")) category = "search";
    else if (route.includes("/health")) category = "health";
    else if (route.includes("/credits")) category = "traversal";
    else if (route.includes("/releases") || route.includes("/masters")) {
      category = route.includes("/:discogs_id/") ? "traversal" : "retrieval";
    } else if (route.includes("/artists") || route.includes("/labels")) {
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
    }));
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

  return { app, db };
}
