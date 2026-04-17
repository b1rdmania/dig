import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { search, validateSearchParams, classifySearchLane, type SearchEntityType } from "@dig/domain";
import { Semaphore } from "../../lib/semaphore.js";

// Scene-scoped DB: release-as-entity removed; only artist | label | master.
// "release" still parses (domain returns degraded empty) so legacy callers
// don't 400, but we do not advertise it.
const VALID_TYPES = new Set(["artist", "label", "master", "release"]);

// Per-machine concurrency cap for heavy-lane search (genre/style/year filters
// on master). Prevents expensive filter+FTS joins from starving unfiltered
// core-lane queries. At cap, the route sheds immediately with 429.
const HEAVY_LANE_CONCURRENCY = 8;
const heavyLaneSemaphore = new Semaphore(HEAVY_LANE_CONCURRENCY);

function logLoadShed(route: string, lane: string, available: number): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      code: "LOAD_SHED",
      route,
      lane,
      semaphore_available: available,
    }),
  );
}

export function registerSearchRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/search", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;

    // In the scene-scoped catalog, master is the canonical entity.
    // If a caller doesn't specify a type, prefer masters.
    const rawType = query.type;
    const type: SearchEntityType | undefined = rawType
      ? (VALID_TYPES.has(rawType) ? (rawType as SearchEntityType) : undefined)
      : "master";

    const params = {
      q: query.q ?? "",
      type,
      genre: query.genre,
      style: query.style,
      year: query.year ? parseInt(query.year, 10) : undefined,
      yearMin: query.year_min ? parseInt(query.year_min, 10) : undefined,
      yearMax: query.year_max ? parseInt(query.year_max, 10) : undefined,
      country: query.country,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      cursor: query.cursor,
      quality: query.quality === "all" ? "all" as const : "active" as const,
      rescue: process.env.SEARCH_ZERO_RESCUE === "true",
    };

    const validationError = validateSearchParams(params);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    const lane = classifySearchLane(params);

    if (lane === "heavy") {
      const release = heavyLaneSemaphore.tryAcquire();
      if (!release) {
        logLoadShed("/v1/search", "heavy", heavyLaneSemaphore.available);
        return reply.status(429).send({
          error: {
            code: "LOAD_SHED",
            message: "Server is under load. Simplify filters or try again shortly.",
            details: null,
          },
        });
      }
      try {
        const result = await search(db, params);
        if (result.results.length === 0 && result.meta.degraded_reason === "statement_timeout") {
          return reply.status(504).send({
            error: { code: "QUERY_TIMEOUT", message: "Search query exceeded timeout", details: null },
          });
        }
        return reply.send(result);
      } catch (err: any) {
        const pgCode = err.code ?? err.cause?.code;
        if (pgCode === "57014") {
          return reply.status(504).send({
            error: { code: "QUERY_TIMEOUT", message: "Search query exceeded timeout", details: null },
          });
        }
        throw err;
      } finally {
        release();
      }
    }

    // Core lane: bounded by 3s statement_timeout inside search()
    try {
      const result = await search(db, params);
      if (result.results.length === 0 && result.meta.degraded_reason === "statement_timeout") {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Search query exceeded timeout", details: null },
        });
      }
      return reply.send(result);
    } catch (err: any) {
      const pgCode = err.code ?? err.cause?.code;
      if (pgCode === "57014") {
        return reply.status(504).send({
          error: { code: "QUERY_TIMEOUT", message: "Search query exceeded timeout", details: null },
        });
      }
      throw err;
    }
  });
}
