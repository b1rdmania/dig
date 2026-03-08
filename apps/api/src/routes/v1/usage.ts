import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { getUsageSnapshot, getUsageSnapshotInternal } from "../../metrics/usage.js";

export function registerUsageRoutes(app: FastifyInstance, _db: Kysely<Database>): void {
  app.get("/v1/usage", async (_req, reply) => {
    return reply.send(await getUsageSnapshot());
  });

  app.get("/v1/usage/internal", async (_req, reply) => {
    return reply.send(await getUsageSnapshotInternal());
  });
}
