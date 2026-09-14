/**
 * load-wikidata-wines.ts - Wikidata wine items -> wine.wine_names + wine.wine_grapes.
 *
 * Low-yield by design. 04_wines.csv is 5,796 rows but most of them are
 * appellations and denominations ("Cerasuolo di Vittoria DOCG"), not wines a
 * producer bottles: only 47 rows name a producer and 3,024 have an English
 * label at all. Rows that do resolve give the Bore an alias and a grape list
 * for an LWIN wine, so the join is worth running and reporting; it is not
 * worth tuning.
 *
 * Match: norm(label) against a producer's wines when `producers` resolves,
 * otherwise against every LWIN wine by exact norm then containment, narrowed
 * by country when `regions` names one. Containment needs >= 10 characters and
 * <= 50 candidates, or a short label like "Valdemar" drags in half of Rioja.
 *
 * wine_names has no source_ref column, so the QID is not kept on the name row;
 * it stays in load_log.notes only.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/wine/load-wikidata-wines.ts
 */
import { resolve } from "node:path";
import { RAW, connect, countryCode, insertMany, logLoad, na, norm, readCsv, upsertSource } from "./lib";
import { ProducerMatcher, bidiContains, normContains } from "./match";

const SRC = "wikidata";
const MIN_CONTAIN = 10;
const MAX_CANDIDATES = 50;

/**
 * Labels ending in a GI suffix are denominations, not wines - "Barolo DOCG",
 * "Costa Toscana IGT". Containment happily hangs them on the first wine whose
 * display name carries the denomination, which asserts an alias that is not
 * one. They belong to load-appellations.ts; skipped and counted here.
 */
const GI_SUFFIX = /\b(doc|docg|doca|do|dop|igt|igp|aoc|aop|ava|pdo|pgi|vdp|g\.?i\.?)$/i;

type W = { lwin: string; wn: string; dn: string; country: string | null; live: boolean; producer_id: number | null };

