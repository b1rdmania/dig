import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS auth.user_saved_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      discogs_id INTEGER NOT NULL,
      list_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, list_type, entity_type, discogs_id)
    )
  `.execute(db);

  await sql`
    CREATE INDEX IF NOT EXISTS idx_user_saved_items_user
    ON auth.user_saved_items (user_id, list_type)
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS auth.user_saved_items`.execute(db);
}
