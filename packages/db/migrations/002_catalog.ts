import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE SCHEMA IF NOT EXISTS catalog`.execute(db);

  // =========================================================================
  // Core entities
  // =========================================================================

  await db.schema
    .createTable("catalog.artists")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("discogs_id", "integer", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("real_name", "text")
    .addColumn("profile", "text")
    .addColumn("data_quality", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addColumn("search_vector", sql`tsvector`)
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("uq_artists_batch_discogs", ["batch_id", "discogs_id"])
    .execute();

  await db.schema
    .createTable("catalog.labels")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("discogs_id", "integer", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("profile", "text")
    .addColumn("contact_info", "text")
    .addColumn("data_quality", "text", (col) => col.notNull())
    .addColumn("parent_label_discogs_id", "integer") // no FK — orphans possible
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addColumn("search_vector", sql`tsvector`)
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("uq_labels_batch_discogs", ["batch_id", "discogs_id"])
    .execute();

  await db.schema
    .createTable("catalog.masters")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("discogs_id", "integer", (col) => col.notNull())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("main_release_discogs_id", "integer") // no FK — cross-entity
    .addColumn("year", "integer")
    .addColumn("data_quality", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addColumn("search_vector", sql`tsvector`)
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("uq_masters_batch_discogs", ["batch_id", "discogs_id"])
    .execute();

  await db.schema
    .createTable("catalog.releases")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("discogs_id", "integer", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("country", "text")
    .addColumn("released_raw", "text")
    .addColumn("release_year", "integer")
    .addColumn("release_month", "integer")
    .addColumn("release_day", "integer")
    .addColumn("notes", "text")
    .addColumn("data_quality", "text", (col) => col.notNull())
    .addColumn("master_discogs_id", "integer") // no FK — cross-entity
    .addColumn("is_main_release", "boolean")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addColumn("search_vector", sql`tsvector`)
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint("uq_releases_batch_discogs", ["batch_id", "discogs_id"])
    .execute();

  // =========================================================================
  // Artist child tables
  // =========================================================================

  await db.schema
    .createTable("catalog.artist_urls")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_artist_urls", ["batch_id", "artist_discogs_id", "url"])
    .execute();

  await db.schema
    .createTable("catalog.artist_name_variations")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_artist_nvs", ["batch_id", "artist_discogs_id", "name"])
    .execute();

  await db.schema
    .createTable("catalog.artist_aliases")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("alias_name", "text", (col) => col.notNull())
    .addColumn("alias_discogs_id", "integer")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_artist_aliases", ["batch_id", "artist_discogs_id", "alias_name"])
    .execute();

  await db.schema
    .createTable("catalog.artist_groups")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("group_name", "text", (col) => col.notNull())
    .addColumn("group_discogs_id", "integer")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_artist_groups", ["batch_id", "artist_discogs_id", "group_name"])
    .execute();

  await db.schema
    .createTable("catalog.artist_members")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("member_name", "text", (col) => col.notNull())
    .addColumn("member_discogs_id", "integer")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_artist_members", ["batch_id", "artist_discogs_id", "member_name"])
    .execute();

  // =========================================================================
  // Label child tables
  // =========================================================================

  await db.schema
    .createTable("catalog.label_urls")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("label_discogs_id", "integer", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_label_urls", ["batch_id", "label_discogs_id", "url"])
    .execute();

  // =========================================================================
  // Master child tables
  // =========================================================================

  await db.schema
    .createTable("catalog.master_artists")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("master_discogs_id", "integer", (col) => col.notNull())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("artist_name", "text", (col) => col.notNull())
    .addColumn("anv", "text")
    .addColumn("join_relation", "text")
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_master_artists", ["batch_id", "master_discogs_id", "position"])
    .execute();

  await db.schema
    .createTable("catalog.master_genres")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("master_discogs_id", "integer", (col) => col.notNull())
    .addColumn("genre", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_master_genres", ["batch_id", "master_discogs_id", "genre"])
    .execute();

  await db.schema
    .createTable("catalog.master_styles")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("master_discogs_id", "integer", (col) => col.notNull())
    .addColumn("style", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_master_styles", ["batch_id", "master_discogs_id", "style"])
    .execute();

  await db.schema
    .createTable("catalog.master_videos")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("master_discogs_id", "integer", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("duration_seconds", "integer")
    .addColumn("title", "text")
    .addColumn("description", "text")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_master_videos", ["batch_id", "master_discogs_id", "url"])
    .execute();

  // =========================================================================
  // Release child tables
  // =========================================================================

  await db.schema
    .createTable("catalog.release_artists")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("artist_name", "text", (col) => col.notNull())
    .addColumn("anv", "text")
    .addColumn("join_relation", "text")
    .addColumn("role", "text")
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_release_artists", ["batch_id", "release_discogs_id", "position"])
    .execute();

  await db.schema
    .createTable("catalog.release_credits")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("artist_name", "text", (col) => col.notNull())
    .addColumn("anv", "text")
    .addColumn("role", "text")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .execute();

  // Credits unique constraint uses COALESCE for nullable role
  await sql`
    CREATE UNIQUE INDEX uq_release_credits
    ON catalog.release_credits(batch_id, release_discogs_id, artist_discogs_id, COALESCE(role, ''))
  `.execute(db);

  await db.schema
    .createTable("catalog.release_labels")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("label_discogs_id", "integer", (col) => col.notNull())
    .addColumn("label_name", "text", (col) => col.notNull())
    .addColumn("catno", "text")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_release_labels
    ON catalog.release_labels(batch_id, release_discogs_id, label_discogs_id, COALESCE(catno, ''))
  `.execute(db);

  await db.schema
    .createTable("catalog.release_formats")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("name", "text", (col) => col.notNull())
    .addColumn("qty", "integer")
    .addColumn("text", "text")
    .addColumn("descriptions", sql`text[]`)
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_release_formats", ["batch_id", "release_discogs_id", "position"])
    .execute();

  await db.schema
    .createTable("catalog.release_genres")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("genre", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_release_genres", ["batch_id", "release_discogs_id", "genre"])
    .execute();

  await db.schema
    .createTable("catalog.release_styles")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("style", "text", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_release_styles", ["batch_id", "release_discogs_id", "style"])
    .execute();

  await db.schema
    .createTable("catalog.release_identifiers")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("type", "text", (col) => col.notNull())
    .addColumn("value", "text", (col) => col.notNull())
    .addColumn("description", "text")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_release_identifiers
    ON catalog.release_identifiers(batch_id, release_discogs_id, type, value, COALESCE(description, ''))
  `.execute(db);

  await db.schema
    .createTable("catalog.release_companies")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("company_discogs_id", "integer", (col) => col.notNull())
    .addColumn("company_name", "text", (col) => col.notNull())
    .addColumn("catno", "text")
    .addColumn("entity_type", "text")
    .addColumn("entity_type_name", "text")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_release_companies", ["batch_id", "release_discogs_id", "company_discogs_id", "entity_type"])
    .execute();

  await db.schema
    .createTable("catalog.release_videos")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("url", "text", (col) => col.notNull())
    .addColumn("duration_seconds", "integer")
    .addColumn("title", "text")
    .addColumn("description", "text")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_release_videos", ["batch_id", "release_discogs_id", "url"])
    .execute();

  // =========================================================================
  // Track tables
  // =========================================================================

  await db.schema
    .createTable("catalog.tracks")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("release_discogs_id", "integer", (col) => col.notNull())
    .addColumn("position_raw", "text")
    .addColumn("disc_number", "integer")
    .addColumn("track_number", "text")
    .addColumn("title", "text")
    .addColumn("duration_raw", "text")
    .addColumn("duration_seconds", "integer")
    .addColumn("position", "integer", (col) => col.notNull())
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addUniqueConstraint("uq_tracks", ["batch_id", "release_discogs_id", "position"])
    .execute();

  await db.schema
    .createTable("catalog.track_credits")
    .addColumn("id", "serial", (col) => col.primaryKey())
    .addColumn("track_id", "integer", (col) => col.notNull().references("catalog.tracks.id").onDelete("cascade"))
    .addColumn("artist_discogs_id", "integer", (col) => col.notNull())
    .addColumn("artist_name", "text", (col) => col.notNull())
    .addColumn("anv", "text")
    .addColumn("role", "text")
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_track_credits
    ON catalog.track_credits(batch_id, track_id, artist_discogs_id, COALESCE(role, ''))
  `.execute(db);

  // =========================================================================
  // FTS indexes (GIN on tsvector)
  // =========================================================================

  await sql`CREATE INDEX idx_artists_search ON catalog.artists USING GIN(search_vector)`.execute(db);
  await sql`CREATE INDEX idx_labels_search ON catalog.labels USING GIN(search_vector)`.execute(db);
  await sql`CREATE INDEX idx_masters_search ON catalog.masters USING GIN(search_vector)`.execute(db);
  await sql`CREATE INDEX idx_releases_search ON catalog.releases USING GIN(search_vector)`.execute(db);

  // =========================================================================
  // pg_trgm indexes (fuzzy name/title search)
  // =========================================================================

  await sql`CREATE INDEX idx_artists_name_trgm ON catalog.artists USING GIN(name gin_trgm_ops)`.execute(db);
  await sql`CREATE INDEX idx_labels_name_trgm ON catalog.labels USING GIN(name gin_trgm_ops)`.execute(db);
  await sql`CREATE INDEX idx_masters_title_trgm ON catalog.masters USING GIN(title gin_trgm_ops)`.execute(db);
  await sql`CREATE INDEX idx_releases_title_trgm ON catalog.releases USING GIN(title gin_trgm_ops)`.execute(db);

  // =========================================================================
  // Lookup indexes (batch-scoped parent lookups on child tables)
  // =========================================================================

  // Artist children
  await sql`CREATE INDEX idx_artist_urls_lookup ON catalog.artist_urls(batch_id, artist_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_artist_nvs_lookup ON catalog.artist_name_variations(batch_id, artist_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_artist_aliases_lookup ON catalog.artist_aliases(batch_id, artist_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_artist_groups_lookup ON catalog.artist_groups(batch_id, artist_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_artist_members_lookup ON catalog.artist_members(batch_id, artist_discogs_id)`.execute(db);

  // Label children
  await sql`CREATE INDEX idx_label_urls_lookup ON catalog.label_urls(batch_id, label_discogs_id)`.execute(db);

  // Master children
  await sql`CREATE INDEX idx_master_artists_lookup ON catalog.master_artists(batch_id, master_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_master_genres_lookup ON catalog.master_genres(batch_id, master_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_master_styles_lookup ON catalog.master_styles(batch_id, master_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_master_videos_lookup ON catalog.master_videos(batch_id, master_discogs_id)`.execute(db);

  // Release children
  await sql`CREATE INDEX idx_release_artists_lookup ON catalog.release_artists(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_credits_lookup ON catalog.release_credits(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_labels_lookup ON catalog.release_labels(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_formats_lookup ON catalog.release_formats(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_genres_lookup ON catalog.release_genres(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_styles_lookup ON catalog.release_styles(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_genres_genre ON catalog.release_genres(batch_id, genre, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_styles_style ON catalog.release_styles(batch_id, style, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_identifiers_lookup ON catalog.release_identifiers(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_companies_lookup ON catalog.release_companies(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_videos_lookup ON catalog.release_videos(batch_id, release_discogs_id)`.execute(db);

  // Track children
  await sql`CREATE INDEX idx_tracks_lookup ON catalog.tracks(batch_id, release_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_track_credits_lookup ON catalog.track_credits(batch_id, track_id)`.execute(db);

  // =========================================================================
  // Filter indexes
  // =========================================================================

  await sql`CREATE INDEX idx_releases_year ON catalog.releases(batch_id, release_year)`.execute(db);
  await sql`CREATE INDEX idx_masters_year ON catalog.masters(batch_id, year)`.execute(db);
  await sql`CREATE INDEX idx_releases_country ON catalog.releases(batch_id, country)`.execute(db);
  await sql`CREATE INDEX idx_releases_status ON catalog.releases(batch_id, status)`.execute(db);

  // =========================================================================
  // Reverse-lookup indexes (find releases by artist/label)
  // =========================================================================

  await sql`CREATE INDEX idx_release_artists_artist ON catalog.release_artists(batch_id, artist_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_credits_artist ON catalog.release_credits(batch_id, artist_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_release_labels_label ON catalog.release_labels(batch_id, label_discogs_id)`.execute(db);
  await sql`CREATE INDEX idx_master_artists_artist ON catalog.master_artists(batch_id, artist_discogs_id)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop in reverse dependency order
  await db.schema.dropTable("catalog.track_credits").ifExists().execute();
  await db.schema.dropTable("catalog.tracks").ifExists().execute();
  await db.schema.dropTable("catalog.release_videos").ifExists().execute();
  await db.schema.dropTable("catalog.release_companies").ifExists().execute();
  await db.schema.dropTable("catalog.release_identifiers").ifExists().execute();
  await db.schema.dropTable("catalog.release_styles").ifExists().execute();
  await db.schema.dropTable("catalog.release_genres").ifExists().execute();
  await db.schema.dropTable("catalog.release_formats").ifExists().execute();
  await db.schema.dropTable("catalog.release_labels").ifExists().execute();
  await db.schema.dropTable("catalog.release_credits").ifExists().execute();
  await db.schema.dropTable("catalog.release_artists").ifExists().execute();
  await db.schema.dropTable("catalog.master_videos").ifExists().execute();
  await db.schema.dropTable("catalog.master_styles").ifExists().execute();
  await db.schema.dropTable("catalog.master_genres").ifExists().execute();
  await db.schema.dropTable("catalog.master_artists").ifExists().execute();
  await db.schema.dropTable("catalog.label_urls").ifExists().execute();
  await db.schema.dropTable("catalog.artist_members").ifExists().execute();
  await db.schema.dropTable("catalog.artist_groups").ifExists().execute();
  await db.schema.dropTable("catalog.artist_aliases").ifExists().execute();
  await db.schema.dropTable("catalog.artist_name_variations").ifExists().execute();
  await db.schema.dropTable("catalog.artist_urls").ifExists().execute();
  await db.schema.dropTable("catalog.releases").ifExists().execute();
  await db.schema.dropTable("catalog.masters").ifExists().execute();
  await db.schema.dropTable("catalog.labels").ifExists().execute();
  await db.schema.dropTable("catalog.artists").ifExists().execute();
  await sql`DROP SCHEMA IF EXISTS catalog CASCADE`.execute(db);
}
