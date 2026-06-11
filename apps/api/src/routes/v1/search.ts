import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { search, validateSearchParams, type SearchEntityType } from "@dig/domain";

const VALID_TYPES = new Set<string>(["artist", "label", "master"]);

export function registerSearchRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/search", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;

    // No type → mixed-type fan-out (artist + label + master) ranked together.
    // The domain layer applies the master-first / exact-match weighting, and
    // the response carries a top_match (label/artist exact name hit) plus
    // per-type counts so the frontend can render the pinned card and tabs.
    const rawType = query.type;
    if (rawType !== undefined && !VALID_TYPES.has(rawType)) {
      const hint = rawType === "release"
        ? "Release-level search was retired — the catalog is master-first. Use type=master."
        : "type must be one of: artist, label, master";
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: hint, details: null },
      });
    }
    const type = rawType as SearchEntityType | undefined;

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

    // Bounded by the 3s statement_timeout inside search().
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
