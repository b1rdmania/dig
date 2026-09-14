/**
 * search-vectors.ts - the tsvectors for agent A's tables (producers, wines,
 * listings), plus a re-run of agent B's (appellations, grapes, documents) so
 * the appellation_names rows resolve-appellations.ts added are indexed.
 *
 * Weights follow what search_cellar has to rank:
 *   producers   A display_name   B name             C region + country_name
 *   wines       A display_name   B wine_name        C producer display_name
 *                                D sub_region, region, appellation name
 *   listings    A wine_name      B producer_name    C region_l1 + region_l2
 *
 * 'simple' config, unaccented: the corpus is six languages deep and an
 * English snowball stemmer mangles "Chateauneuf" and swallows names that are
 * stop words in one language and a domaine in another. unaccent means
 * "Perrieres" finds "Perrières".
 *
 * wine.wines is 190k rows with a correlated subquery per row, so it is
 * updated in 20,000-lwin windows rather than one transaction that holds
 * every row's lock and one snapshot for minutes.
 *
 * wine.listings has no search_vector in migration 034; this script adds the
 * column and its GIN index if they are missing.
 *
 * Idempotent: recomputes every row. Each table is ANALYZEd after.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/search-vectors.ts
 */
import { connect, logLoad } from "./lib";
import { runVectorsB } from "./search-vectors-b";

const CHUNK = 20_000;

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  // ---- producers ------------------------------------------------------
  const prod = await pool.query(`
    UPDATE wine.producers SET search_vector =
        setweight(to_tsvector('simple', unaccent(display_name)), 'A')
     || setweight(to_tsvector('simple', unaccent(name)), 'B')
     || setweight(to_tsvector('simple', unaccent(coalesce(region,'') || ' ' || coalesce(country_name,''))), 'C')
  `);
  notes.producers = prod.rowCount ?? 0;
  console.log(`producers ${notes.producers}`);

  // ---- wines, in lwin windows -----------------------------------------
  const { rows: bounds } = await pool.query(`SELECT min(lwin)::bigint lo, max(lwin)::bigint hi FROM wine.wines`);
  const lo = Number(bounds[0].lo);
  const hi = Number(bounds[0].hi);
  let wines = 0;
  let windows = 0;
  for (let start = lo; start <= hi; start += CHUNK) {
    const res = await pool.query(`
      UPDATE wine.wines w SET search_vector =
          setweight(to_tsvector('simple', unaccent(w.display_name)), 'A')
       || setweight(to_tsvector('simple', unaccent(coalesce(w.wine_name,''))), 'B')
       || setweight(to_tsvector('simple', unaccent(coalesce(
              (SELECT p.display_name FROM wine.producers p WHERE p.id = w.producer_id), ''))), 'C')
       || setweight(to_tsvector('simple', unaccent(
              coalesce(w.sub_region,'') || ' ' || coalesce(w.region,'') || ' ' || coalesce(
              (SELECT a.name FROM wine.appellations a WHERE a.id = w.appellation_id), ''))), 'D')
       WHERE w.lwin >= $1 AND w.lwin < $2
    `, [start, start + CHUNK]);
    wines += res.rowCount ?? 0;
    windows++;
  }
  notes.wines = wines;
  notes.wine_windows = windows;
  console.log(`wines ${wines} in ${windows} windows of ${CHUNK}`);

  // ---- listings -------------------------------------------------------
  // Migration 034 gave listings no search_vector (they were the demo-only
  // table and nothing searched them). The column and its index are added here
  // rather than in a new migration; if listings become a first-class search
  // surface this belongs in 035.
  await pool.query(`ALTER TABLE wine.listings ADD COLUMN IF NOT EXISTS search_vector TSVECTOR`);
  await pool.query(`CREATE INDEX IF NOT EXISTS wine_listings_sv_idx ON wine.listings USING GIN (search_vector)`);
  const lst = await pool.query(`
    UPDATE wine.listings SET search_vector =
        setweight(to_tsvector('simple', unaccent(wine_name)), 'A')
     || setweight(to_tsvector('simple', unaccent(coalesce(producer_name,''))), 'B')
     || setweight(to_tsvector('simple', unaccent(coalesce(region_l1,'') || ' ' || coalesce(region_l2,''))), 'C')
  `);
  notes.listings = lst.rowCount ?? 0;
  console.log(`listings ${notes.listings}`);

  // ---- agent B's tables, with the new LWIN aliases --------------------
  await runVectorsB(pool);

  for (const t of ["producers", "wines", "listings", "appellations", "appellation_names", "grapes", "appellation_documents"]) {
    await pool.query(`ANALYZE wine.${t}`);
  }

  await logLoad(pool, "search-vectors", {
    rows_out: (notes.producers as number) + wines + (notes.listings as number),
  }, notes);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
