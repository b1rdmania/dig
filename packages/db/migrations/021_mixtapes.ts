import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // Mixtapes: user-curated track lists
  await db.schema
    .createTable("auth.mixtapes")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Mixtape tracks: individual entries in a mixtape
  await db.schema
    .createTable("auth.mixtape_tracks")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("mixtape_id", "uuid", (col) => col.notNull().references("auth.mixtapes.id").onDelete("cascade"))
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("position", "integer", (col) => col.notNull())
    // Source entity (what the user added)
    .addColumn("source_entity_type", "text", (col) => col.notNull()) // "master"|"release"|"version"
    .addColumn("source_discogs_id", "integer", (col) => col.notNull())
    // Resolved master id (nullable — not all releases have a master)
    .addColumn("master_discogs_id", "integer")
    // Denormalized display fields (populated at insert time)
    .addColumn("name", "text")   // track or release title
    .addColumn("artist", "text") // primary artist name
    // Idempotency
    .addColumn("client_request_id", "text")
    .addColumn("added_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Spotify OAuth tokens (Phase 2 — table created now, populated later)
  await db.schema
    .createTable("auth.spotify_tokens")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("user_id", "text", (col) => col.notNull().unique())
    .addColumn("access_token_enc", "text", (col) => col.notNull())  // encrypted
    .addColumn("refresh_token_enc", "text", (col) => col.notNull()) // encrypted
    .addColumn("token_type", "text", (col) => col.notNull().defaultTo("Bearer"))
    .addColumn("scopes", "text", (col) => col.notNull().defaultTo(""))
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Export jobs (Phase 2 — async export tracking)
  await db.schema
    .createTable("auth.mixtape_export_jobs")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("mixtape_id", "uuid", (col) => col.notNull().references("auth.mixtapes.id").onDelete("cascade"))
    .addColumn("user_id", "text", (col) => col.notNull())
    .addColumn("platform", "text", (col) => col.notNull()) // "spotify"|"apple_music"
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending")) // pending|running|succeeded|failed
    .addColumn("platform_playlist_id", "text")
    .addColumn("platform_playlist_url", "text")
    .addColumn("tracks_matched", "integer")
    .addColumn("tracks_total", "integer")
    .addColumn("error_message", "text")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Indexes
  await sql`CREATE INDEX mixtapes_user_id_idx ON auth.mixtapes (user_id)`.execute(db);
  await sql`CREATE INDEX mixtape_tracks_mixtape_id_idx ON auth.mixtape_tracks (mixtape_id)`.execute(db);
  await sql`CREATE UNIQUE INDEX mixtape_tracks_position_idx ON auth.mixtape_tracks (mixtape_id, position)`.execute(db);
  await sql`CREATE UNIQUE INDEX mixtape_tracks_idempotency_idx ON auth.mixtape_tracks (mixtape_id, client_request_id) WHERE client_request_id IS NOT NULL`.execute(db);
  await sql`CREATE INDEX mixtape_export_jobs_mixtape_id_idx ON auth.mixtape_export_jobs (mixtape_id)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("auth.mixtape_export_jobs").execute();
  await db.schema.dropTable("auth.spotify_tokens").execute();
  await db.schema.dropTable("auth.mixtape_tracks").execute();
  await db.schema.dropTable("auth.mixtapes").execute();
}
