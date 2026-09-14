/**
 * load-systembolaget.ts - the Swedish monopoly catalogue as demo-only listings.
 *
 * An unofficial Nov-2025 archive snapshot: 9,990 products, of which 6,323 are
 * categoryLevel1 = 'Vin'. The rows carry what LWIN does not - a price, a
 * bottle size, and ~1,500 Swedish tasting notes - so they are worth joining
 * even though the licence is unstated. wine.sources marks the source
 * demo_only, and nothing outside a demo should quote a price from it.
 *
 * Two joins per row, both reported: producerName -> wine.producers (the
 * scripts/wine/match.ts cascade), then productNameThin -> that producer's
 * wines by norm containment or trgm >= 0.5.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/wine/load-systembolaget.ts
 */
import { resolve } from "node:path";
import { RAW, connect, countryCode, insertMany, intOrNull, logLoad, na, norm, numOrNull, readJson, upsertSource } from "./lib";
import { ProducerMatcher, bidiContains, trgmSimilarity } from "./match";

const SRC = "systembolaget";

/** categoryLevel2 -> colour. Swedish category names, one bucket each. */
const COLOUR: Record<string, string> = {
  "Rött vin": "red", "Vitt vin": "white", "Rosévin": "rose", "Mousserande vin": "sparkling",
  "Starkvin": "fortified", "Vermouth": "aromatised", "Aperitifer": "aromatised",
  "Smaksatt vin & fruktvin": "flavoured", "Glögg och Glühwein": "flavoured",
  "Sake": "sake", "Vinlåda": "mixed", "Drycker av flera typer": "mixed",
};

type Product = {
  productId: string;
  productNameBold?: string | null;
  productNameThin?: string | null;
  producerName?: string | null;
  country?: string | null;
  originLevel1?: string | null;
  originLevel2?: string | null;
  vintage?: string | null;
  grapes?: string[] | null;
  taste?: string | null;
  usage?: string | null;
  alcoholPercentage?: number | null;
  price?: number | null;
  volume?: number | null;
  categoryLevel1?: string | null;
  categoryLevel2?: string | null;
};

type WineCand = { lwin: string; wn: string; dn: string; live: boolean };

