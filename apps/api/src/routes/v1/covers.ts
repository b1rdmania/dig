import type { FastifyInstance } from "fastify";
import type { Kysely, Database } from "@dig/db";
import { getCoverUrl } from "@dig/domain";

function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 ? null : id;
}

export function registerCoverRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  redis: { get(k: string): Promise<string | null>; set(k: string, v: string, ex: string, t: number): Promise<unknown> } | null,
) {
  app.get("/v1/releases/:discogs_id/cover", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }

    const result = await getCoverUrl(db, redis, discogsId);
    return reply.send({ cover: result });
  });
}
