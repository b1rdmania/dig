/**
 * load-producer-links.ts - hang outside identities off the LWIN producer spine.
 *
 * Three sources, run in this order so the later one wins on shared columns:
 *   wikidata/01_wineries.csv      -> kind='wikidata',  sets wikidata_qid, website (if empty), founded_year (if empty)
 *   exa-producers/results.csv     -> kind='website' (+ 'techsheet'), sets website (override), founded_year, uk_importer
 *   trade-bodies/-/extracted.jsonl -> kind='directory', member directory entries only
 *
 * Matching is scripts/wine/match.ts (exact -> norm -> norm_stripped -> trgm>=0.6,
 * country-narrowed). producer_links needs a producer_id, so unmatched rows are
 * not inserted; they are counted in load_log.notes with 20 sample names each.
 *
 *   DATABASE_URL=... pnpm exec tsx scripts/wine/load-producer-links.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { RAW, connect, countryCode, insertMany, intOrNull, logLoad, na, readCsv, upsertSource } from "./lib";
import { ProducerMatcher, type Match } from "./match";

const SOURCES = ["wikidata", "exa-producers", "trade-bodies"];

/** Trade-body folder -> ISO alpha-2 of the appellation it represents. */
const BODY_COUNTRY: Record<string, string> = {
  alentejo: "PT", "alsace-civa": "FR", "alto-adige": "IT", "barbera-asti": "IT",
  "barolo-barbaresco": "IT", "beaujolais-interbeaujolais": "FR", bierzo: "ES", "bordeaux-civb": "FR",
  "bourgogne-bivb": "FR", "brunello-montalcino": "IT", "champagne-civc": "FR", "chianti-classico": "IT",
  "deutsches-weininstitut": "DE", "etna-doc": "IT", franciacorta: "IT", "georgian-wine-agency": "GE",
  "ivdp-douro": "PT", jerez: "ES", jura: "FR", "languedoc-civl": "FR", "loire-interloire": "FR",
  lugana: "IT", "nz-winegrowers": "NZ", "oesterreich-wein": "AT", priorat: "ES", "prosecco-docg": "IT",
  "provence-civp": "FR", "rhone-interrhone": "FR", "rias-baixas": "ES", "ribera-del-duero": "ES",
  rioja: "ES", soave: "IT", "sud-ouest": "FR", "trento-doc": "IT", valpolicella: "IT", vdp: "DE",
  "vinho-verde": "PT", "vino-nobile": "IT", "wine-australia": "AU", "wines-of-argentina": "AR",
  "wines-of-chile": "CL", "wines-of-germany": "DE", "wines-of-greece": "GR", "wines-of-lebanon": "LB",
  "wines-of-portugal": "PT", "wines-of-south-africa": "ZA",
};

type Link = {
  producer_id: number;
  source: string;
  source_ref: string;
  name_as_found: string;
  url: string | null;
  kind: string;
  match_method: string;
  match_score: number | null;
};

type Tally = { rows: number; matched: number; unmatched: number; samples: string[]; methods: Record<string, number> };

function tally(): Tally { return { rows: 0, matched: 0, unmatched: 0, samples: [], methods: {} }; }
function summary(t: Tally, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { rows: t.rows, matched: t.matched, unmatched: t.unmatched, methods: t.methods, samples_unmatched: t.samples, ...extra };
}
function record(t: Tally, name: string, m: Match): void {
  t.rows++;
  t.methods[m.method] = (t.methods[m.method] ?? 0) + 1;
  if (m.producer_id) t.matched++;
  else { t.unmatched++; if (t.samples.length < 20) t.samples.push(name); }
}

