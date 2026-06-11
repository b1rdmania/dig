import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { getUsageSnapshot, getUsageSnapshotInternal } from "../../metrics/usage.js";
import { validApiKey, unauthorizedBody } from "../../auth.js";

export function registerUsageRoutes(app: FastifyInstance, _db: Kysely<Database>): void {
  app.get("/v1/usage", async (_req, reply) => {
    return reply.send(await getUsageSnapshot());
  });

  // Internal per-route breakdown — ops only, requires a valid API key.
  app.get("/v1/usage/internal", async (req, reply) => {
    if (!validApiKey(req)) {
      return reply.status(401).send(unauthorizedBody);
    }
    return reply.send(await getUsageSnapshotInternal());
  });
}
