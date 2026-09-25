/**
 * Migration 037: Restore enrich.usage_counters.
 *
 * 026 dropped the table at the scoped cutover, expecting it to be "recreated
 * fresh by whatever instrumentation we wire up". The public ask gate
 * (apps/api/src/routes/v1/ask/public.ts) became that instrumentation - its
 * monthly till per bore lives here - but nothing recreated the table. The
 * live DB has it (made by hand); a freshly migrated one did not, so the gate
 * failed closed and both public Bores read "Till's playing up" (CI's
 * integration tests caught exactly this).
 *
 * Same shape as 016. A no-op wherever the table already exists.
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

// Deliberately not dropped on the way down: the live till depends on it.
export async function down(): Promise<void> {}
