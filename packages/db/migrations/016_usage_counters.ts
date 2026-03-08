/**
 * Migration 016: Persistent usage counters.
 *
 * Stores cumulative usage stats for the public usage page.
 * Additive only: does not modify catalog or enrichment entities.
 */

import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.usage_counters (
      counter_key TEXT PRIMARY KEY,
      counter_value BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.usage_counters`.execute(db);
}
