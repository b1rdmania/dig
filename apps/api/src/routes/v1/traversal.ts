import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { sql } from "@dig/db";
import {
  getArtistReleases,
  getArtistMasters,
  getArtistCatalogReleases,
  getArtistCredits,
  getLabelReleases,
  getMasterReleases,
  getMasterVideos,
  getReleaseCredits,
  getBatchForTable,
  type RoleFamily,
} from "@dig/domain";

type TraversalScope =
  | "artist_releases"
  | "artist_masters"
  | "artist_catalog_releases"
  | "artist_credits"
  | "label_releases"
  | "master_releases"
  | "master_videos"
  | "release_credits";

const SCOPE_TABLE: Record<TraversalScope, string> = {
  artist_releases: "catalog.release_artists",
  artist_masters: "catalog.master_artists",
  artist_catalog_releases: "catalog.master_artists",
  artist_credits: "catalog.release_credits",
  label_releases: "catalog.release_labels",
  master_releases: "catalog.releases",
  master_videos: "catalog.release_videos",
  release_credits: "catalog.release_credits",
};

// Statement timeouts per traversal type — heavier joins get more time but are bounded.
const SCOPE_TIMEOUT_MS: Record<TraversalScope, number> = {
  artist_catalog_releases: 15_000,
  artist_credits: 15_000,
  release_credits: 10_000,
  artist_releases: 10_000,
  artist_masters: 10_000,
  label_releases: 10_000,
  master_releases: 10_000,
  master_videos: 5_000,
};

const VALID_ROLE_FAMILIES = ["writing", "arranging", "performance", "production", "other", "all"] as const;

function getTraversalBatchInfo(db: Kysely<Database>, scope: TraversalScope) {
  return getBatchForTable(db, SCOPE_TABLE[scope]);
}

const PG_INT4_MAX = 2_147_483_647;

function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 || id > PG_INT4_MAX ? null : id;
}

const VALID_SORTS = ["newest", "oldest"] as const;
const VALID_RELEASE_TYPES = ["album", "single_ep", "compilation", "other", "all"] as const;

function parseTraversalQuery(query: Record<string, string | undefined>) {
  return {
    limit: query.limit ? Math.min(Math.max(parseInt(query.limit, 10), 1), 100) : 20,
    cursor: query.cursor,
    sort: VALID_SORTS.includes(query.sort as any) ? (query.sort as "newest" | "oldest") : "newest",
    releaseType: VALID_RELEASE_TYPES.includes(query.release_type as any)
      ? (query.release_type as "album" | "single_ep" | "compilation" | "other" | "all")
      : "all",
  };
}

function isPgTimeout(err: unknown): boolean {
  const e = err as any;
  return e?.code === "57014" || e?.cause?.code === "57014";
}

async function withTimeout<T>(
  db: Kysely<Database>,
  timeoutMs: number,
  fn: (trx: Kysely<Database>) => Promise<T>,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    await sql`SET LOCAL statement_timeout = ${timeoutMs.toString()}`.execute(trx);
    return fn(trx);
  });
}

function timeoutReply(reply: any) {
  return reply.status(504).send({
    error: { code: "QUERY_TIMEOUT", message: "Query exceeded timeout", details: null },
  });
}

// Per-route rate limit config for heavy traversal endpoints.
// Artist catalog_releases and credits involve large joins over 18M+ rows.
const HEAVY_RATE_LIMIT = { max: 30, timeWindow: "1 minute" };

export function registerTraversalRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/artists/:discogs_id/releases", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "artist_releases");
      const { limit, cursor } = parseTraversalQuery(req.query as any);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.artist_releases, (trx) =>
        getArtistReleases(trx, discogsId, batchId, dumpDate, limit, cursor),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/artists/:discogs_id/masters", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "artist_masters");
      const { limit, cursor, sort, releaseType } = parseTraversalQuery(req.query as any);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.artist_masters, (trx) =>
        getArtistMasters(trx, discogsId, batchId, dumpDate, limit, cursor, sort, releaseType),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/artists/:discogs_id/catalog_releases", {
    config: { rateLimit: HEAVY_RATE_LIMIT },
  }, async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "artist_catalog_releases");
      const { limit, cursor, sort, releaseType } = parseTraversalQuery(req.query as any);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.artist_catalog_releases, (trx) =>
        getArtistCatalogReleases(trx, discogsId, batchId, dumpDate, limit, cursor, sort, releaseType),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/labels/:discogs_id/releases", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "label_releases");
      const { limit, cursor } = parseTraversalQuery(req.query as any);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.label_releases, (trx) =>
        getLabelReleases(trx, discogsId, batchId, dumpDate, limit, cursor),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/masters/:discogs_id/releases", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "master_releases");
      const { limit, cursor } = parseTraversalQuery(req.query as any);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.master_releases, (trx) =>
        getMasterReleases(trx, discogsId, batchId, dumpDate, limit, cursor),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/masters/:discogs_id/videos", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "master_videos");
      const rawLimit = parseInt(String((req.query as any)?.limit ?? "200"), 10);
      const limit = Number.isNaN(rawLimit) ? 200 : Math.min(Math.max(rawLimit, 1), 500);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.master_videos, (trx) =>
        getMasterVideos(trx, discogsId, batchId, dumpDate, limit),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/artists/:discogs_id/credits", {
    config: { rateLimit: HEAVY_RATE_LIMIT },
  }, async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "artist_credits");
      const { limit, cursor } = parseTraversalQuery(req.query as any);
      const roleFamilyRaw = (req.query as any).role_family as string | undefined;
      const roleFamily = VALID_ROLE_FAMILIES.includes(roleFamilyRaw as any)
        ? (roleFamilyRaw as RoleFamily | "all")
        : "all";
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.artist_credits, (trx) =>
        getArtistCredits(trx, discogsId, batchId, dumpDate, limit, cursor, roleFamily),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/releases/:discogs_id/credits", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "release_credits");
      const { limit, cursor } = parseTraversalQuery(req.query as any);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.release_credits, (trx) =>
        getReleaseCredits(trx, discogsId, batchId, dumpDate, limit, cursor),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });
}