async function main(): Promise<void> {
  const pool = connect();

  await upsertSource(pool, {
    slug: "wikidata", name: "Wikidata wine entities (SPARQL)", licence: "CC0",
    pulled_at: "2026-09-03", notes: "1,943 winery rows from 01_wineries.rq.",
  });
  await upsertSource(pool, {
    slug: "exa-producers", name: "Exa enrichment, 500 largest LWIN producers",
    licence: "Exa output; underlying facts from producer sites", pulled_at: "2026-09-04",
    notes: "$0.012/producer; website accuracy 85-95% on a 20-row check.",
  });
  await upsertSource(pool, {
    slug: "trade-bodies", name: "41 consorzi / national trade body producer directories",
    licence: "per-site terms; Austria withheld", pulled_at: "2026-09-04",
    notes: "Only type='producer' directory entries are loaded; site/appellation/variety pages are skipped.",
  });

  // Idempotent: this loader owns these link rows and these producer columns.
  await pool.query(`DELETE FROM wine.producer_links WHERE source = ANY($1)`, [SOURCES]);
  await pool.query(
    `UPDATE wine.producers SET wikidata_qid = NULL, website = NULL, founded_year = NULL, uk_importer = NULL
      WHERE source = 'lwin' AND (wikidata_qid IS NOT NULL OR website IS NOT NULL OR founded_year IS NOT NULL OR uk_importer IS NOT NULL)`,
  );

  const matcher = new ProducerMatcher(pool);
  const n = await matcher.load("lwin");
  console.log(`[producer-links] ${n} LWIN producers in the matcher`);

  const notes: Record<string, unknown> = {};
  let rowsIn = 0;
  let matched = 0;
  let unmatched = 0;
  const links: Link[] = [];

  // ---- 1. Wikidata -------------------------------------------------------
  const wd = tally();
  const wdSets: Array<[number, string, string | null, number | null]> = [];
  for await (const r of readCsv(resolve(RAW, "wikidata", "01_wineries.csv"))) {
    const qid = (na(r.item) ?? "").replace(/^.*\/entity\//, "");
    const name = na(r.itemLabel_en) ?? na(r.officialName) ?? na(r.itemLabel_fr) ?? na(r.itemLabel_it)
      ?? na(r.itemLabel_es) ?? na(r.itemLabel_de);
    if (!qid || !name) continue;
    const country = countryCode(r.countryLabel);
    const m = await matcher.match(name, country);
    record(wd, name, m);
    if (!m.producer_id) continue;
    links.push({
      producer_id: m.producer_id, source: "wikidata", source_ref: qid, name_as_found: name,
      url: na(r.website), kind: "wikidata", match_method: m.method, match_score: m.score,
    });
    const year = /^(\d{4})/.exec(na(r.inception) ?? "")?.[1];
    wdSets.push([m.producer_id, qid, na(r.website), year ? Number(year) : null]);
  }
  for (let i = 0; i < wdSets.length; i += 500) {
    const slice = wdSets.slice(i, i + 500);
    await pool.query(
      `UPDATE wine.producers p SET
         wikidata_qid = COALESCE(p.wikidata_qid, v.qid),
         website      = COALESCE(p.website, v.site),
         founded_year = COALESCE(p.founded_year, v.year)
       FROM (SELECT * FROM unnest($1::int[], $2::text[], $3::text[], $4::int[]) AS t(id, qid, site, year)) v
       WHERE p.id = v.id`,
      [slice.map((s) => s[0]), slice.map((s) => s[1]), slice.map((s) => s[2]), slice.map((s) => s[3])],
    );
  }
  notes.wikidata = summary(wd);
  rowsIn += wd.rows; matched += wd.matched; unmatched += wd.unmatched;

  // ---- 2. Exa ------------------------------------------------------------
  const exa = tally();
  const exaSets: Array<[number, string | null, number | null, string | null]> = [];
  for await (const r of readCsv(resolve(RAW, "exa-producers", "results.csv"))) {
    const name = na(r.producer_name);
    if (!name) continue;
    const country = countryCode(r.country);
    const m = await matcher.match(name, country);
    record(exa, name, m);
    if (!m.producer_id) continue;
    const ref = `${name}|${na(r.country) ?? ""}`;
    links.push({
      producer_id: m.producer_id, source: "exa-producers", source_ref: ref, name_as_found: name,
      url: na(r.website_url), kind: "website", match_method: m.method, match_score: m.score,
    });
    const tech = na(r.tech_sheet_url);
    if (tech) {
      links.push({
        producer_id: m.producer_id, source: "exa-producers", source_ref: `${ref}#techsheet`,
        name_as_found: name, url: tech, kind: "techsheet", match_method: m.method, match_score: m.score,
      });
    }
    exaSets.push([m.producer_id, na(r.website_url), intOrNull(r.founded_year), na(r.uk_importer)]);
  }
  for (let i = 0; i < exaSets.length; i += 500) {
    const slice = exaSets.slice(i, i + 500);
    await pool.query(
      `UPDATE wine.producers p SET
         website      = COALESCE(v.site, p.website),
         founded_year = COALESCE(v.year, p.founded_year),
         uk_importer  = COALESCE(v.imp, p.uk_importer)
       FROM (SELECT * FROM unnest($1::int[], $2::text[], $3::int[], $4::text[]) AS t(id, site, year, imp)) v
       WHERE p.id = v.id`,
      [slice.map((s) => s[0]), slice.map((s) => s[1]), slice.map((s) => s[2]), slice.map((s) => s[3])],
    );
  }
  notes["exa-producers"] = summary(exa);
  rowsIn += exa.rows; matched += exa.matched; unmatched += exa.unmatched;

  // ---- 3. Trade bodies ---------------------------------------------------
  const tb = tally();
  const perBody: Record<string, { rows: number; matched: number; unmatched: number; country: string | null }> = {};
  const seenRefs = new Set<string>();
  const bodies = readdirSync(resolve(RAW, "trade-bodies")).sort();
  for (const body of bodies) {
    const file = resolve(RAW, "trade-bodies", body, "extracted.jsonl");
    if (!existsSync(file)) continue;
    const country = BODY_COUNTRY[body] ?? null;
    if (!country) console.warn(`[producer-links] no country mapped for trade body '${body}'`);
    const entries = readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
    // A url shared by many entries (one directory page scraped into rows) can
    // not be the key; fall back to the name in that case.
    const urlCount = new Map<string, number>();
    for (const line of entries) {
      try {
        const o = JSON.parse(line) as { type?: string; url?: string };
        if (o.type === "producer" && o.url) urlCount.set(o.url, (urlCount.get(o.url) ?? 0) + 1);
      } catch { /* counted below */ }
    }
    const stat = perBody[body] ?? (perBody[body] = { rows: 0, matched: 0, unmatched: 0, country });
    for (const line of entries) {
      let o: { type?: string; name?: string; url?: string; website?: string | null };
      try { o = JSON.parse(line); } catch { continue; }
      if (o.type !== "producer") continue;
      const name = na(o.name ?? null);
      if (!name) continue;
      const m = await matcher.match(cleanBodyName(name), country);
      record(tb, `${body}: ${name}`, m);
      stat.rows++;
      if (m.producer_id) stat.matched++; else { stat.unmatched++; continue; }
      const uniqueUrl = o.url && (urlCount.get(o.url) ?? 0) === 1;
      let ref = `${body}|${uniqueUrl ? o.url : name}`;
      if (seenRefs.has(ref)) {
        let i = 2;
        while (seenRefs.has(`${ref}#${i}`)) i++;
        ref = `${ref}#${i}`;
      }
      seenRefs.add(ref);
      links.push({
        producer_id: m.producer_id, source: "trade-bodies", source_ref: ref, name_as_found: name,
        url: na(o.website ?? null) ?? na(o.url ?? null), kind: "directory",
        match_method: m.method, match_score: m.score,
      });
    }
  }
  notes["trade-bodies"] = summary(tb, { per_body: perBody });
  rowsIn += tb.rows; matched += tb.matched; unmatched += tb.unmatched;

  // ---- write -------------------------------------------------------------
  const out = await insertMany(
    pool, "wine.producer_links",
    ["producer_id", "source", "source_ref", "name_as_found", "url", "kind", "match_method", "match_score"],
    links.map((l) => [l.producer_id, l.source, l.source_ref, l.name_as_found, l.url, l.kind, l.match_method, l.match_score]),
    "ON CONFLICT (source, source_ref) DO NOTHING",
  );

  await logLoad(pool, "load-producer-links", { rows_in: rowsIn, rows_out: out, matched, unmatched }, notes);
  await pool.end();
}

/** Directory names carry scraped furniture: "Domaine X - City : 71390 FOO". */
function cleanBodyName(s: string): string {
  return s
    .replace(/\s*[-–—]\s*(City|Ville|Comune|Municipality)\s*:.*$/i, "")
    .replace(/\s+—\s+.*$/, "")
    .trim();
}

main().catch((e) => { console.error(e); process.exit(1); });
