/**
 * Direct graph traversal — v1 scope only.
 *
 * Supported links:
 * - artist → releases (via release_artists)
 * - artist → masters (via master_artists)
 * - label → releases (via release_labels)
 * - master → releases (via releases.master_discogs_id)
 * - release → credits (via release_credits)
 */

import type { Kysely } from "kysely";
import type { Database } from "@dig/db";

export interface TraversalLink {
  type: "artist" | "label" | "master" | "release";
  discogs_id: number;
  name?: string;
  title?: string;
  year?: number | null;
  role?: string | null;
  provenance: { source: "discogs"; dump_date: string; discogs_id: number };
}

export interface TraversalResponse {
  links: TraversalLink[];
  pagination: {
    cursor: string | null;
    has_more: boolean;
    total_estimate: number | null;
  };
  meta: {
    source_type: string;
    source_discogs_id: number;
    link_type: string;
    elapsed_ms: number;
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function encodeCursor(discogsId: number): string {
  return Buffer.from(JSON.stringify({ discogs_id: discogsId })).toString("base64url");
}

function decodeCursor(cursor: string): number | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    return typeof parsed.discogs_id === "number" ? parsed.discogs_id : null;
  } catch {
    return null;
  }
}

export async function getArtistReleases(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.release_artists")
    .innerJoin("catalog.releases", (join) =>
      join
        .onRef("catalog.releases.discogs_id", "=", "catalog.release_artists.release_discogs_id")
        .on("catalog.releases.batch_id", "=", batchId),
    )
    .select([
      "catalog.releases.discogs_id",
      "catalog.releases.title",
      "catalog.releases.release_year as year",
    ])
    .where("catalog.release_artists.artist_discogs_id", "=", artistDiscogsId)
    .where("catalog.release_artists.batch_id", "=", batchId)
    .orderBy("catalog.releases.discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("catalog.releases.discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "release",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "releases",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getArtistMasters(
  db: Kysely<Database>,
  artistDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.master_artists")
    .innerJoin("catalog.masters", (join) =>
      join
        .onRef("catalog.masters.discogs_id", "=", "catalog.master_artists.master_discogs_id")
        .on("catalog.masters.batch_id", "=", batchId),
    )
    .select([
      "catalog.masters.discogs_id",
      "catalog.masters.title",
      "catalog.masters.year",
    ])
    .where("catalog.master_artists.artist_discogs_id", "=", artistDiscogsId)
    .where("catalog.master_artists.batch_id", "=", batchId)
    .orderBy("catalog.masters.discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("catalog.masters.discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "master",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: artistDiscogsId,
      link_type: "masters",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getLabelReleases(
  db: Kysely<Database>,
  labelDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.release_labels")
    .innerJoin("catalog.releases", (join) =>
      join
        .onRef("catalog.releases.discogs_id", "=", "catalog.release_labels.release_discogs_id")
        .on("catalog.releases.batch_id", "=", batchId),
    )
    .select([
      "catalog.releases.discogs_id",
      "catalog.releases.title",
      "catalog.releases.release_year as year",
    ])
    .where("catalog.release_labels.label_discogs_id", "=", labelDiscogsId)
    .where("catalog.release_labels.batch_id", "=", batchId)
    .orderBy("catalog.releases.discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("catalog.releases.discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "release",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "label",
      source_discogs_id: labelDiscogsId,
      link_type: "releases",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getMasterReleases(
  db: Kysely<Database>,
  masterDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.releases")
    .select(["discogs_id", "title", "release_year as year"])
    .where("master_discogs_id", "=", masterDiscogsId)
    .where("batch_id", "=", batchId)
    .orderBy("discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "release",
      discogs_id: r.discogs_id,
      title: r.title,
      year: r.year,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "master",
      source_discogs_id: masterDiscogsId,
      link_type: "releases",
      elapsed_ms: Date.now() - start,
    },
  };
}

export async function getReleaseCredits(
  db: Kysely<Database>,
  releaseDiscogsId: number,
  batchId: string,
  dumpDate: string,
  limit = DEFAULT_LIMIT,
  cursor?: string,
): Promise<TraversalResponse> {
  const start = Date.now();
  const lim = Math.min(Math.max(limit, 1), MAX_LIMIT);
  const afterId = cursor ? decodeCursor(cursor) : null;

  let query = db
    .selectFrom("catalog.release_credits")
    .select(["artist_discogs_id as discogs_id", "artist_name as name", "role"])
    .where("release_discogs_id", "=", releaseDiscogsId)
    .where("batch_id", "=", batchId)
    .orderBy("artist_discogs_id", "asc")
    .limit(lim + 1);

  if (afterId !== null) {
    query = query.where("artist_discogs_id", ">", afterId);
  }

  const rows = await query.execute();
  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  return {
    links: resultRows.map((r) => ({
      type: "artist",
      discogs_id: r.discogs_id,
      name: r.name,
      role: r.role,
      provenance: { source: "discogs", dump_date: dumpDate, discogs_id: r.discogs_id },
    })),
    pagination: {
      cursor: hasMore && resultRows.length > 0
        ? encodeCursor(resultRows[resultRows.length - 1].discogs_id)
        : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "release",
      source_discogs_id: releaseDiscogsId,
      link_type: "credits",
      elapsed_ms: Date.now() - start,
    },
  };
}
