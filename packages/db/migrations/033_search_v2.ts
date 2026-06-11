/**
 * Migration 033: Search v2 — simple-config vectors, top-match indexes,
 * search-quality telemetry rollup.
 *
 * 1. Rebuild catalog search_vectors with the 'simple' regconfig.
 *    The catalog is proper nouns — artist names, label names, record titles.
 *    The 'english' config stems them ("Loveless" → "loveless" is fine, but
 *    "Ones" → "one" collides) and silently deletes stop-word names outright:
 *    "Them", "Who", "It" produce an EMPTY tsvector and can never be found.
 *    'simple' lowercases and splits, nothing else — names survive intact.
 *    Query side moves to to_tsquery('simple', ...) with a prefix-matched
 *    last token (packages/domain/src/search.ts).
 *
 * 2. Expression indexes on lower(trim(name)) for artists + labels.
 *    findTopMatch() runs this equality on every untyped search; without the
 *    index it is a seq scan per keystroke.
 *
 * 3. enrich.search_quality_daily — closes the search telemetry loop.
 *    The web client already emits search_submitted {query, result_count}
 *    and search_result_clicked {query, position}; until now those were
 *    flattened into stdout logs and aggregated only as counts. This table
 *    keeps a per-day, per-normalized-query rollup so zero-result rate and
 *    CTR are queryable (scripts/search-quality-report.ts).
 *
 * Down: reverts vectors to 'english', drops the indexes and the table.
 */
import { type Kysely, sql } from "kysely";

const VECTOR_SQL: Record<"simple" | "english", Record<string, string>> = {
  simple: {
    masters: `
          setweight(to_tsvector('simple', coalesce(title, '')), 'A')
       || setweight(to_tsvector('simple', coalesce(primary_artist_name, '')), 'B')
       || setweight(to_tsvector('simple', coalesce(artists_credit_text, '')), 'B')
       || setweight(to_tsvector('simple', coalesce(primary_label_name, '')), 'C')
       || setweight(to_tsvector('simple', array_to_string(coalesce(styles, '{}'), ' ')), 'D')
       || setweight(to_tsvector('simple', array_to_string(coalesce(genres, '{}'), ' ')), 'D')`,
    artists: `
          setweight(to_tsvector('simple', coalesce(name, '')), 'A')
       || setweight(to_tsvector('simple', coalesce(real_name, '')), 'B')
       || setweight(to_tsvector('simple', array_to_string(coalesce(aliases_text, '{}'), ' ')), 'C')`,
    labels: `
          setweight(to_tsvector('simple', coalesce(name, '')), 'A')
       || setweight(to_tsvector('simple', array_to_string(coalesce(aliases_text, '{}'), ' ')), 'C')`,
  },
  english: {
    masters: `
          setweight(to_tsvector('english', coalesce(title, '')), 'A')
       || setweight(to_tsvector('english', coalesce(primary_artist_name, '')), 'B')
       || setweight(to_tsvector('english', coalesce(artists_credit_text, '')), 'B')
       || setweight(to_tsvector('english', coalesce(primary_label_name, '')), 'C')
       || setweight(to_tsvector('english', array_to_string(coalesce(styles, '{}'), ' ')), 'D')
       || setweight(to_tsvector('english', array_to_string(coalesce(genres, '{}'), ' ')), 'D')`,
    artists: `
          setweight(to_tsvector('english', coalesce(name, '')), 'A')
       || setweight(to_tsvector('english', coalesce(real_name, '')), 'B')
       || setweight(to_tsvector('english', array_to_string(coalesce(aliases_text, '{}'), ' ')), 'C')`,
    labels: `
          setweight(to_tsvector('english', coalesce(name, '')), 'A')
       || setweight(to_tsvector('english', array_to_string(coalesce(aliases_text, '{}'), ' ')), 'C')`,
  },
};

async function rebuildVectors(db: Kysely<any>, config: "simple" | "english"): Promise<void> {
  // Scoped catalog is ~360k rows total; this runs in minutes, but make sure
  // a conservative server-side statement_timeout can't kill it mid-flight.
  await sql`SET LOCAL statement_timeout = '30min'`.execute(db);
  for (const table of ["masters", "artists", "labels"] as const) {
    await sql.raw(`
      UPDATE catalog.${table}
      SET search_vector = ${VECTOR_SQL[config][table]}
    `).execute(db);
    await sql.raw(`ANALYZE catalog.${table}`).execute(db);
  }
}

export async function up(db: Kysely<any>): Promise<void> {
  await rebuildVectors(db, "simple");

  // findTopMatch() expression — must match the query text exactly.
  await sql`
    CREATE INDEX IF NOT EXISTS idx_artists_name_lower
      ON catalog.artists ((lower(trim(name))))
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS idx_labels_name_lower
      ON catalog.labels ((lower(trim(name))))
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS enrich.search_quality_daily (
      day                 DATE    NOT NULL,
      query               TEXT    NOT NULL,
      submits             INTEGER NOT NULL DEFAULT 0,
      zero_results        INTEGER NOT NULL DEFAULT 0,
      clicks              INTEGER NOT NULL DEFAULT 0,
      click_position_sum  INTEGER NOT NULL DEFAULT 0,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (day, query)
    )
  `.execute(db);

  await sql`
    COMMENT ON TABLE enrich.search_quality_daily IS
      'Per-day, per-normalized-query search telemetry rollup (submits, zero-result submits, result clicks, click-position sum). Fed by /v1/events via apps/api/src/metrics/usage.ts; read by scripts/search-quality-report.ts.'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await rebuildVectors(db, "english");
  await sql`DROP INDEX IF EXISTS catalog.idx_artists_name_lower`.execute(db);
  await sql`DROP INDEX IF EXISTS catalog.idx_labels_name_lower`.execute(db);
  await sql`DROP TABLE IF EXISTS enrich.search_quality_daily`.execute(db);
}
