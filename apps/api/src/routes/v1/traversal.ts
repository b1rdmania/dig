import type { FastifyInstance } from "fastify";
import type { Kysely } from "@dig/db";
import type { Database } from "@dig/db";
import {
  getArtistReleases,
  getArtistMasters,
  getLabelReleases,
  getMasterReleases,
  getMasterVideos,
  getReleaseCredits,
  getBatchForTable,
} from "@dig/domain";

type TraversalScope =
  | "artist_releases"
  | "artist_masters"
  | "label_releases"
  | "master_releases"
  | "master_videos"
  | "release_credits";

const SCOPE_TABLE: Record<TraversalScope, string> = {
  artist_releases: "catalog.release_artists",
  artist_masters: "catalog.master_artists",
  label_releases: "catalog.release_labels",
  master_releases: "catalog.releases",
  master_videos: "catalog.release_videos",
  release_credits: "catalog.release_credits",
};

function getTraversalBatchInfo(db: Kysely<Database>, scope: TraversalScope) {
  return getBatchForTable(db, SCOPE_TABLE[scope]);
}

function parseDiscogsId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return isNaN(id) || id < 1 ? null : id;
}

function parseTraversalQuery(query: Record<string, string | undefined>) {
  return {
    limit: query.limit ? Math.min(Math.max(parseInt(query.limit, 10), 1), 100) : 20,
    cursor: query.cursor,
  };
}

export function registerTraversalRoutes(app: FastifyInstance, db: Kysely<Database>) {
  app.get("/v1/artists/:discogs_id/releases", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getTraversalBatchInfo(db, "artist_releases");
    const { limit, cursor } = parseTraversalQuery(req.query as any);
    return reply.send(await getArtistReleases(db, discogsId, batchId, dumpDate, limit, cursor));
  });

  app.get("/v1/artists/:discogs_id/masters", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getTraversalBatchInfo(db, "artist_masters");
    const { limit, cursor } = parseTraversalQuery(req.query as any);
    return reply.send(await getArtistMasters(db, discogsId, batchId, dumpDate, limit, cursor));
  });

  app.get("/v1/labels/:discogs_id/releases", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getTraversalBatchInfo(db, "label_releases");
    const { limit, cursor } = parseTraversalQuery(req.query as any);
    return reply.send(await getLabelReleases(db, discogsId, batchId, dumpDate, limit, cursor));
  });

  app.get("/v1/masters/:discogs_id/releases", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getTraversalBatchInfo(db, "master_releases");
    const { limit, cursor } = parseTraversalQuery(req.query as any);
    return reply.send(await getMasterReleases(db, discogsId, batchId, dumpDate, limit, cursor));
  });

  app.get("/v1/masters/:discogs_id/videos", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getTraversalBatchInfo(db, "master_videos");
    const rawLimit = parseInt(String((req.query as any)?.limit ?? "200"), 10);
    const limit = Number.isNaN(rawLimit) ? 200 : Math.min(Math.max(rawLimit, 1), 500);
    return reply.send(await getMasterVideos(db, discogsId, batchId, dumpDate, limit));
  });

  app.get("/v1/releases/:discogs_id/credits", async (req, reply) => {
    const discogsId = parseDiscogsId((req.params as any).discogs_id);
    if (!discogsId) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      });
    }
    const { batchId, dumpDate } = await getTraversalBatchInfo(db, "release_credits");
    const { limit, cursor } = parseTraversalQuery(req.query as any);
    return reply.send(await getReleaseCredits(db, discogsId, batchId, dumpDate, limit, cursor));
  });
}