async function main(): Promise<void> {
  const pool = connect();

  await upsertSource(pool, {
    slug: SRC,
    name: "Systembolaget assortment (unofficial archive snapshot)",
    licence: "unofficial archive, no licence stated, Nov 2025 snapshot",
    pulled_at: "2026-09-03",
    demo_only: true,
    notes: "9,990 products; 6,323 categoryLevel1='Vin' loaded. Prices in SEK. Demo only.",
  });

  await pool.query(`DELETE FROM wine.wine_grapes WHERE source = $1`, [SRC]);
  await pool.query(`DELETE FROM wine.producer_links WHERE source = $1`, [SRC]);
  await pool.query(`DELETE FROM wine.listings WHERE source = $1`, [SRC]);

  const all = readJson<Product[]>(resolve(RAW, SRC, "assortment.json"));
  const wines = all.filter((p) => p.categoryLevel1 === "Vin");

  const matcher = new ProducerMatcher(pool);
  await matcher.load("lwin");
  const wineCache = new Map<number, WineCand[]>();

  const listings: unknown[][] = [];
  const links: unknown[][] = [];
  const grapes: unknown[][] = [];
  const grapeSeen = new Set<string>();
  const methods: Record<string, number> = {};
  const pMethods: Record<string, number> = {};
  let producerMatched = 0;
  let wineMatched = 0;
  let tasteRows = 0;
  let tasteWithLwin = 0;
  const unmatchedProducers: string[] = [];
  const unmatchedWines: string[] = [];

  for (const p of wines) {
    const countryName = na(p.country);
    const country = countryCode(countryName);
    const wineName = na(p.productNameThin) ?? na(p.productNameBold) ?? "(unnamed)";
    const producerName = na(p.producerName);

    const pm = await matcher.match(producerName, country);
    pMethods[pm.method] = (pMethods[pm.method] ?? 0) + 1;
    if (pm.producer_id) producerMatched++;
    else if (producerName && unmatchedProducers.length < 20) unmatchedProducers.push(producerName);

    let lwin: string | null = null;
    let method = "none";
    let score: number | null = null;

    if (pm.producer_id) {
      let cands = wineCache.get(pm.producer_id);
      if (!cands) {
        const res = await pool.query<{ lwin: string; wine_name: string | null; display_name: string; status: string }>(
          `SELECT lwin::text, wine_name, display_name, status FROM wine.wines WHERE producer_id = $1`,
          [pm.producer_id],
        );
        cands = res.rows.map((r) => ({
          lwin: r.lwin, wn: norm(r.wine_name), dn: norm(r.display_name), live: r.status === "Live",
        }));
        wineCache.set(pm.producer_id, cands);
      }
      const hit = matchWine(cands, na(p.productNameThin) ?? na(p.productNameBold));
      if (hit) { lwin = hit.lwin; method = hit.method; score = hit.score; }
    }
    if (lwin) wineMatched++;
    else if (pm.producer_id && unmatchedWines.length < 20) unmatchedWines.push(`${producerName ?? "?"} / ${wineName}`);
    methods[method] = (methods[method] ?? 0) + 1;

    const taste = na(p.taste);
    if (taste) { tasteRows++; if (lwin) tasteWithLwin++; }

    listings.push([
      SRC, p.productId, lwin, pm.producer_id, producerName, wineName, country, countryName,
      na(p.originLevel1), na(p.originLevel2), intOrNull(p.vintage),
      COLOUR[na(p.categoryLevel2) ?? ""] ?? null, na(p.categoryLevel2),
      (p.grapes ?? []).map((g) => String(g)), numOrNull(p.alcoholPercentage), numOrNull(p.price),
      "SEK", intOrNull(p.volume), taste, taste ? "sv" : null, na(p.usage), method, score,
    ]);

    if (pm.producer_id) {
      links.push([pm.producer_id, SRC, p.productId, producerName ?? wineName, null, "monopoly", pm.method, pm.score]);
    }
    if (lwin) {
      for (const g of p.grapes ?? []) {
        const raw = na(String(g));
        if (!raw) continue;
        const key = `${lwin}|${raw}`;
        if (grapeSeen.has(key)) continue;
        grapeSeen.add(key);
        grapes.push([lwin, null, raw, SRC]);
      }
    }
  }

  const listingsOut = await insertMany(
    pool, "wine.listings",
    ["source", "source_ref", "lwin", "producer_id", "producer_name", "wine_name", "country", "country_name",
      "region_l1", "region_l2", "vintage", "colour", "category", "grapes", "alcohol", "price", "currency",
      "volume_ml", "taste_text", "taste_lang", "serve_text", "match_method", "match_score"],
    listings, "ON CONFLICT (source, source_ref) DO NOTHING",
  );
  const linksOut = await insertMany(
    pool, "wine.producer_links",
    ["producer_id", "source", "source_ref", "name_as_found", "url", "kind", "match_method", "match_score"],
    links, "ON CONFLICT (source, source_ref) DO NOTHING",
  );
  const grapesOut = await insertMany(
    pool, "wine.wine_grapes", ["lwin", "grape_id", "grape_name_raw", "source"], grapes,
    "ON CONFLICT (lwin, grape_name_raw, source) DO NOTHING",
  );

  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "0%");
  await logLoad(pool, "load-systembolaget", {
    rows_in: all.length, rows_out: listingsOut, matched: wineMatched, unmatched: wines.length - wineMatched,
  }, {
    wine_rows: wines.length,
    producer_matched: producerMatched,
    producer_matched_pct: pct(producerMatched, wines.length),
    wine_matched_pct: pct(wineMatched, wines.length),
    wine_matched_pct_of_producer_matched: pct(wineMatched, producerMatched),
    producer_methods: pMethods,
    wine_methods: methods,
    monopoly_links: linksOut,
    wine_grapes: grapesOut,
    taste_rows: tasteRows,
    taste_rows_with_lwin: tasteWithLwin,
    samples_producer_unmatched: unmatchedProducers,
    samples_wine_unmatched: unmatchedWines,
  });

  await pool.end();
}

/** Best wine inside one producer's catalogue. Live rows win ties. */
function matchWine(cands: WineCand[], raw: string | null): { lwin: string; method: string; score: number } | null {
  const needle = norm(raw);
  if (!needle || !cands.length) return null;
  const rank = (c: WineCand) => (c.live ? 1 : 0);

  const exact = cands.filter((c) => c.wn === needle || c.dn === needle);
  if (exact.length) return { lwin: best(exact, rank).lwin, method: "exact", score: 1 };

  // Word-boundary containment either way, with a 5-character floor on the
  // shorter side - LWIN wine_name is a single letter often enough that an
  // unfloored containment matches everything.
  const contained = cands.filter((c) => bidiContains(c.wn, needle) || bidiContains(c.dn, needle));
  if (contained.length) {
    // Shortest containing name is the tightest fit; Live wins ties.
    const pick = contained.reduce((a, b) => {
      const la = Math.min(a.wn.length || 999, a.dn.length);
      const lb = Math.min(b.wn.length || 999, b.dn.length);
      if (lb !== la) return lb < la ? b : a;
      return rank(b) > rank(a) ? b : a;
    });
    return { lwin: pick.lwin, method: "norm_contained", score: 1 };
  }

  let bestScore = 0;
  let bestCand: WineCand | null = null;
  for (const c of cands) {
    const s = Math.max(c.wn ? trgmSimilarity(c.wn, needle) : 0, trgmSimilarity(c.dn, needle));
    if (s > bestScore || (s === bestScore && bestCand && rank(c) > rank(bestCand))) { bestScore = s; bestCand = c; }
  }
  if (bestCand && bestScore >= 0.5) return { lwin: bestCand.lwin, method: "trgm", score: Number(bestScore.toFixed(4)) };
  return null;
}

function best<T>(rows: T[], rank: (r: T) => number): T {
  return rows.reduce((a, b) => (rank(b) > rank(a) ? b : a));
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
