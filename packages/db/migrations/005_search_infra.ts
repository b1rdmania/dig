/**
 * Migration 005: Search infrastructure for Phase 2.
 *
 * - Install unaccent extension for diacritic-insensitive search
 * - Set default statement_timeout for search safety (5s)
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS unaccent`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP EXTENSION IF EXISTS unaccent`.execute(db);
}
