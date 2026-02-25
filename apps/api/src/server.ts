import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import Redis from "ioredis";
import { createDb } from "@dig/db";
import { healthCheck } from "@dig/domain";

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const app = Fastify({ logger: true });
const db = createDb(databaseUrl);
const redis = new Redis(redisUrl);

// Rate limiting (IP-based for now, API key path designed but not enforced)
await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute",
  redis,
  keyGenerator: (req) => {
    // Future: read API key from header, fall back to IP
    return req.ip;
  },
});

// --- Routes ---

app.get("/v1/health", async (_req, reply) => {
  const status = await healthCheck(db);
  const httpStatus = status.status === "ok" ? 200 : 503;
  return reply.status(httpStatus).send(status);
});

// --- Start ---

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
