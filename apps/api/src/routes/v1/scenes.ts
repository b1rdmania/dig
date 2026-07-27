import type { FastifyInstance } from "fastify";
import type { Database, Kysely } from "@dig/db";
import {
  getScene,
  getSceneWall,
  getScenePlaylist,
  listScenes,
  getBatchForTable,
} from "@dig/domain";
import { isPgTimeout, withTimeout, cachePublic, timeoutReply as sharedTimeoutReply } from "./util.js";

const SCENES_TIMEOUT_MS = 8_000;

function timeoutReply(reply: any) {
  return sharedTimeoutReply(reply, "Scene query exceeded the per-route timeout");
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;

function parseDensity(raw: unknown): "compact" | "medium" | "full" {
  if (raw === "medium" || raw === "full") return raw;
  return "compact";
}

function parsePerLabel(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1 || n > 200) return undefined;
  return n;
}

export function registerScenesRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  // -------------------------------------------------------------------------
  // GET /v1/scenes
  // -------------------------------------------------------------------------
  app.get("/v1/scenes", async (_req, reply) => {
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const scenes = await withTimeout(db, SCENES_TIMEOUT_MS, (trx) =>
        listScenes(trx, batchId),
      );
      cachePublic(reply);
      return reply.send({
        scenes,
        meta: {
          count: scenes.length,
          provenance: { source: "discogs", dump_date: dumpDate },
        },
      });
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // GET /v1/scenes/:slug
  // -------------------------------------------------------------------------
  app.get("/v1/scenes/:slug", async (req, reply) => {
    const slug = String((req.params as any).slug ?? "");
    if (!SLUG_RE.test(slug)) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid scene slug", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const scene = await withTimeout(db, SCENES_TIMEOUT_MS, (trx) =>
        getScene(trx, slug, batchId),
      );
      if (!scene) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Scene '${slug}' not found`, details: null },
        });
      }
      cachePublic(reply);
      return reply.send({
        scene,
        meta: {
          provenance: { source: "discogs", dump_date: dumpDate },
        },
      });
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // GET /v1/scenes/:slug/wall
  // -------------------------------------------------------------------------
  app.get("/v1/scenes/:slug/wall", async (req, reply) => {
    const slug = String((req.params as any).slug ?? "");
    if (!SLUG_RE.test(slug)) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid scene slug", details: null },
      });
    }
    const density = parseDensity((req.query as any)?.density);
    const perLabel = parsePerLabel((req.query as any)?.per_label);
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const wall = await withTimeout(db, SCENES_TIMEOUT_MS, (trx) =>
        getSceneWall(trx, slug, batchId, { density, perLabel }),
      );
      if (!wall) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Scene '${slug}' not found`, details: null },
        });
      }
      cachePublic(reply);
      return reply.send({
        wall,
        meta: {
          provenance: { source: "discogs", dump_date: dumpDate },
        },
      });
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // GET /v1/scenes/:slug/playlist
  // -------------------------------------------------------------------------
  app.get("/v1/scenes/:slug/playlist", async (req, reply) => {
    const slug = String((req.params as any).slug ?? "");
    if (!SLUG_RE.test(slug)) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid scene slug", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getBatchForTable(db, "catalog.masters");
      const playlist = await withTimeout(db, SCENES_TIMEOUT_MS, (trx) =>
        getScenePlaylist(trx, slug, batchId),
      );
      if (!playlist) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Scene '${slug}' not found`, details: null },
        });
      }
      cachePublic(reply);
      return reply.send({
        playlist,
        meta: {
          provenance: { source: "discogs", dump_date: dumpDate },
        },
      });
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });
}
