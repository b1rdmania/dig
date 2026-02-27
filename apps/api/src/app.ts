/**
 * Fastify app factory — used by both server.ts (production) and tests.
 * Separating app creation from listening allows Fastify inject in tests.
 */
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import { createDb } from "@dig/db";
import { healthCheck } from "@dig/domain";
import { registerSearchRoutes } from "./routes/v1/search.js";
import { registerEntityRoutes } from "./routes/v1/entities.js";
import { registerTraversalRoutes } from "./routes/v1/traversal.js";

export interface AppDeps {
  databaseUrl: string;
  redisUrl?: string;
  enableRateLimit?: boolean;
}

export async function buildApp(deps: AppDeps): Promise<{
  app: FastifyInstance;
  db: ReturnType<typeof createDb>;
}> {
  const app = Fastify({ logger: false });
  const db = createDb(deps.databaseUrl);

  if (deps.enableRateLimit !== false && deps.redisUrl) {
    const redis = new Redis(deps.redisUrl);
    await app.register(rateLimit, {
      max: 100,
      timeWindow: "1 minute",
      redis,
      keyGenerator: (req) => req.ip,
    });
  }

  // Global error handler for consistent error format
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: { code: "RATE_LIMITED", message: "Too many requests", details: { retry_after: 60 } },
      });
    }
    const status = error.statusCode ?? 500;
    return reply.status(status).send({
      error: {
        code: status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST",
        message: error.message,
        details: null,
      },
    });
  });

  // Health
  app.get("/v1/health", async (_req, reply) => {
    const status = await healthCheck(db);
    const httpStatus = status.status === "ok" ? 200 : 503;
    return reply.status(httpStatus).send(status);
  });

  // Phase 2 routes
  registerSearchRoutes(app, db);
  registerEntityRoutes(app, db);
  registerTraversalRoutes(app, db);

  return { app, db };
}
