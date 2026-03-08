import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS enrich.usage_daily (
      day DATE NOT NULL,
      metric_key TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      route TEXT NOT NULL DEFAULT '',
      count BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS usage_daily_pk
    ON enrich.usage_daily (day, metric_key, entity_type, route)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS usage_daily_by_day
    ON enrich.usage_daily (day DESC, metric_key)
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS usage_daily_by_metric
    ON enrich.usage_daily (metric_key, day DESC)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS enrich.usage_daily`.execute(db);
}
