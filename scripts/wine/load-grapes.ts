/**
 * load-grapes.ts - Wikidata grape varieties, then resolve the register's
 * permitted-variety strings against them.
 *
 * Reads:  data/wine/raw/wikidata/03_grape_varieties.csv (2,747 rows, "|"-separated cells)
 *         scripts/wine/grape-synonyms.json (build-grape-synonyms.ts: VIVC prime names, synonyms,
 *           colour, origin, parents, VIVC numbers assigned by name, plus the manual map)
 *         scripts/wine/grape-ids.json (QID -> wine.grapes.id)
 * Writes: wine.grapes, wine.grape_names, and wine.appellation_grapes.grape_id
 *
 * Owns source='wikidata' in wine.grapes. Idempotent: nulls the grape_id values
 * it set, deletes its grapes, reloads, re-resolves.
 *
 * Where a VIVC number is known, VIVC decides colour, origin and parentage.
 * Items that share one VIVC number are one variety and load as one row.
 *
 * Ids are part of the contract: bores/wine-bore/pack/shelves.json stores
 * wine.grapes.id. A delete-and-insert reload hands out new serial ids and
 * breaks every grape on a shelf (the 09-17 reload did). grape-ids.json pins
 * the id of every QID the first load created; a new QID takes the next id
 * above the file's highest and should be added to the file.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-grapes.ts
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { SynonymFile } from "./build-grape-synonyms";
import { type Colour, GrapeResolver, type NameTier, colourFromCode, grapeColour, mergeByVivc, stripColourWords, titleCase, vivcColour, vivcForms } from "./grape-rules";
import { RAW, connect, insertMany, logLoad, na, norm, readCsv, readJson, upsertSource } from "./lib";

const SYNONYMS_PATH = resolve(__dirname, "grape-synonyms.json");
const IDS_PATH = resolve(__dirname, "grape-ids.json");

function splitPipe(v: string | null | undefined): string[] {
  const t = na(v);
  if (!t) return [];
  return t.split("|").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await upsertSource(pool, {
    slug: "vivc",
    name: "Vitis International Variety Catalogue (JKI Geilweilerhof)",
    licence: "open, citation requested (Roeckel et al.)",
    pulled_at: "2026-09-21",
    notes: "prime names, synonyms, berry colour, origin and parentage; wins over Wikidata wherever a VIVC number is known",
  });
  await upsertSource(pool, {
    slug: "wikidata",
    name: "Wikidata (wineries, regions, grape varieties, wines)",
    licence: "CC0",
    pulled_at: "2026-09-03",
    notes: "SPARQL exports; 03_grape_varieties.csv = 2,747 varieties with VIVC ids and parentage",
  });

  const syn: SynonymFile = existsSync(SYNONYMS_PATH)
    ? readJson<SynonymFile>(SYNONYMS_PATH)
    : { generated: "", source: "", manual: {}, assigned: {}, varieties: {} };
  const varieties = syn.varieties ?? {};
  const assigned = syn.assigned ?? {};
  notes.vivc_varieties_in_file = Object.keys(varieties).length;

  // ---- read -----------------------------------------------------------
  type Row = Record<string, string>;
  const rows: Row[] = [];
  for await (const r of readCsv(resolve(RAW, "wikidata", "03_grape_varieties.csv"))) {
    if (na(r.item)) rows.push(r);
  }

  // ---- idempotence ----------------------------------------------------
  // grape_id is a NO ACTION reference, so clear the pointers before deleting.
  const cleared = await pool.query(`UPDATE wine.appellation_grapes SET grape_id = NULL WHERE grape_id IS NOT NULL`);
  const clearedWine = await pool.query(`UPDATE wine.wine_grapes SET grape_id = NULL WHERE grape_id IS NOT NULL`);
  await pool.query(`DELETE FROM wine.grapes WHERE source = 'wikidata'`);

  // ---- parse ----------------------------------------------------------
  type Parsed = {
    qid: string; name: string; labels: [string, string][]; aliases: string[];
    vivc: string[]; vivcVia: string | null; weight: number; row: Row;
  };
  const parsed: Parsed[] = [];
  let noLabel = 0;
  const seenQid = new Set<string>();
  for (const r of rows) {
    const qid = (na(r.item) as string).split("/").pop() as string;
    if (seenQid.has(qid)) continue;
    seenQid.add(qid);
    const labels: [string, string][] = [];
    for (const lang of ["en", "fr", "it", "es", "de"]) {
      const v = na(r[`itemLabel_${lang}`]);
      if (v) labels.push([lang, v]);
    }
    const aliases = splitPipe(r.aliases);
    const name = na(r.itemLabel_en) ?? labels[0]?.[1] ?? aliases[0] ?? null;
    if (!name) { noLabel++; continue; }
    const own = splitPipe(r.vivcIds);
    const vivc = own.length ? own : assigned[qid] ? [assigned[qid].vivc] : [];
    // How much the sources know about this item. The heaviest item keeps the
    // name when several items are one variety.
    const weight = (own.length ? 4 : 0) + aliases.length + (splitPipe(r.hybridOf).length ? 2 : 0) + (splitPipe(r.countriesOfOrigin).length ? 1 : 0);
    parsed.push({ qid, name, labels, aliases, vivc, vivcVia: own.length ? "wikidata" : assigned[qid]?.via ?? null, weight, row: r });
  }

  // ---- one row per variety ---------------------------------------------
  const vivcNameSets = new Map<string, Set<string>>();
  for (const [id, v] of Object.entries(varieties)) vivcNameSets.set(id, new Set([v.prime, ...v.synonyms].map((n) => norm(n))));
  const keep = mergeByVivc(parsed.map((p) => {
    const v = p.vivc.length === 1 ? varieties[p.vivc[0]] : undefined;
    const own = [p.name, ...p.labels.map(([, l]) => l), ...p.aliases].flatMap((l) => vivcForms(l, norm));
    const prime = v ? norm(v.prime) : "";
    return {
      qid: p.qid, vivc: p.vivc, weight: p.weight, primaryNorm: norm(p.name), nameNorms: own,
      vivcKnowsName: !!v && own.some((n) => (vivcNameSets.get(p.vivc[0]) as Set<string>).has(n)),
      // The display name only: the Bastardo item carries a French label "Trousseau".
      isPrimeName: !!v && vivcForms(p.name, norm).some((n) => n === prime || n === stripColourWords(prime)),
    };
  }));
  const members = new Map<string, Parsed[]>();
  for (const p of parsed) {
    const head = keep.get(p.qid) as string;
    if (!members.has(head)) members.set(head, []);
    (members.get(head) as Parsed[]).push(p);
  }
  const heads = parsed.filter((p) => keep.get(p.qid) === p.qid);
  const mergedAway = parsed.length - heads.length;

  /** A VIVC parent in the form the counter reads: the loaded grape's own name when there is one. */
  const displayByVivcPrime = new Map<string, string>();
  for (const h of heads) for (const id of h.vivc) {
    const prime = varieties[id]?.prime;
    // Only a row whose VIVC number is Wikidata's own statement lends its name
    // ("Gouais blanc" for HEUNISCH WEISS). A thin item that took its number
    // from a synonym must not: Heben would print as "Pansale".
    const named = h.vivcVia === "wikidata";
    if (prime && named && !displayByVivcPrime.has(prime)) displayByVivcPrime.set(prime, h.name);
  }

  const pinned: Record<string, number> = existsSync(IDS_PATH) ? readJson<Record<string, number>>(IDS_PATH) : {};
  let nextId = Math.max(0, ...Object.values(pinned)) + 1;
  const unpinned: string[] = [];
  const idFor = (qid: string): number => {
    if (pinned[qid]) return pinned[qid];
    unpinned.push(qid);
    return nextId++;
  };

  const grapeRows: unknown[][] = [];
  const stats = { colour_from_vivc: 0, parents_from_vivc: 0, parents_from_wikidata: 0, origin_from_vivc: 0 };
  for (const h of heads) {
    const vs = h.vivc.map((id) => varieties[id]).filter(Boolean);
    const colour = grapeColour(vs.map((v) => vivcColour(v.colour)), h.row.colours);
    if (vs.some((v) => vivcColour(v.colour))) stats.colour_from_vivc++;
    // Wikidata P171 is the parent TAXON ("Vitis vinifera"), not a parent
    // variety. Parentage is VIVC Parent1 x Parent2, else Wikidata P1531.
    let parents: string[];
    // Only a full pedigree that markers confirm. VIVC gives Pinot noir as "? x
    // Savagnin blanc"; half a pedigree, stated flat on the counter, starts an argument the data cannot finish.
    const full = vs.length === 1 && vs[0].pedigree_confirmed && vs[0].parents.length === 2 && !vs[0].parents.includes("?");
    if (full) {
      parents = vs[0].parents.map((p) => displayByVivcPrime.get(p) ?? titleCase(p));
      stats.parents_from_vivc++;
    } else {
      parents = splitPipe(h.row.hybridOf);
      if (parents.length) stats.parents_from_wikidata++;
    }
    // Wikidata P495 says "Italy" for 801 items, Riesling and Chardonnay among them.
    let origin = splitPipe(h.row.countriesOfOrigin);
    if (vs.length === 1 && vs[0].country) { origin = [titleCase(vs[0].country)]; stats.origin_from_vivc++; }
    grapeRows.push([idFor(h.qid), h.name, norm(h.name), colour, h.qid, h.vivc, parents, origin, "wikidata", h.qid]);
  }

  const grapesOut = await insertMany(
    pool, "wine.grapes",
    ["id", "name", "name_norm", "colour", "wikidata_qid", "vivc_ids", "parent_varieties", "countries_of_origin", "source", "source_ref"],
    grapeRows, "ON CONFLICT DO NOTHING",
  );

  await pool.query(`SELECT setval('wine.grapes_id_seq', (SELECT max(id) FROM wine.grapes))`);
  notes.qids_without_pinned_id = unpinned.length;

  const { rows: back } = await pool.query(`SELECT id, source_ref, colour, name_norm, vivc_ids FROM wine.grapes WHERE source='wikidata'`);
  const idByQid = new Map<string, number>();
  for (const r of back) idByQid.set(r.source_ref, r.id);
  // A merged-away QID still resolves (grape-synonyms.json manual entries name QIDs).
  for (const p of parsed) {
    const gid = idByQid.get(keep.get(p.qid) as string);
    if (gid && !idByQid.has(p.qid)) idByQid.set(p.qid, gid);
  }

  // ---- grape_names (PK is (grape_id, name_norm): primary > translation > synonym > VIVC)
  const nameRows: unknown[][] = [];
  const tiers: { grapeId: number; nameNorm: string; tier: NameTier }[] = [];
  const takenName = new Set<string>();
  const pushName = (gid: number, raw: string, kind: string, lang: string | null, source: string, tier: NameTier) => {
    const n = na(raw);
    if (!n) return;
    const nn = norm(n);
    if (!nn) return;
    const key = `${gid}|${nn}`;
    if (takenName.has(key)) return;
    takenName.add(key);
    nameRows.push([gid, n, nn, kind, lang, source]);
    tiers.push({ grapeId: gid, nameNorm: nn, tier });
  };
  for (const h of heads) {
    const gid = idByQid.get(h.qid);
    if (!gid) continue;
    pushName(gid, h.name, "primary", h.labels.find(([, v]) => v === h.name)?.[0] ?? "en", "wikidata", "primary");
    for (const m of members.get(h.qid) as Parsed[]) {
      // The name of an item merged into this one is as good as a label.
      if (m.qid !== h.qid) pushName(gid, m.name, "synonym", null, "wikidata", "wikidata");
      for (const [lang, v] of m.labels) pushName(gid, v, m.qid === h.qid ? "translation" : "synonym", lang, "wikidata", "wikidata");
      for (const a of m.aliases) pushName(gid, a, "synonym", null, "wikidata", "wikidata");
    }
  }
  // Every VIVC synonym loads (get_grape orders synonyms by how often the
  // corpus uses them, so 447 names for Pinot noir no longer bury Spatburgunder).
  // One kind stays out: a synonym that is also a protected place name. VIVC
  // lists ANJOU under Chenin blanc and CHAMPAGNE under several grapes; in the
  // search vector those would answer a place query with a grape.
  const { rows: placeRows } = await pool.query(`SELECT DISTINCT name_norm FROM wine.appellation_names`);
  const places = new Set<string>(placeRows.map((r) => r.name_norm as string));
  let placeNamesSkipped = 0;
  // Nor does a homonym: VIVC files PINOT GRIS as a local name for Pinot noir,
  // TROUSSEAU for Tempranillo, GAMAY for Grenache. Each is another variety's
  // own name. Listed as a synonym it reads as "Tempranillo, also called
  // Trousseau", which is false everywhere but one Spanish village.
  const owner = new Map<string, number>();
  const own = (nn: string, gid: number) => { if (nn && !owner.has(nn)) owner.set(nn, gid); };
  for (const r of nameRows) if (r[3] === "primary" || r[3] === "translation") own(r[2] as string, r[0] as number);
  for (const h of heads) {
    const gid = idByQid.get(h.qid);
    if (!gid || h.vivc.length !== 1) continue;
    const prime = varieties[h.vivc[0]]?.prime;
    if (prime) { own(norm(prime), gid); own(stripColourWords(norm(prime)), gid); }
  }
  let homonymsSkipped = 0;
  let vivcNames = 0;
  for (const h of heads) {
    const gid = idByQid.get(h.qid);
    if (!gid || h.vivc.length !== 1) continue;
    const v = varieties[h.vivc[0]];
    if (!v) continue;
    for (const s of [v.prime, ...v.synonyms]) {
      if (places.has(norm(s))) { placeNamesSkipped++; continue; }
      const held = owner.get(norm(s));
      if (held !== undefined && held !== gid) { homonymsSkipped++; continue; }
      const before = nameRows.length;
      pushName(gid, titleCase(s), "synonym", null, "vivc", "vivc");
      if (nameRows.length > before) vivcNames++;
    }
  }
  // ---- uses: how often the corpus spells the grape this way (migration 035)
  // Register rows and wine-list rows count once each. An LWIN wine name counts
  // when it holds the synonym as whole words ("Arbois Pupillin Ploussard"), and
  // only for a synonym of two words or of seven letters and more: "Alicante",
  // "Orleans" and "Bordeaux" are places in a wine name, not grapes.
  const phraseCount = new Map<string, number>();
  const bump = (k: string, n = 1) => phraseCount.set(k, (phraseCount.get(k) ?? 0) + n);
  const { rows: rawUses } = await pool.query(
    `SELECT grape_name_raw AS raw, count(*)::int AS n FROM wine.appellation_grapes GROUP BY 1 UNION ALL SELECT grape_name_raw, count(*)::int FROM wine.wine_grapes GROUP BY 1`,
  );
  const directUses = new Map<string, number>();
  for (const r of rawUses) { const k = norm(r.raw as string); directUses.set(k, (directUses.get(k) ?? 0) + (r.n as number)); }
  const { rows: wineNames } = await pool.query(`SELECT wine_name FROM wine.wines WHERE wine_name IS NOT NULL`);
  for (const w of wineNames) {
    const toks = norm(w.wine_name as string).split(" ").filter(Boolean);
    const seen = new Set<string>();
    for (let i = 0; i < toks.length; i++) for (let len = 1; len <= 3 && i + len <= toks.length; len++) seen.add(toks.slice(i, i + len).join(" "));
    for (const k of seen) bump(k);
  }
  const usesOf = (nn: string) => (directUses.get(nn) ?? 0) + (nn.includes(" ") || nn.length >= 7 ? phraseCount.get(nn) ?? 0 : 0);
  for (const r of nameRows) r.push(usesOf(r[2] as string));

  const namesOut = await insertMany(
    pool, "wine.grape_names", ["grape_id", "name", "name_norm", "kind", "lang", "source", "uses"],
    nameRows, "ON CONFLICT DO NOTHING",
  );

  // ---- resolve appellation_grapes.grape_id ----------------------------
  const manualIds = new Map<string, number>();
  const manualMissing: string[] = [];
  for (const [rawNorm, qid] of Object.entries(syn.manual ?? {})) {
    const gid = idByQid.get(qid);
    if (gid) manualIds.set(rawNorm, gid);
    else manualMissing.push(`${rawNorm}=${qid}`);
  }
  const weightByQid = new Map(parsed.map((p) => [p.qid, p.weight]));
  const resolver = new GrapeResolver(
    back.map((r) => ({ id: r.id, primaryNorm: r.name_norm, colour: r.colour as Colour, weight: weightByQid.get(r.source_ref) ?? 0, vivc: r.vivc_ids.length === 1 ? r.vivc_ids[0] : null })),
    tiers, manualIds,
  );

  const { rows: agRows } = await pool.query(
    `SELECT appellation_id, grape_name_raw, kind, category, colour_code FROM wine.appellation_grapes WHERE source='pdo-dataset'`,
  );

  const stages: Record<string, number> = { manual: 0, exact: 0, colour_stripped: 0, first_two: 0 };
  const updates: [number, number, string, string, string][] = []; // gid, appId, raw, kind, category
  const unresolved = new Map<string, Set<number>>();

  for (const r of agRows) {
    const raw = r.grape_name_raw as string;
    const hit = resolver.resolve(norm(raw), colourFromCode(r.colour_code as string | null));
    if (hit) {
      stages[hit.stage]++;
      updates.push([hit.id, r.appellation_id as number, raw, r.kind as string, r.category as string]);
    } else {
      if (!unresolved.has(raw)) unresolved.set(raw, new Set());
      (unresolved.get(raw) as Set<number>).add(r.appellation_id as number);
    }
  }

  // Apply in chunks: one UPDATE ... FROM (VALUES ...) per 1,000 rows.
  let updated = 0;
  for (let i = 0; i < updates.length; i += 1000) {
    const slice = updates.slice(i, i + 1000);
    const params: unknown[] = [];
    const values = slice.map((u) => {
      params.push(u[0], u[1], u[2], u[3], u[4]);
      const b = params.length;
      return `($${b - 4}::int,$${b - 3}::int,$${b - 2}::text,$${b - 1}::text,$${b}::text)`;
    }).join(",");
    const res = await pool.query(
      `UPDATE wine.appellation_grapes ag SET grape_id = v.gid
       FROM (VALUES ${values}) AS v(gid, app_id, raw, kind, category)
       WHERE ag.appellation_id = v.app_id AND ag.grape_name_raw = v.raw AND ag.kind = v.kind AND ag.category = v.category`,
      params,
    );
    updated += res.rowCount ?? 0;
  }

  const top = [...unresolved.entries()]
    .map(([raw, apps]) => ({ raw, appellations: apps.size }))
    .sort((a, b) => b.appellations - a.appellations)
    .slice(0, 30);

  notes.grapes = grapesOut;
  notes.grape_names = namesOut;
  notes.rows_without_label_or_alias = noLabel;
  notes.appellation_grape_rows = agRows.length;
  notes.resolved = updated;
  notes.resolution_rate = `${((updated / agRows.length) * 100).toFixed(1)}%`;
  notes.stages = stages;
  notes.vivc_synonym_shared_and_skipped = resolver.vivcAmbiguous;
  notes.disambiguated_by_rank = resolver.disambiguated;
  notes.colour_word_vetoes = resolver.vetoedByColourWord;
  notes.items_merged_into_another_by_vivc_number = mergedAway;
  notes.vivc_number_assigned_by_name = parsed.filter((p) => p.vivcVia && p.vivcVia !== "wikidata").length;
  notes.vivc_names_added = vivcNames;
  notes.vivc_synonyms_skipped_as_place_names = placeNamesSkipped;
  notes.vivc_synonyms_skipped_as_another_grapes_name = homonymsSkipped;
  notes.facts = stats;
  notes.distinct_unresolved_names = unresolved.size;
  notes.top_unresolved = top;
  notes.manual_synonyms_loaded = manualIds.size;
  if (manualMissing.length) notes.manual_synonyms_unknown_qid = manualMissing;
  notes.cleared_appellation_grape_ids = cleared.rowCount ?? 0;
  notes.cleared_wine_grape_ids = clearedWine.rowCount ?? 0;

  await logLoad(pool, "load-grapes", {
    rows_in: rows.length,
    rows_out: grapesOut + namesOut,
    matched: updated,
    unmatched: agRows.length - updated,
  }, notes);

  console.log(`grapes=${grapesOut} grape_names=${namesOut} appellation_grapes resolved=${updated}/${agRows.length}`);
  console.log(JSON.stringify(top, null, 1));
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
