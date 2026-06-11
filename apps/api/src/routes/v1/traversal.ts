import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import { parseDiscogsId, isPgTimeout, withTimeout, timeoutReply } from "./util.js";
import {
  getArtistMasters,
  getArtistPrimaryLabels,
  getLabelReleases,
  getLabelRoster,
  getLabelStyles,
  getMasterReleases,
  getMasterVideos,
  getBatchForTable,
} from "@dig/domain";

// ---------------------------------------------------------------------------
// Scope of traversal in the slim/scene-scoped DB.
// Removed: artist_releases, artist_catalog_releases, artist_credits,
// release_credits — backing tables (catalog.releases, catalog.release_credits,
// catalog.release_artists) were dropped in migration 026.
// ---------------------------------------------------------------------------
type TraversalScope =
  | "artist_masters"
  | "label_releases"
  | "master_releases"
  | "master_videos";

// Batch resolution table per scope. The two derived tables built by the scope
// pipeline (release_shadow, master_videos_unified, master_tracks) have no
// batch_id of their own — they are atomically rebuilt from the active batch
// each time. We resolve their batch context via catalog.masters which is
// always rebuilt in lockstep and carries batch_id.
const SCOPE_TABLE: Record<TraversalScope, string> = {
  artist_masters: "catalog.master_artists",
  label_releases: "catalog.masters",
  master_releases: "catalog.masters",
  master_videos: "catalog.masters",
};

const SCOPE_TIMEOUT_MS: Record<TraversalScope, number> = {
  artist_masters: 8_000,
  label_releases: 8_000,
  master_releases: 8_000,
  master_videos: 5_000,
};

function getTraversalBatchInfo(db: Kysely<Database>, scope: TraversalScope) {
  return getBatchForTable(db, SCOPE_TABLE[scope]);
}

const VALID_SORTS = ["newest", "oldest"] as const;
const VALID_RELEASE_TYPES = ["album", "single_ep", "compilation", "other", "all"] as const;

function parseTraversalQuery(query: Record<string, string | undefined>) {
  const rawAliases = query.include_aliases;
  // Default ON — alias consolidation makes the artist page actually show the
  // artist's catalogue. Pass include_aliases=false to disable (debug / split
  // views).
  const includeAliases = rawAliases === undefined
    ? true
    : !(rawAliases === "false" || rawAliases === "0" || rawAliases === "no");
  return {
    limit: query.limit ? Math.min(Math.max(parseInt(query.limit, 10), 1), 100) : 20,
    cursor: query.cursor,
    // Default to oldest-first so the catalogue reads as a timeline
    // (pass sort=newest to reverse).
    sort: VALID_SORTS.includes(query.sort as any) ? (query.sort as "newest" | "oldest") : "oldest",
    releaseType: VALID_RELEASE_TYPES.includes(query.release_type as any)
      ? (query.release_type as "album" | "single_ep" | "compilation" | "other" | "all")
      : "all",
    includeAliases,
  };
}

function gone(reply: any, message: string, successor?: string) {
  return reply.status(410).send({
    error: {
      code: "GONE",
      message,
      details: successor ? { successor } : null,
    },
  });
}

export function registerTraversalRoutes(app: FastifyInstance, db: Kysely<Database>) {
  // --- Active routes (slim shape) --------------------------------------------

  app.get("/v1/artists/:discogs_id/masters", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId, dumpDate } = await getTraversalBatchInfo(db, "artist_masters");
      const { limit, cursor, sort, releaseType, includeAliases } = parseTraversalQuery(
        req.query as any,
      );
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.artist_masters, (trx) =>
        getArtistMasters(trx, discogsId, batchId, dumpDate, limit, cursor, sort, releaseType, {
          includeAliases,
        }),
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
      const sortRaw = (req.query as any)?.sort;
      const sort: "id" | "chronological" =
        sortRaw === "chronological" ? "chronological" : "id";
      // Catalog spine view bumps the limit cap so a single request returns
      // the full chronology for most tier-1 labels.
      const effLim = sort === "chronological" ? Math.min(Math.max(limit, 1), 200) : limit;
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.label_releases, (trx) =>
        getLabelReleases(trx, discogsId, batchId, dumpDate, effLim, cursor, sort),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/labels/:discogs_id/roster", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId } = await getTraversalBatchInfo(db, "label_releases");
      const rawLimit = parseInt(String((req.query as any)?.limit ?? "20"), 10);
      const limit = Number.isNaN(rawLimit) ? 20 : Math.min(Math.max(rawLimit, 1), 100);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.label_releases, (trx) =>
        getLabelRoster(trx, discogsId, batchId, limit),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/labels/:discogs_id/styles", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId } = await getTraversalBatchInfo(db, "label_releases");
      const rawLimit = parseInt(String((req.query as any)?.limit ?? "8"), 10);
      const limit = Number.isNaN(rawLimit) ? 8 : Math.min(Math.max(rawLimit, 1), 30);
      return reply.send(await withTimeout(db, SCOPE_TIMEOUT_MS.label_releases, (trx) =>
        getLabelStyles(trx, discogsId, batchId, limit),
      ));
    } catch (err) {
      if (isPgTimeout(err)) return timeoutReply(reply);
      throw err;
    }
  });

  app.get("/v1/artists/:discogs_id/labels", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    try {
      const { batchId } = await getTraversalBatchInfo(db, "artist_masters");
      const rawLimit = parseInt(String((req.query as any)?.limit ?? "5"), 10);
      const limit = Number.isNaN(rawLimit) ? 5 : Math.min(Math.max(rawLimit, 1), 20);
      const labels = await withTimeout(db, SCOPE_TIMEOUT_MS.artist_masters, (trx) =>
        getArtistPrimaryLabels(trx, discogsId, batchId, limit),
      );
      return reply.send({
        labels,
        meta: {
          source_type: "artist",
          source_discogs_id: discogsId,
          link_type: "primary_labels",
        },
      });
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

  // --- Removed routes (return 410 Gone) --------------------------------------

  app.get("/v1/artists/:discogs_id/releases", async (req, reply) =>
    gone(
      reply,
      "Artist releases are no longer served. The scoped catalog only tracks masters; use /v1/artists/:discogs_id/masters.",
      `/v1/artists/${(req.params as any).discogs_id}/masters`,
    ),
  );

  app.get("/v1/artists/:discogs_id/catalog_releases", async (req, reply) =>
    gone(
      reply,
      "catalog_releases is no longer served. Use /v1/artists/:discogs_id/masters for the artist's catalog.",
      `/v1/artists/${(req.params as any).discogs_id}/masters`,
    ),
  );

  app.get("/v1/releases/:discogs_id/credits", async (_req, reply) =>
    gone(
      reply,
      "Per-release credits are no longer served in the scene-scoped catalog.",
    ),
  );
}