async function main(): Promise<void> {
  const pool = connect();

  await upsertSource(pool, {
    slug: SRC, name: "Wikidata wine entities (SPARQL)", licence: "CC0", pulled_at: "2026-09-03",
    notes: "1,943 winery rows (01) and 5,796 wine rows (04).",
  });

  await pool.query(`DELETE FROM wine.wine_names WHERE source = $1`, [SRC]);
  await pool.query(`DELETE FROM wine.wine_grapes WHERE source = $1`, [SRC]);

  const res = await pool.query<{ lwin: string; wine_name: string | null; display_name: string; country: string | null; status: string; producer_id: number | null }>(
    `SELECT lwin::text, wine_name, display_name, country, status, producer_id FROM wine.wines`,
  );
  const all: W[] = res.rows.map((r) => ({
    lwin: r.lwin, wn: norm(r.wine_name), dn: norm(r.display_name),
    country: r.country, live: r.status === "Live", producer_id: r.producer_id,
  }));
  const byExact = new Map<string, W[]>();
  for (const w of all) {
    for (const k of [w.wn, w.dn]) {
      if (!k) continue;
      const a = byExact.get(k);
      if (a) { if (!a.includes(w)) a.push(w); } else byExact.set(k, [w]);
    }
  }
  const byProducer = new Map<number, W[]>();
  for (const w of all) {
    if (w.producer_id === null) continue;
    const a = byProducer.get(w.producer_id);
    if (a) a.push(w); else byProducer.set(w.producer_id, [w]);
  }

  const matcher = new ProducerMatcher(pool);
  await matcher.load("lwin");

  const names: unknown[][] = [];
  const grapes: unknown[][] = [];
  const nameSeen = new Set<string>();
  const grapeSeen = new Set<string>();
  const methods: Record<string, number> = {};
  const samples: string[] = [];
  let rowsIn = 0;
  let labelled = 0;
  let withProducer = 0;
  let giLabels = 0;
  let matchedRows = 0;

  for await (const r of readCsv(resolve(RAW, SRC, "04_wines.csv"))) {
    rowsIn++;
    const qid = (na(r.item) ?? "").replace(/^.*\/entity\//, "");
    const label = na(r.itemLabel_en) ?? na(r.itemLabel_fr) ?? na(r.itemLabel_it) ?? na(r.itemLabel_es) ?? na(r.itemLabel_de);
    if (!qid || !label) continue;
    labelled++;
    const needle = norm(label);
    if (!needle) continue;
    if (GI_SUFFIX.test(label.trim())) { giLabels++; continue; }

    const producerRaw = na(r.producers);
    const country = firstCountry(r.regions);
    let pool_: W[] | null = null;
    let method = "none";

    if (producerRaw) {
      withProducer++;
      for (const cand of producerRaw.split("|")) {
        const pm = await matcher.match(cand.trim(), country);
        if (pm.producer_id) { pool_ = byProducer.get(pm.producer_id) ?? []; method = `producer_${pm.method}`; break; }
      }
    }

    let hit: W | null = null;
    if (pool_) {
      hit = pickTight(pool_.filter((w) => w.wn === needle || w.dn === needle)) ??
            pickTight(pool_.filter((w) => contains(w, needle)));
      if (hit) method = `${method}+wine`;
    }
    if (!hit) {
      const exact = (byExact.get(needle) ?? []).filter((w) => !country || !w.country || w.country === country);
      hit = pickTight(exact);
      if (hit) method = "exact";
    }
    if (!hit && needle.length >= MIN_CONTAIN) {
      const cands: W[] = [];
      for (const w of all) {
        if (country && w.country && w.country !== country) continue;
        if (containsGlobal(w, needle)) { cands.push(w); if (cands.length > MAX_CANDIDATES) break; }
      }
      if (cands.length && cands.length <= MAX_CANDIDATES) { hit = pickTight(cands); method = "contains"; }
      else if (cands.length) method = "too_many";
    }

    methods[method] = (methods[method] ?? 0) + 1;
    if (!hit) { if (samples.length < 20) samples.push(`${qid} ${label}`); continue; }
    matchedRows++;

    const key = `${hit.lwin}|${needle}`;
    if (!nameSeen.has(key)) { nameSeen.add(key); names.push([hit.lwin, label, needle, SRC, SRC]); }
    for (const g of (na(r.grapes) ?? "").split("|")) {
      const raw = na(g);
      if (!raw) continue;
      const gk = `${hit.lwin}|${raw}`;
      if (grapeSeen.has(gk)) continue;
      grapeSeen.add(gk);
      grapes.push([hit.lwin, null, raw, SRC]);
    }
  }

  const namesOut = await insertMany(
    pool, "wine.wine_names", ["lwin", "name", "name_norm", "kind", "source"], names,
    "ON CONFLICT (lwin, name_norm) DO NOTHING",
  );
  const grapesOut = await insertMany(
    pool, "wine.wine_grapes", ["lwin", "grape_id", "grape_name_raw", "source"], grapes,
    "ON CONFLICT (lwin, grape_name_raw, source) DO NOTHING",
  );

  await logLoad(pool, "load-wikidata-wines", {
    rows_in: rowsIn, rows_out: namesOut, matched: matchedRows, unmatched: labelled - matchedRows,
  }, {
    labelled_rows: labelled,
    gi_labels_skipped: giLabels,
    wine_labels: labelled - giLabels,
    rows_naming_a_producer: withProducer,
    match_rate_of_wine_labels: labelled - giLabels ? `${((matchedRows / (labelled - giLabels)) * 100).toFixed(1)}%` : "0%",
    match_rate_of_all: `${((matchedRows / rowsIn) * 100).toFixed(1)}%`,
    methods,
    wine_names_out: namesOut,
    wine_grapes_out: grapesOut,
    samples_unmatched: samples,
  });

  await pool.end();
}

/** Inside one producer's catalogue: either direction, 5-character floor. */
function contains(w: W, needle: string): boolean {
  return bidiContains(w.wn, needle) || bidiContains(w.dn, needle);
}

/**
 * Across all 190k wines: only the wine-contains-label direction, on word
 * boundaries. The other direction lets a wine called "E" answer to every
 * appellation name in Italy.
 */
function containsGlobal(w: W, needle: string): boolean {
  return normContains(w.wn, needle) || normContains(w.dn, needle);
}

/** Tightest name wins (shortest display_name), Live breaks ties. */
function pickTight(rows: W[]): W | null {
  if (!rows.length) return null;
  return rows.reduce((a, b) => {
    if (b.dn.length !== a.dn.length) return b.dn.length < a.dn.length ? b : a;
    return b.live && !a.live ? b : a;
  });
}

function firstCountry(s: string | undefined): string | null {
  for (const part of (na(s) ?? "").split("|")) {
    const c = countryCode(part.trim());
    if (c) return c;
  }
  return null;
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
