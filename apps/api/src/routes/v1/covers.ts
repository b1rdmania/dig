import type { FastifyInstance } from "fastify";
import type { Kysely, Database } from "@dig/db";
import { getCoverUrl, getLabelSleeves, getBatchForTable } from "@dig/domain";

const PG_INT4_MAX = 2_147_483_647;

function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 || id > PG_INT4_MAX ? null : id;
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

  app.get("/v1/labels/:discogs_id/sleeves", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId } = await getBatchForTable(db, "catalog.masters");
    const sleeves = await getLabelSleeves(db, redis, discogsId, batchId);
    return reply.send({ sleeves });
  });
}
