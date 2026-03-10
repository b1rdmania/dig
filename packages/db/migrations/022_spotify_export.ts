import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  // Add per-track match results to export jobs
  await sql`
    ALTER TABLE auth.mixtape_export_jobs
    ADD COLUMN IF NOT EXISTS track_results jsonb
  `.execute(db);

  // Index for polling by user
  await sql`
    CREATE INDEX IF NOT EXISTS mixtape_export_jobs_user_id_idx
    ON auth.mixtape_export_jobs (user_id)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE auth.mixtape_export_jobs DROP COLUMN IF EXISTS track_results`.execute(db);
  await sql`DROP INDEX IF EXISTS auth.mixtape_export_jobs_user_id_idx`.execute(db);
}
