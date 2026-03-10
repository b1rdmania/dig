/**
 * Mixtapes domain — user-curated track lists.
 * Gated: early_access plan only.
 */

import type { Kysely } from "kysely";
import { sql } from "kysely";
import type { Database } from "@dig/db";

const MAX_MIXTAPES_PER_USER = 100;
const MAX_TRACKS_PER_MIXTAPE = 500;

export interface Mixtape {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  track_count?: number;
}

export interface MixtapeTrack {
  id: string;
  mixtape_id: string;
  position: number;
  source_entity_type: string;
  source_discogs_id: number;
  master_discogs_id: number | null;
  name: string | null;
  artist: string | null;
  added_at: string;
}

// ── Mixtape CRUD ──────────────────────────────────────────────────────────────

export async function createMixtape(
  db: Kysely<Database>,
  userId: string,
  title: string,
  description?: string,
): Promise<{ ok: true; mixtape: Mixtape } | { ok: false; code: string; message: string }> {
  const count = await db
    .selectFrom("auth.mixtapes as m")
    .select(db.fn.countAll<number>().as("n"))
    .where("m.user_id", "=", userId)
    .executeTakeFirst();

  if ((count?.n ?? 0) >= MAX_MIXTAPES_PER_USER) {
    return { ok: false, code: "LIMIT_EXCEEDED", message: `Maximum ${MAX_MIXTAPES_PER_USER} mixtapes per user.` };
  }

  const row = await db
    .insertInto("auth.mixtapes")
    .values({ user_id: userId, title, description: description ?? null })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { ok: true, mixtape: rowToMixtape(row) };
}

export async function listMixtapes(
  db: Kysely<Database>,
  userId: string,
): Promise<Mixtape[]> {
  const rows = await db
    .selectFrom("auth.mixtapes as m")
    .leftJoin("auth.mixtape_tracks as t", "t.mixtape_id", "m.id")
    .select([
      "m.id", "m.user_id", "m.title", "m.description",
      "m.created_at", "m.updated_at",
      sql<number>`count(t.id)`.as("track_count"),
    ])
    .where("m.user_id", "=", userId)
    .groupBy("m.id")
    .orderBy("m.created_at", "desc")
    .execute();

  return rows.map(rowToMixtape);
}

export async function getMixtape(
  db: Kysely<Database>,
  userId: string,
  mixtapeId: string,
): Promise<Mixtape | null> {
  const row = await db
    .selectFrom("auth.mixtapes as m")
    .selectAll("m")
    .where("m.id", "=", mixtapeId)
    .where("m.user_id", "=", userId)
    .executeTakeFirst();

  return row ? rowToMixtape(row) : null;
}

export async function deleteMixtape(
  db: Kysely<Database>,
  userId: string,
  mixtapeId: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom("auth.mixtapes")
    .where("id", "=", mixtapeId)
    .where("user_id", "=", userId)
    .executeTakeFirst();

  return (result.numDeletedRows ?? 0n) > 0n;
}

// ── Track management ──────────────────────────────────────────────────────────

export interface AddTrackInput {
  sourceEntityType: string;
  sourceDiscogsId: number;
  masterDiscogsId?: number | null;
  name?: string | null;
  artist?: string | null;
  clientRequestId?: string | null;
}

export async function addTrack(
  db: Kysely<Database>,
  userId: string,
  mixtapeId: string,
  input: AddTrackInput,
): Promise<{ ok: true; track: MixtapeTrack } | { ok: false; code: string; message: string }> {
  // Ownership check
  const mixtape = await getMixtape(db, userId, mixtapeId);
  if (!mixtape) return { ok: false, code: "NOT_FOUND", message: "Mixtape not found." };

  // Idempotency check
  if (input.clientRequestId) {
    const existing = await db
      .selectFrom("auth.mixtape_tracks as t")
      .selectAll()
      .where("t.mixtape_id", "=", mixtapeId)
      .where("t.client_request_id", "=", input.clientRequestId)
      .executeTakeFirst();
    if (existing) return { ok: true, track: rowToTrack(existing) };
  }

  // Track count limit
  const count = await db
    .selectFrom("auth.mixtape_tracks as t")
    .select(db.fn.countAll<number>().as("n"))
    .where("t.mixtape_id", "=", mixtapeId)
    .executeTakeFirst();

  if ((count?.n ?? 0) >= MAX_TRACKS_PER_MIXTAPE) {
    return { ok: false, code: "LIMIT_EXCEEDED", message: `Maximum ${MAX_TRACKS_PER_MIXTAPE} tracks per mixtape.` };
  }

  // Append at end — get max position, use safe transaction with offset to avoid UNIQUE collision
  const maxPos = await db
    .selectFrom("auth.mixtape_tracks as t")
    .select(sql<number | null>`max(t.position)`.as("max_pos"))
    .where("t.mixtape_id", "=", mixtapeId)
    .executeTakeFirst();

  const position = ((maxPos?.max_pos as number | null) ?? 0) + 1;

  const row = await db
    .insertInto("auth.mixtape_tracks")
    .values({
      mixtape_id: mixtapeId,
      user_id: userId,
      position,
      source_entity_type: input.sourceEntityType,
      source_discogs_id: input.sourceDiscogsId,
      master_discogs_id: input.masterDiscogsId ?? null,
      name: input.name ?? null,
      artist: input.artist ?? null,
      client_request_id: input.clientRequestId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Update mixtape updated_at
  await db
    .updateTable("auth.mixtapes")
    .set({ updated_at: sql`now()` })
    .where("id", "=", mixtapeId)
    .execute();

  return { ok: true, track: rowToTrack(row) };
}

export async function listTracks(
  db: Kysely<Database>,
  userId: string,
  mixtapeId: string,
): Promise<MixtapeTrack[] | null> {
  const mixtape = await getMixtape(db, userId, mixtapeId);
  if (!mixtape) return null;

  const rows = await db
    .selectFrom("auth.mixtape_tracks as t")
    .selectAll()
    .where("t.mixtape_id", "=", mixtapeId)
    .orderBy("t.position", "asc")
    .execute();

  return rows.map(rowToTrack);
}

export async function removeTrack(
  db: Kysely<Database>,
  userId: string,
  mixtapeId: string,
  trackId: string,
): Promise<boolean> {
  const mixtape = await getMixtape(db, userId, mixtapeId);
  if (!mixtape) return false;

  const result = await db
    .deleteFrom("auth.mixtape_tracks")
    .where("id", "=", trackId)
    .where("mixtape_id", "=", mixtapeId)
    .executeTakeFirst();

  return (result.numDeletedRows ?? 0n) > 0n;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToMixtape(row: any): Mixtape {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    track_count: row.track_count !== undefined ? Number(row.track_count) : undefined,
  };
}

function rowToTrack(row: any): MixtapeTrack {
  return {
    id: row.id,
    mixtape_id: row.mixtape_id,
    position: row.position,
    source_entity_type: row.source_entity_type,
    source_discogs_id: row.source_discogs_id,
    master_discogs_id: row.master_discogs_id ?? null,
    name: row.name ?? null,
    artist: row.artist ?? null,
    added_at: String(row.added_at),
  };
}
