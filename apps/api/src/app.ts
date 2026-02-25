/**
 * Fastify app factory — used by both server.ts (production) and tests.
 * Separating app creation from listening allows Fastify inject in tests.
 */
import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import { createDb } from "@dig/db";
import { healthCheck } from "@dig/domain";

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

  app.get("/v1/health", async (_req, reply) => {
    const status = await healthCheck(db);
    const httpStatus = status.status === "ok" ? 200 : 503;
    return reply.status(httpStatus).send(status);
  });

  return { app, db };
}
