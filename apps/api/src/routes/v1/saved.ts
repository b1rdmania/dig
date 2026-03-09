/**
 * Saved items (favorites + want list) for signed-in users.
 *
 * GET    /v1/me/saved                       — list saved items
 * POST   /v1/me/saved                       — add item
 * DELETE /v1/me/saved/:list/:type/:id       — remove item
 *
 * Entitlement gates:
 *   favorite  — free (any signed-in user)
 *   want      — early_access required
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Kysely, Database } from "@dig/db";
import { resolveUser } from "../../auth.js";

type EntityType = "artist" | "release" | "version" | "label" | "track";
type ListType = "favorite" | "want";

const VALID_ENTITY_TYPES = new Set<EntityType>(["artist", "release", "version", "label", "track"]);
const VALID_LIST_TYPES = new Set<ListType>(["favorite", "want"]);

function featureForList(listType: ListType): "favorites" | "wantlist" {
  return listType === "want" ? "wantlist" : "favorites";
}

export function registerSavedRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  // GET /v1/me/saved?list_type=favorite|want
  app.get("/v1/me/saved", async (req: FastifyRequest<{ Querystring: { list_type?: string } }>, reply) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in required", details: null } });

    const listType = (req.query.list_type ?? "favorite") as ListType;
    if (!VALID_LIST_TYPES.has(listType)) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "list_type must be favorite or want", details: null } });
    }

    const feature = featureForList(listType);
    if (!user.entitlements.features[feature]) {
      return reply.status(403).send({ error: { code: "PLAN_UPGRADE_REQUIRED", message: `${listType === "want" ? "Want list" : "Favourites"} requires Early Access`, details: { plan_required: "early_access" } } });
    }

    const rows = await db
      .selectFrom("auth.user_saved_items")
      .select(["id", "entity_type", "discogs_id", "list_type", "created_at"])
      .where("user_id", "=", user.userId)
      .where("list_type", "=", listType)
      .orderBy("created_at", "desc")
      .execute();

    return reply.send({ items: rows, count: rows.length });
  });

  // POST /v1/me/saved
  app.post("/v1/me/saved", async (req: FastifyRequest<{ Body: { entity_type?: string; discogs_id?: number; list_type?: string } }>, reply) => {
    const user = await resolveUser(db, req.headers.authorization);
    if (!user) return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in required", details: null } });

    const { entity_type, discogs_id, list_type } = req.body ?? {};

    if (!entity_type || !VALID_ENTITY_TYPES.has(entity_type as EntityType)) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: `entity_type must be one of: ${[...VALID_ENTITY_TYPES].join(", ")}`, details: null } });
    }
    if (!discogs_id || typeof discogs_id !== "number") {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "discogs_id must be a number", details: null } });
    }
    const lt = (list_type ?? "favorite") as ListType;
    if (!VALID_LIST_TYPES.has(lt)) {
      return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "list_type must be favorite or want", details: null } });
    }

    const feature = featureForList(lt);
    if (!user.entitlements.features[feature]) {
      return reply.status(403).send({
        error: {
          code: "PLAN_UPGRADE_REQUIRED",
          message: lt === "want"
            ? "Want list is part of Early Access (£5/month). You also get the Dig AI assistant."
            : "Favourites require Early Access",
          details: { plan_required: "early_access" },
        },
      });
    }

    await db
      .insertInto("auth.user_saved_items")
      .values({ user_id: user.userId, entity_type: entity_type as EntityType, discogs_id, list_type: lt })
      .onConflict((oc) => oc.columns(["user_id", "list_type", "entity_type", "discogs_id"]).doNothing())
      .execute();

    return reply.status(201).send({ saved: true, entity_type, discogs_id, list_type: lt });
  });

  // DELETE /v1/me/saved/:list_type/:entity_type/:discogs_id
  app.delete(
    "/v1/me/saved/:list_type/:entity_type/:discogs_id",
    async (req: FastifyRequest<{ Params: { list_type: string; entity_type: string; discogs_id: string } }>, reply) => {
      const user = await resolveUser(db, req.headers.authorization);
      if (!user) return reply.status(401).send({ error: { code: "AUTH_REQUIRED", message: "Sign in required", details: null } });

      const lt = req.params.list_type as ListType;
      const et = req.params.entity_type as EntityType;
      const id = parseInt(req.params.discogs_id, 10);

      if (!VALID_LIST_TYPES.has(lt) || !VALID_ENTITY_TYPES.has(et) || isNaN(id)) {
        return reply.status(400).send({ error: { code: "INVALID_REQUEST", message: "Invalid parameters", details: null } });
      }

      await db
        .deleteFrom("auth.user_saved_items")
        .where("user_id", "=", user.userId)
        .where("list_type", "=", lt)
        .where("entity_type", "=", et)
        .where("discogs_id", "=", id)
        .execute();

      return reply.status(204).send();
    },
  );
}
