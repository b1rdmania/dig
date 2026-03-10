/**
 * Mixtapes API — user-curated track lists.
 * Gated: early_access plan only.
 *
 * GET    /v1/me/mixtapes                           — list mixtapes
 * POST   /v1/me/mixtapes                           — create mixtape
 * GET    /v1/me/mixtapes/:id                       — get mixtape + tracks
 * DELETE /v1/me/mixtapes/:id                       — delete mixtape
 * POST   /v1/me/mixtapes/:id/tracks                — add track
 * DELETE /v1/me/mixtapes/:id/tracks/:trackId       — remove track
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely, Database } from "@dig/db";
import { resolveUser } from "../../auth.js";
import {
  createMixtape,
  listMixtapes,
  getMixtape,
  deleteMixtape,
  addTrack,
  listTracks,
  removeTrack,
} from "@dig/domain";

function unauthorized(reply: any) {
  return reply.status(401).send({ error: { code: "UNAUTHORIZED", message: "Sign in required.", details: null } });
}

function planRequired(reply: any) {
  return reply.status(403).send({ error: { code: "PLAN_UPGRADE_REQUIRED", message: "Mixtapes require an Early Access plan.", details: null } });
}

function requireEarlyAccess(user: Awaited<ReturnType<typeof resolveUser>>, reply: any): boolean {
  const plan = user?.entitlements.plan;
  if (plan !== "early_access" && plan !== "team") {
    planRequired(reply);
    return false;
  }
  return true;
}

export function registerMixtapeRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  // GET /v1/me/mixtapes
  app.get("/v1/me/mixtapes", async (req: FastifyRequest, reply) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const mixtapes = await listMixtapes(db, user.userId);
    return reply.send({ mixtapes, count: mixtapes.length });
  });

  // POST /v1/me/mixtapes
  app.post("/v1/me/mixtapes", async (req: FastifyRequest<{ Body: { title?: string; description?: string } }>, reply) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const { title, description } = req.body ?? {};
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "title is required.", details: null } });
    }

    const result = await createMixtape(db, user.userId, title.trim().slice(0, 200), description?.trim().slice(0, 1000));
    if (!result.ok) {
      return reply.status(422).send({ error: { code: result.code, message: result.message, details: null } });
    }
    return reply.status(201).send({ mixtape: result.mixtape });
  });

  // GET /v1/me/mixtapes/:id
  app.get("/v1/me/mixtapes/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const mixtape = await getMixtape(db, user.userId, req.params.id);
    if (!mixtape) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Mixtape not found.", details: null } });

    const tracks = await listTracks(db, user.userId, req.params.id) ?? [];
    return reply.send({ mixtape, tracks });
  });

  // DELETE /v1/me/mixtapes/:id
  app.delete("/v1/me/mixtapes/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const deleted = await deleteMixtape(db, user.userId, req.params.id);
    if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Mixtape not found.", details: null } });
    return reply.status(204).send();
  });

  // POST /v1/me/mixtapes/:id/tracks
  app.post("/v1/me/mixtapes/:id/tracks", async (
    req: FastifyRequest<{
      Params: { id: string };
      Body: {
        source_entity_type?: string;
        source_discogs_id?: number;
        master_discogs_id?: number | null;
        name?: string | null;
        artist?: string | null;
        client_request_id?: string | null;
      };
    }>,
    reply,
  ) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const body = req.body ?? {};
    const { source_entity_type, source_discogs_id } = body;

    const VALID_TYPES = new Set(["master", "release", "version"]);
    if (!source_entity_type || !VALID_TYPES.has(source_entity_type)) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "source_entity_type must be master|release|version.", details: null } });
    }
    if (!source_discogs_id || typeof source_discogs_id !== "number") {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "source_discogs_id is required.", details: null } });
    }

    const result = await addTrack(db, user.userId, req.params.id, {
      sourceEntityType: source_entity_type,
      sourceDiscogsId: source_discogs_id,
      masterDiscogsId: body.master_discogs_id ?? null,
      name: body.name ?? null,
      artist: body.artist ?? null,
      clientRequestId: body.client_request_id ?? null,
    });

    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : 422;
      return reply.status(status).send({ error: { code: result.code, message: result.message, details: null } });
    }
    return reply.status(201).send({ track: result.track });
  });

  // DELETE /v1/me/mixtapes/:id/tracks/:trackId
  app.delete("/v1/me/mixtapes/:id/tracks/:trackId", async (
    req: FastifyRequest<{ Params: { id: string; trackId: string } }>,
    reply,
  ) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return unauthorized(reply);
    if (!requireEarlyAccess(user, reply)) return;

    const deleted = await removeTrack(db, user.userId, req.params.id, req.params.trackId);
    if (!deleted) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Track not found.", details: null } });
    return reply.status(204).send();
  });
}
