import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import {
  getArtistRelationships,
  getArtistContext,
  getArtistTimeline,
  getLabelLinkouts,
  parseEnrichmentParams,
  validateEnrichmentParams,
} from "@dig/domain";
import { parseDiscogsId } from "./util.js";

export function registerEnrichmentRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/artists/:discogs_id/relationships", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }

    const params = parseEnrichmentParams(req.query as any);
    const validationError = validateEnrichmentParams(params);
    if (validationError) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: validationError, details: null },
      });
    }

    try {
      const result = await getArtistRelationships(db, discogsId, params);
      return reply.send(result);
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        code: "INTERNAL_ERROR",
        route: "/v1/artists/:discogs_id/relationships",
        discogs_id: discogsId,
        message: (err as Error).message,
      }));
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Failed to fetch relationships", details: null },
      });
    }
  });

  app.get("/v1/artists/:discogs_id/context", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }

    const params = parseEnrichmentParams(req.query as any);
    const validationError = validateEnrichmentParams(params);
    if (validationError) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: validationError, details: null },
      });
    }

    try {
      const result = await getArtistContext(db, discogsId, params);
      return reply.send(result);
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        code: "INTERNAL_ERROR",
        route: "/v1/artists/:discogs_id/context",
        discogs_id: discogsId,
        message: (err as Error).message,
      }));
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Failed to fetch context", details: null },
      });
    }
  });

  app.get("/v1/artists/:discogs_id/timeline", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }

    const params = parseEnrichmentParams(req.query as any);
    const validationError = validateEnrichmentParams(params);
    if (validationError) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: validationError, details: null },
      });
    }

    try {
      const result = await getArtistTimeline(db, discogsId, params);
      return reply.send(result);
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        code: "INTERNAL_ERROR",
        route: "/v1/artists/:discogs_id/timeline",
        discogs_id: discogsId,
        message: (err as Error).message,
      }));
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Failed to fetch timeline", details: null },
      });
    }
  });

  app.get("/v1/labels/:discogs_id/linkouts", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }

    const params = parseEnrichmentParams(req.query as any);
    const validationError = validateEnrichmentParams(params);
    if (validationError) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: validationError, details: null },
      });
    }

    try {
      const result = await getLabelLinkouts(db, discogsId, params);
      return reply.send(result);
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: "error",
        code: "INTERNAL_ERROR",
        route: "/v1/labels/:discogs_id/linkouts",
        discogs_id: discogsId,
        message: (err as Error).message,
      }));
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Failed to fetch linkouts", details: null },
      });
    }
  });
}
