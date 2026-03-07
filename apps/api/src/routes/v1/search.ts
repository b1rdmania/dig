import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { search, validateSearchParams, type SearchEntityType } from "@dig/domain";

const VALID_TYPES = new Set(["artist", "label", "master", "release"]);

export function registerSearchRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/search", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>;

    const params = {
      q: query.q ?? "",
      type: VALID_TYPES.has(query.type ?? "") ? (query.type as SearchEntityType) : undefined,
      genre: query.genre,
      style: query.style,
      year: query.year ? parseInt(query.year, 10) : undefined,
      yearMin: query.year_min ? parseInt(query.year_min, 10) : undefined,
      yearMax: query.year_max ? parseInt(query.year_max, 10) : undefined,
      country: query.country,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      cursor: query.cursor,
      quality: query.quality === "all" ? "all" as const : "active" as const,
    };

    const validationError = validateSearchParams(params);
    if (validationError) {
      return reply.status(400).send({ error: validationError });
    }

    try {
      const result = await search(db, params);
      return reply.send(result);
    } catch (err: any) {
      // statement_timeout — may be direct (code 57014) or wrapped in transaction error (cause.code)
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
