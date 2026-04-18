import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { sql } from "@dig/db";
import {
  getArtist,
  getLabel,
  getMaster,
  getReleaseShadow,
  getBatchForTable,
  getLabelCoreRun,
  getLabelRelated,
} from "@dig/domain";

const PG_INT4_MAX = 2_147_483_647;

function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 || id > PG_INT4_MAX ? null : id;
}

function isPgTimeout(err: unknown): boolean {
  const e = err as any;
  return e?.code === "57014" || e?.cause?.code === "57014";
}

// Scene-scoped DB no longer stores full release rows. Public consumers that hit
// /v1/releases/:id should fall back to:
//   1. /v1/release_shadow/:id  → look up master_discogs_id
//   2. /v1/masters/:master_id  → canonical entity
function goneReleaseDetail(reply: any, discogsId: number) {
  reply.header("Link", `</v1/release_shadow/${discogsId}>; rel="successor-version"`);
  return reply.status(410).send({
    error: {
      code: "GONE",
      message:
        "Release detail is no longer served. The scoped catalog is master-first; resolve master via /v1/release_shadow/:discogs_id then call /v1/masters/:master_discogs_id.",
      details: { successor: `/v1/release_shadow/${discogsId}` },
    },
  });
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
      const result = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '8000'`.execute(trx);
        const labelDetail = await getLabel(trx, discogsId, batchId, dumpDate);
        if (!labelDetail) return null;
        // Phase C: core_run + related label essentials. Parallel within the
        // same transaction so the 8s statement_timeout still applies.
        const [coreRun, related] = await Promise.all([
          getLabelCoreRun(trx, discogsId, 10),
          getLabelRelated(trx, discogsId),
        ]);
        return { label: labelDetail, core_run: coreRun, related };
      });
      if (!result) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Label ${discogsId} not found`, details: null },
        });
      }
      return reply.send(result);
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

  // Minimal release lookup for redirect handling. Returns master_discogs_id +
  // identifying metadata so frontends can 301 /release/[id] → /master/[master_id].
  app.get("/v1/release_shadow/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const shadow = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '4000'`.execute(trx);
        return getReleaseShadow(trx, discogsId);
      });
      if (!shadow) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Release ${discogsId} not in scope`, details: null },
        });
      }
      return reply.send({ release_shadow: shadow });
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Release shadow lookup timeout", details: null },
        });
      }
      throw err;
    }
  });

  // Removed: /v1/releases/:discogs_id (catalog.releases dropped in scoped DB).
  app.get("/v1/releases/:discogs_id", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    return goneReleaseDetail(reply, discogsId);
  });
}
