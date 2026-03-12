import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { sql } from "@dig/db";
import { getArtist, getLabel, getMaster, getRelease, getBatchForTable } from "@dig/domain";

const PG_INT4_MAX = 2_147_483_647;

function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 || id > PG_INT4_MAX ? null : id;
}

function isPgTimeout(err: unknown): boolean {
  const e = err as any;
  return e?.code === "57014" || e?.cause?.code === "57014";
}

export function registerEntityRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/artists/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.artists");
      const artist = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '8000'`.execute(trx);
        return getArtist(trx, discogsId, batchId, dumpDate);
      });
      if (!artist) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Artist ${discogsId} not found`, details: null },
        });
      }
      return reply.send({ artist });
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Artist lookup exceeded timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/labels/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.labels");
      const label = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '8000'`.execute(trx);
        return getLabel(trx, discogsId, batchId, dumpDate);
      });
      if (!label) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Label ${discogsId} not found`, details: null },
        });
      }
      return reply.send({ label });
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Label lookup exceeded timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/masters/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
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
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Master lookup exceeded timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/releases/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.releases");
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
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Release lookup exceeded timeout", details: null },
        });
      }
      throw err;
    }
  });
}
