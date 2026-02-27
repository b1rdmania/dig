import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { getArtist, getLabel, getMaster, getRelease } from "@dig/domain";

async function getBatchInfo(db: Kysely<Database>): Promise<{ batchId: string; dumpDate: string }> {
  const batch = await db
    .selectFrom("ingest.dump_batches" as any)
    .select(["id", "dump_date"] as any[])
    .where("status" as any, "in", ["active", "qa"])
    .orderBy("created_at" as any, "desc")
    .executeTakeFirstOrThrow();
  return { batchId: (batch as any).id, dumpDate: (batch as any).dump_date };
}

function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 ? null : id;
}

export function registerEntityRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/artists/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getBatchInfo(db);
    const artist = await getArtist(db, discogsId, batchId, dumpDate);
    if (!artist) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Artist ${discogsId} not found`, details: null },
      });
    }
    return reply.send({ artist });
  });

  app.get("/v1/labels/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getBatchInfo(db);
    const label = await getLabel(db, discogsId, batchId, dumpDate);
    if (!label) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Label ${discogsId} not found`, details: null },
      });
    }
    return reply.send({ label });
  });

  app.get("/v1/masters/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getBatchInfo(db);
    const master = await getMaster(db, discogsId, batchId, dumpDate);
    if (!master) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Master ${discogsId} not found`, details: null },
      });
    }
    return reply.send({ master });
  });

  app.get("/v1/releases/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getBatchInfo(db);
    const release = await getRelease(db, discogsId, batchId, dumpDate);
    if (!release) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Release ${discogsId} not found`, details: null },
      });
    }
    return reply.send({ release });
  });
}
