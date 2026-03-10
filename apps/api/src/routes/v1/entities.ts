import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { sql } from "@dig/db";
import { getArtist, getLabel, getMaster, getRelease, getBatchForTable } from "@dig/domain";

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
    const { batchId, dumpDate } = await getBatchForTable(db, "catalog.artists");
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
    const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
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
    const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
    // Transaction so SET LOCAL statement_timeout is scoped to this query only.
    const master = await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL statement_timeout = '12000'`.execute(trx);
      return getMaster(trx, discogsId, batchId, dumpDate);
    });
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
    const { batchId, dumpDate } = await getBatchForTable(db, "catalog.releases");
    // Transaction so SET LOCAL statement_timeout is scoped to this query only.
    const release = await db.transaction().execute(async (trx) => {
      await sql`SET LOCAL statement_timeout = '12000'`.execute(trx);
      return getRelease(trx, discogsId, batchId, dumpDate);
    });
    if (!release) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Release ${discogsId} not found`, details: null },
      });
    }
    return reply.send({ release });
  });
}
