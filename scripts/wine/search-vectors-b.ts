/**
 * search-vectors-b.ts - tsvectors for agent B's tables (appellations, grapes,
 * appellation_documents). Names weight A, every other spelling B, country C;
 * documents are indexed on the first 200k characters of text.
 *
 * Idempotent: recomputes every row. `unaccent` must be installed (it is).
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/search-vectors-b.ts
 */
import type pg from "pg";
import { connect } from "./lib";

/**
 * Recompute agent B's vectors on a caller's pool. search-vectors.ts (agent C)
 * calls this after resolve-appellations.ts adds appellation_names rows, so the
 * LWIN spellings are indexed too; running this file directly still works.
 */
export async function runVectorsB(pool: pg.Pool): Promise<void> {
  const sql = [
    `UPDATE wine.appellations SET search_vector = setweight(to_tsvector('simple', unaccent(name)), 'A') || setweight(to_tsvector('simple', unaccent(coalesce((select string_agg(n.name,' ') from wine.appellation_names n where n.appellation_id = appellations.id),''))), 'B') || setweight(to_tsvector('simple', coalesce(country,'')), 'C')`,
    `UPDATE wine.grapes SET search_vector = setweight(to_tsvector('simple', unaccent(name)), 'A') || setweight(to_tsvector('simple', unaccent(coalesce((select string_agg(n.name,' ') from wine.grape_names n where n.grape_id = grapes.id),''))), 'B')`,
    `UPDATE wine.appellation_documents SET search_vector = to_tsvector('simple', unaccent(left(text, 200000)))`,
  ];
  for (const q of sql) {
    const res = await pool.query(q);
    console.log(`${res.rowCount} rows <- ${q.slice(0, 46)}...`);
  }
}

async function main() {
  const pool = connect();
  await runVectorsB(pool);
  await pool.end();
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
