import type { Kysely } from "kysely";
import { sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  // Schemas
  await sql`CREATE SCHEMA IF NOT EXISTS auth`.execute(db);
  await sql`CREATE SCHEMA IF NOT EXISTS ingest`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm"`.execute(db);

  // Auth tables (designed now, enforced later)
  await db.schema
    .createTable("auth.users")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("email", "text", (col) => col.notNull().unique())
    .addColumn("role", "text", (col) => col.notNull().defaultTo("public"))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("auth.api_keys")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("user_id", "uuid", (col) => col.notNull().references("auth.users.id"))
    .addColumn("key_hash", "text", (col) => col.notNull().unique())
    .addColumn("label", "text")
    .addColumn("rate_limit_tier", "text", (col) => col.notNull().defaultTo("public"))
    .addColumn("active", "boolean", (col) => col.notNull().defaultTo(true))
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Ingest tables
  await db.schema
    .createTable("ingest.dump_batches")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("dump_date", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("pending"))
    .addColumn("started_at", "timestamptz")
    .addColumn("completed_at", "timestamptz")
    .addColumn("stats", "jsonb")
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createTable("ingest.raw_entities")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`uuid_generate_v4()`))
    .addColumn("batch_id", "uuid", (col) => col.notNull().references("ingest.dump_batches.id"))
    .addColumn("entity_type", "text", (col) => col.notNull())
    .addColumn("discogs_id", "integer", (col) => col.notNull())
    .addColumn("raw_payload", "jsonb", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  // Index for lookups by batch + entity
  await db.schema
    .createIndex("idx_raw_entities_batch_type_discogs")
    .on("ingest.raw_entities")
    .columns(["batch_id", "entity_type", "discogs_id"])
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable("ingest.raw_entities").ifExists().execute();
  await db.schema.dropTable("ingest.dump_batches").ifExists().execute();
  await db.schema.dropTable("auth.api_keys").ifExists().execute();
  await db.schema.dropTable("auth.users").ifExists().execute();
  await sql`DROP SCHEMA IF EXISTS ingest CASCADE`.execute(db);
  await sql`DROP SCHEMA IF EXISTS auth CASCADE`.execute(db);
}
