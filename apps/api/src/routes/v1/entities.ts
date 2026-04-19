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
  getArtistRuleACredits,
  getArtistCrossScopeCredits,
  getMasterCredits,
  getArtistGroupsAndMembers,
  getLabelTopCredits,
  getEntityImages,
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

  // ─── Credit + remix surfaces (migration 030) ─────────────────────────────
  // role param values: 'remix' | 'produce' | 'mix' | 'master' | 'write' |
  // 'vocal' | 'engineer' | exact normalised role string. Omit for "all".

  app.get("/v1/artists/:discogs_id/credits", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const q = req.query as { role?: string; limit?: string };
    const limit = q.limit ? Math.max(1, Math.min(parseInt(q.limit, 10) || 50, 200)) : 50;
    try {
      // Credit tables (master_track_credits / master_release_credits) are
      // populated by a one-shot ETL and have no batch_id; we resolve the batch
      // from catalog.masters which is what the hydration query joins against.
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const result = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '8000'`.execute(trx);
        return getArtistRuleACredits(trx, discogsId, batchId, {
          limit,
          roleFilter: q.role ?? null,
        });
      });
      return reply.send(result);
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Artist credits lookup timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/artists/:discogs_id/cross-scope-credits", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const q = req.query as { role?: string; limit?: string };
    const limit = q.limit ? Math.max(1, Math.min(parseInt(q.limit, 10) || 50, 200)) : 50;
    try {
      const result = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '6000'`.execute(trx);
        return getArtistCrossScopeCredits(trx, discogsId, {
          limit,
          roleFilter: q.role ?? null,
        });
      });
      return reply.send(result);
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Cross-scope credits timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/artists/:discogs_id/group-members", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId } = await getBatchForTable(db, "catalog.artists");
      const result = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '4000'`.execute(trx);
        return getArtistGroupsAndMembers(trx, discogsId, batchId);
      });
      return reply.send(result);
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Group members lookup timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/masters/:discogs_id/credits", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const result = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '6000'`.execute(trx);
        return getMasterCredits(trx, discogsId);
      });
      return reply.send(result);
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Master credits lookup timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/labels/:discogs_id/images", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const q = req.query as { kind?: string; width?: string };
    const widthNum = q.width ? parseInt(q.width, 10) : null;
    const width = widthNum && widthNum > 0 && widthNum <= 4096 ? widthNum : null;
    const allowed = ["logo", "photo", "hero"] as const;
    const kind = q.kind && (allowed as readonly string[]).includes(q.kind)
      ? (q.kind as (typeof allowed)[number])
      : null;
    try {
      const result = await getEntityImages(db, "label", discogsId, { kind, width });
      // Match cover-art cache hint: 7 days at the edge, 24h in the browser.
      reply.header("Cache-Control", "public, max-age=86400, s-maxage=604800");
      return reply.send(result);
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Label images lookup timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/artists/:discogs_id/images", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const q = req.query as { kind?: string; width?: string };
    const widthNum = q.width ? parseInt(q.width, 10) : null;
    const width = widthNum && widthNum > 0 && widthNum <= 4096 ? widthNum : null;
    const allowed = ["logo", "photo", "hero"] as const;
    const kind = q.kind && (allowed as readonly string[]).includes(q.kind)
      ? (q.kind as (typeof allowed)[number])
      : null;
    try {
      const result = await getEntityImages(db, "artist", discogsId, { kind, width });
      reply.header("Cache-Control", "public, max-age=86400, s-maxage=604800");
      return reply.send(result);
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Artist images lookup timeout", details: null },
        });
      }
      throw err;
    }
  });

  app.get("/v1/labels/:discogs_id/top-credits", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const q = req.query as { role?: string; limit?: string };
    const limit = q.limit ? Math.max(1, Math.min(parseInt(q.limit, 10) || 30, 100)) : 30;
    try {
      const { batchId } = await getBatchForTable(db, "catalog.masters");
      const entries = await db.transaction().execute(async (trx) => {
        await sql`SET LOCAL statement_timeout = '8000'`.execute(trx);
        return getLabelTopCredits(trx, discogsId, batchId, { limit, role: q.role ?? null });
      });
      return reply.send({ label_discogs_id: discogsId, entries });
    } catch (err) {
      if (isPgTimeout(err)) {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Label top-credits lookup timeout", details: null },
        });
      }
      throw err;
    }
  });
}
