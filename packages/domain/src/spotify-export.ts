/**
 * Spotify export domain logic.
 * Manages spotify_tokens CRUD and export job lifecycle.
 * Actual Spotify API calls are injected to keep domain framework-free.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";

// ── Token storage ─────────────────────────────────────────────────────────────

export interface StoredSpotifyToken {
  userId: string;
  accessTokenEnc: string;
  refreshTokenEnc: string;
  tokenType: string;
  scopes: string;
  expiresAt: Date;
}

export async function upsertSpotifyToken(
  db: Kysely<Database>,
  userId: string,
  accessTokenEnc: string,
  refreshTokenEnc: string,
  tokenType: string,
  scopes: string,
  expiresAt: Date,
): Promise<void> {
  await db
    .insertInto("auth.spotify_tokens")
    .values({
      user_id: userId,
      access_token_enc: accessTokenEnc,
      refresh_token_enc: refreshTokenEnc,
      token_type: tokenType,
      scopes,
      expires_at: expiresAt,
    })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({
        access_token_enc: accessTokenEnc,
        refresh_token_enc: refreshTokenEnc,
        token_type: tokenType,
        scopes,
        expires_at: expiresAt,
        updated_at: sql`now()`,
      }),
    )
    .execute();
}

export async function getSpotifyToken(
  db: Kysely<Database>,
  userId: string,
): Promise<StoredSpotifyToken | null> {
  const row = await db
    .selectFrom("auth.spotify_tokens")
    .selectAll()
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!row) return null;
  return {
    userId: row.user_id,
    accessTokenEnc: row.access_token_enc,
    refreshTokenEnc: row.refresh_token_enc,
    tokenType: row.token_type,
    scopes: row.scopes,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
  };
}

export async function deleteSpotifyToken(
  db: Kysely<Database>,
  userId: string,
): Promise<void> {
  await db
    .deleteFrom("auth.spotify_tokens")
    .where("user_id", "=", userId)
    .execute();
}

export function isTokenExpired(token: StoredSpotifyToken): boolean {
  // Refresh 60 seconds before expiry
  return token.expiresAt.getTime() < Date.now() + 60_000;
}

// ── Export job management ─────────────────────────────────────────────────────

export interface ExportJob {
  id: string;
  mixtape_id: string;
  user_id: string;
  platform: string;
  status: string;
  platform_playlist_id: string | null;
  platform_playlist_url: string | null;
  tracks_matched: number | null;
  tracks_total: number | null;
  error_message: string | null;
  track_results: unknown | null;
  created_at: string;
  updated_at: string;
}

export async function createExportJob(
  db: Kysely<Database>,
  userId: string,
  mixtapeId: string,
  platform: "spotify",
): Promise<ExportJob> {
  const row = await db
    .insertInto("auth.mixtape_export_jobs")
    .values({
      mixtape_id: mixtapeId,
      user_id: userId,
      platform,
      status: "pending",
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return rowToJob(row);
}

export async function getExportJob(
  db: Kysely<Database>,
  userId: string,
  jobId: string,
): Promise<ExportJob | null> {
  const row = await db
    .selectFrom("auth.mixtape_export_jobs")
    .selectAll()
    .where("id", "=", jobId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  return row ? rowToJob(row) : null;
}

export async function listExportJobs(
  db: Kysely<Database>,
  userId: string,
  mixtapeId: string,
): Promise<ExportJob[]> {
  const rows = await db
    .selectFrom("auth.mixtape_export_jobs")
    .selectAll()
    .where("user_id", "=", userId)
    .where("mixtape_id", "=", mixtapeId)
    .orderBy("created_at", "desc")
    .limit(10)
    .execute();
  return rows.map(rowToJob);
}

export async function updateExportJob(
  db: Kysely<Database>,
  jobId: string,
  patch: Partial<{
    status: string;
    platform_playlist_id: string;
    platform_playlist_url: string;
    tracks_matched: number;
    tracks_total: number;
    error_message: string;
    track_results: unknown;
  }>,
): Promise<void> {
  await db
    .updateTable("auth.mixtape_export_jobs")
    .set({ ...patch, updated_at: sql`now()` })
    .where("id", "=", jobId)
    .execute();
}

function rowToJob(row: any): ExportJob {
  return {
    id: row.id,
    mixtape_id: row.mixtape_id,
    user_id: row.user_id,
    platform: row.platform,
    status: row.status,
    platform_playlist_id: row.platform_playlist_id ?? null,
    platform_playlist_url: row.platform_playlist_url ?? null,
    tracks_matched: row.tracks_matched ?? null,
    tracks_total: row.tracks_total ?? null,
    error_message: row.error_message ?? null,
    track_results: row.track_results ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}
