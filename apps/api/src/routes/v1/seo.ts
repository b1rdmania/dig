import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { sql } from "@dig/db";
import { getBatchForTable } from "@dig/domain";

const COHORT_TYPES = ["artists", "releases", "labels"] as const;
type CohortType = typeof COHORT_TYPES[number];

const MAX_LIMITS: Record<CohortType, number> = {
  artists: 5000,
  releases: 50000,
  labels: 2000,
};

const BATCH_TABLE: Record<CohortType, string> = {
  artists: "catalog.artists",
  releases: "catalog.masters",
  labels: "catalog.labels",
};

export function registerSeoRoutes(app: FastifyInstance, db: Kysely<Database>) {
  /**
   * GET /v1/seo/cohort?type=artists|releases|labels&limit=N
   *
   * Returns a list of Discogs IDs for the indexable cohort of each entity type.
   * Used by the web app to generate partitioned sitemaps.
   *
   * Quality criteria:
   *   artists  — has non-trivial profile (>10 chars)
   *   releases — has genres + main_release_discogs_id (tracklist reachable)
   *   labels   — has ≥5 linked releases
   */
  app.get("/v1/seo/cohort", async (req, reply) => {
    const { type, limit: limitRaw, offset: offsetRaw } = req.query as {
      type?: string;
      limit?: string;
      offset?: string;
    };

    if (!type || !COHORT_TYPES.includes(type as CohortType)) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "type must be one of: artists, releases, labels", details: null },
      });
    }

    const cohortType = type as CohortType;
    const limit = Math.min(
      parseInt(limitRaw || "0", 10) || MAX_LIMITS[cohortType],
      MAX_LIMITS[cohortType],
    );
    const offset = Math.max(parseInt(offsetRaw || "0", 10) || 0, 0);

    try {
      const { batchId } = await getBatchForTable(db, BATCH_TABLE[cohortType]);
      let ids: number[] = [];

      if (cohortType === "artists") {
        const result = await sql<{ discogs_id: number }>`
          SELECT discogs_id
          FROM catalog.artists
          WHERE batch_id = ${batchId}::uuid
            AND profile IS NOT NULL
            AND length(trim(profile)) > 10
          ORDER BY discogs_id ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `.execute(db);
        ids = result.rows.map((r) => r.discogs_id);
      } else if (cohortType === "releases") {
        // Slim catalog: genres are denormalized onto catalog.masters (TEXT[]),
        // master_genres table dropped. Quality filter retained via enrich.entity_quality.
        const result = await sql<{ discogs_id: number }>`
          SELECT m.discogs_id
          FROM catalog.masters m
          JOIN enrich.entity_quality eq
            ON eq.entity_type = 'master'
           AND eq.discogs_id = m.discogs_id
           AND eq.quality_status = 'active'
          WHERE m.batch_id = ${batchId}::uuid
            AND m.main_release_discogs_id IS NOT NULL
            AND coalesce(cardinality(m.genres), 0) > 0
          ORDER BY m.scene_weight DESC NULLS LAST, m.year DESC NULLS LAST, m.discogs_id ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `.execute(db);
        ids = result.rows.map((r) => r.discogs_id);
      } else {
        // Slim catalog: release_labels dropped. A label is indexable when
        // at least one in-scope master is attributed to it via primary_label_discogs_id.
        const result = await sql<{ discogs_id: number }>`
          SELECT l.discogs_id
          FROM catalog.labels l
          WHERE l.batch_id = ${batchId}::uuid
            AND l.name NOT IN ('Not On Label', 'Unknown', 'Various')
            AND EXISTS (
              SELECT 1 FROM catalog.masters m
              WHERE m.primary_label_discogs_id = l.discogs_id
                AND m.batch_id = ${batchId}::uuid
              LIMIT 1
            )
          ORDER BY l.discogs_id ASC
          LIMIT ${limit}
          OFFSET ${offset}
        `.execute(db);
        ids = result.rows.map((r) => r.discogs_id);
      }

      return reply.send({
        type: cohortType,
        ids,
        count: ids.length,
        offset,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[seo] cohort error:", err);
      return reply.status(500).send({
        error: { code: "INTERNAL_ERROR", message: "Failed to generate cohort", details: null },
      });
    }
  });
}
