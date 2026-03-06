import type { FastifyInstance } from "fastify";
import { getUsageSnapshot, getUsageSnapshotInternal } from "../../metrics/usage.js";

export function registerUsageRoutes(app: FastifyInstance): void {
  app.get("/v1/usage", async (_req, reply) => {
    return reply.send(getUsageSnapshot());
  });

  app.get("/v1/usage/internal", async (_req, reply) => {
    return reply.send(getUsageSnapshotInternal());
  });
}
