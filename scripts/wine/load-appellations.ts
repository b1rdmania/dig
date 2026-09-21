/**
 * load-appellations.ts - the EU appellation register.
 *
 * Reads:
 *   data/wine/raw/eambrosia/detail/*.json   (1,687 EU wine GIs: PDO + PGI)
 *   data/wine/raw/pdo-dataset/PDO_EU_id.csv  (1,177 PDOs: yields, density, municipalities)
 *   data/wine/raw/pdo-dataset/PDO_EU_cat.csv (1,983 PDO x category rows: permitted varieties)
 *
 * Writes: wine.appellations, wine.appellation_names, wine.appellation_grapes
 * Owns source='eambrosia' and source='pdo-dataset'. Idempotent: deletes those
 * rows (names and grapes cascade) and reloads.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-appellations.ts
 */
import { plausibleYield } from "./appellation-rules";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { RAW, connect, insertMany, logLoad, na, norm, numOrNull, readCsv, readJson, upsertSource } from "./lib";

type Gi = {
  giIdentifier: string;
  protectedNames: string[] | null;
  fileNumber: string;
  countries: string[] | null;
  giType: string;
  productType: string;
  status: string | null;
  euProtectionDate: string | null;
  legalInstrument: { text?: string | null; uri?: string | null } | null;
  transcriptions: string[] | null;
  removedFlag: boolean;
  amendmentsInProgressFlag: boolean;
};

const EAMBROSIA_URL = "https://ec.europa.eu/agriculture/eambrosia/geographical-indications-register/details";

/** Register colour codes that trail a variety name: "Grüner Veltliner B". */
const COLOUR_CODES = new Set(["B", "N", "Rs", "Rg", "G", "Gr", "R"]);

/**
 * Legal quality tokens that top and tail a name in label strings but not in
 * the register ("Chianti DOCG" -> "Chianti"). Compared after norm().
 */
const ABBR_TOKENS = new Set([
  "aoc", "aop", "doc", "docg", "do", "dop", "igp", "igt", "ig", "pdo", "pgi", "vdp", "vqprd",
  "g u", "g g a", "gu", "gga", "kpm",
]);
const WORD_TOKENS = new Set(["qualitatswein", "pradikatswein"]);

/**
 * An abbreviation only counts as a legal marker when the source wrote it as
 * one: "DOC" or "g.U.", never "d'Oc" (Pays d'Oc) which norms to the same thing.
 */
function isLegalToken(t: string): boolean {
  const n = norm(t);
  if (!n) return false;
  if (WORD_TOKENS.has(n)) return true;
  if (!ABBR_TOKENS.has(n)) return false;
  if (/['\u2019]/.test(t)) return false;
  if (t.includes(".")) return true;
  const letters = t.replace(/[^\p{L}]/gu, "");
  return letters.length > 0 && letters === letters.toUpperCase();
}

function splitSlash(v: string | null | undefined): string[] {
  const t = na(v);
  if (!t) return [];
  return t.split("/").map((s) => s.trim()).filter((s) => s.length > 0 && s !== "na");
}

/** Strip leading/trailing legal tokens. Returns null when nothing useful is left. */
function stripLegal(name: string): string | null {
  let toks = name.split(/\s+/).filter(Boolean);
  const legal = isLegalToken;
  let changed = false;
  while (toks.length > 1 && legal(toks[toks.length - 1])) { toks = toks.slice(0, -1); changed = true; }
  while (toks.length > 1 && legal(toks[0])) { toks = toks.slice(1); changed = true; }
  if (!changed) return null;
  const out = toks.join(" ").replace(/^[\s,-]+|[\s,-]+$/g, "");
  if (norm(out).length < 3) return null;
  return out === name ? null : out;
}

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await upsertSource(pool, {
    slug: "eambrosia",
    name: "eAmbrosia - EU geographical indications register",
    licence: "EU register; no licence field stated",
    pulled_at: "2026-09-03",
    notes: "per-record detail JSON from the register endpoint; 1,687 wine GIs",
  });
  await upsertSource(pool, {
    slug: "pdo-dataset",
    name: "Structured dataset of EU wine PDOs (Sci Data 2022)",
    licence: "CC0",
    pulled_at: "2026-09-03",
    notes: "PDO_EU_id.csv + PDO_EU_cat.csv; grapes, yields, density, municipalities",
  });

  // ---- read eambrosia -------------------------------------------------
  const detailDir = resolve(RAW, "eambrosia", "detail");
  const files = readdirSync(detailDir).filter((f) => f.endsWith(".json"));
  const gis: Gi[] = files.map((f) => readJson<Gi>(resolve(detailDir, f)));
  const byFileNumber = new Map<string, Gi>();
  for (const g of gis) byFileNumber.set(g.fileNumber, g);

  // ---- read the PDO set -----------------------------------------------
  type IdRow = Record<string, string>;
  const idRows: IdRow[] = [];
  for await (const r of readCsv(resolve(RAW, "pdo-dataset", "PDO_EU_id.csv"))) {
    if (na(r.PDOid)) idRows.push(r);
  }
  const idByPdoId = new Map<string, IdRow>();
  for (const r of idRows) idByPdoId.set(r.PDOid.trim(), r);

  const catRows: Record<string, string>[] = [];
  for await (const r of readCsv(resolve(RAW, "pdo-dataset", "PDO_EU_cat.csv"))) {
    if (na(r.PDOid)) catRows.push(r);
  }

  // ---- idempotence ----------------------------------------------------
  // Upsert on (source, source_ref), never delete-and-insert. wine.wines,
  // wine.appellation_documents and the pack store appellation ids; a delete
  // fails on those references once the corpus is loaded, and fresh serial ids
  // would break the pack. Names and grape rows this loader owns are rebuilt.
  // Run load-grapes.ts afterwards: it re-resolves appellation_grapes.grape_id.
  const OWN = ["eambrosia", "pdo-dataset"];
  await pool.query(`DELETE FROM wine.appellation_names WHERE source = ANY($1::text[])`, [OWN]);
  await pool.query(`DELETE FROM wine.appellation_grapes WHERE source = 'pdo-dataset'`);

  // ---- appellations ---------------------------------------------------
  const appCols = [
    "name", "name_norm", "country", "gi_type", "eu_gi_id", "eu_file_number", "protection_date",
    "status", "legal_instrument", "register_url", "categories", "max_yield_hl", "max_yield_kg",
    "min_planting_density", "irrigation", "municipalities", "source", "source_ref",
  ];
  const appRows: unknown[][] = [];
  // The PDO dataset carries keying slips: Colli Romagna centrale 6,635 hl/ha,
  // Verduno Pelaverga 8.1, Maremma toscana 80,000 kg/ha. No figure beats a wrong one.
  const droppedYields: string[] = [];
  const yieldHl = (name: string, v: unknown) => {
    const n = numOrNull(v);
    if (n !== null && !plausibleYield(n, "hl")) { droppedYields.push(`${name}: ${n} hl/ha`); return null; }
    return n;
  };
  const yieldKg = (name: string, v: unknown) => {
    const n = numOrNull(v);
    if (n !== null && !plausibleYield(n, "kg")) { droppedYields.push(`${name}: ${n} kg/ha`); return null; }
    return n;
  };
  let greekNorm = 0;
  let noName = 0;

  for (const g of gis) {
    const names = (g.protectedNames ?? []).filter((n) => na(n));
    const trans = (g.transcriptions ?? []).filter((n) => na(n));
    const name = names[0] ?? trans[0] ?? g.fileNumber;
    if (!names.length) noName++;
    let nameNorm = norm(name);
    if (!nameNorm && trans.length) { nameNorm = norm(trans[0]); greekNorm++; }
    const country = (g.countries ?? [])[0] ?? "EU";
    const pdo = idByPdoId.get(g.fileNumber);
    appRows.push([
      name, nameNorm, country, g.giType, g.giIdentifier, g.fileNumber, na(g.euProtectionDate),
      na(g.status), na(g.legalInstrument?.text), `${EAMBROSIA_URL}/${g.giIdentifier}`,
      pdo ? splitSlash(pdo.Category_of_wine_product) : [],
      pdo ? yieldHl(name, pdo.Maximum_yield_hl) : null,
      pdo ? yieldKg(name, pdo.Maximum_yield_kg) : null,
      pdo ? numOrNull(pdo.Minimum_planting_density) : null,
      pdo ? na(pdo.Irrigation) : null,
      pdo ? splitSlash(pdo.Municip_nam) : [],
      "eambrosia", g.giIdentifier,
    ]);
  }

  // PDO rows with no eambrosia record of their own.
  const orphans = idRows.filter((r) => !byFileNumber.has(r.PDOid.trim()));
  for (const r of orphans) {
    const name = na(r.PDOnam) ?? r.PDOid;
    appRows.push([
      name, norm(name), na(r.Country) ?? "EU", "PDO", null, r.PDOid.trim(), na(r.Registration),
      null, null, na(r.PDOinfo), splitSlash(r.Category_of_wine_product),
      yieldHl(name, r.Maximum_yield_hl), yieldKg(name, r.Maximum_yield_kg), numOrNull(r.Minimum_planting_density),
      na(r.Irrigation), splitSlash(r.Municip_nam), "pdo-dataset", r.PDOid.trim(),
    ]);
  }

  const appOut = await insertMany(
    pool, "wine.appellations", appCols, appRows,
    `ON CONFLICT (source, source_ref) DO UPDATE SET ${appCols.filter((c) => c !== "source" && c !== "source_ref").map((c) => `${c} = EXCLUDED.${c}`).join(", ")}`,
  );
  notes.implausible_yields_dropped = droppedYields;

  const idMap = new Map<string, number>();
  const fileMap = new Map<string, number>();
  const { rows: idRowsBack } = await pool.query(
    `SELECT id, source, source_ref, eu_file_number FROM wine.appellations WHERE source = ANY($1::text[])`,
    [["eambrosia", "pdo-dataset"]],
  );
  for (const r of idRowsBack) {
    idMap.set(`${r.source}|${r.source_ref}`, r.id);
    if (r.eu_file_number) fileMap.set(r.eu_file_number, r.id);
  }

  // ---- appellation_names ----------------------------------------------
  const seen = new Set<string>();
  const nameRows: unknown[][] = [];
  const pushName = (appId: number, raw: string | null | undefined, kind: string, source: string) => {
    const n = na(raw);
    if (!n) return;
    const nn = norm(n);
    if (!nn) return;
    const key = `${appId}|${nn}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    nameRows.push([appId, n, nn, kind, source]);
  };

  let aliasStripped = 0;
  for (const g of gis) {
    const appId = idMap.get(`eambrosia|${g.giIdentifier}`);
    if (!appId) continue;
    for (const n of g.protectedNames ?? []) pushName(appId, n, "protected", "eambrosia");
    for (const t of g.transcriptions ?? []) pushName(appId, t, "transcription", "eambrosia");
    for (const n of [...(g.protectedNames ?? []), ...(g.transcriptions ?? [])]) {
      const s = na(n) ? stripLegal(na(n) as string) : null;
      if (s) { const before = nameRows.length; pushName(appId, s, "alias", "eambrosia"); if (nameRows.length > before) aliasStripped++; }
    }
  }
  for (const r of idRows) {
    const appId = fileMap.get(r.PDOid.trim());
    if (!appId) continue;
    for (const part of splitSlash(r.PDOnam)) {
      pushName(appId, part, "alias", "pdo-dataset");
      const s = stripLegal(part);
      if (s) pushName(appId, s, "alias", "pdo-dataset");
    }
  }
  const nameOut = await insertMany(pool, "wine.appellation_names", ["appellation_id", "name", "name_norm", "kind", "source"], nameRows, "ON CONFLICT DO NOTHING");

  // ---- appellation_grapes ---------------------------------------------
  const seenG = new Set<string>();
  const grapeRows: unknown[][] = [];
  let catNoApp = 0;
  for (const r of catRows) {
    const appId = fileMap.get(r.PDOid.trim());
    if (!appId) { catNoApp++; continue; }
    const category = na(r.Category_of_wine_product) ?? "unspecified";
    for (const [col, kind] of [["Varieties_OIV", "oiv"], ["Varieties_Other", "other"]] as const) {
      for (const item of splitSlash(r[col])) {
        const toks = item.split(/\s+/).filter(Boolean);
        let colour: string | null = null;
        let nameToks = toks;
        if (toks.length > 1 && COLOUR_CODES.has(toks[toks.length - 1])) {
          colour = toks[toks.length - 1];
          nameToks = toks.slice(0, -1);
        }
        const raw = nameToks.join(" ");
        if (!raw) continue;
        const key = `${appId}|${raw}|${kind}|${category}`;
        if (seenG.has(key)) continue;
        seenG.add(key);
        grapeRows.push([appId, raw, null, colour, kind, category, "pdo-dataset"]);
      }
    }
  }
  const grapeOut = await insertMany(
    pool, "wine.appellation_grapes",
    ["appellation_id", "grape_name_raw", "grape_id", "colour_code", "kind", "category", "source"],
    grapeRows, "ON CONFLICT DO NOTHING",
  );

  notes.eambrosia_files = files.length;
  notes.pdo_id_rows = idRows.length;
  notes.pdo_cat_rows = catRows.length;
  notes.appellations_eambrosia = gis.length;
  notes.appellations_pdo_only = orphans.length;
  notes.pdo_orphan_ids = orphans.map((r) => `${r.PDOid}=${r.PDOnam}`);
  notes.pdo_joined_to_eambrosia = idRows.length - orphans.length;
  notes.names_rows = nameOut;
  notes.names_stripped_aliases = aliasStripped;
  notes.grape_rows = grapeOut;
  notes.cat_rows_without_appellation = catNoApp;
  notes.non_latin_name_norm_from_transcription = greekNorm;
  notes.records_without_protected_name = noName;
  notes.register_url_note = "eambrosia rows use the eAmbrosia details URL keyed by giIdentifier; PDOinfo in the CSV uses an unrelated numeric internal id, kept only for pdo-dataset-only rows";

  await logLoad(pool, "load-appellations", {
    rows_in: files.length + idRows.length + catRows.length,
    rows_out: appOut + nameOut + grapeOut,
    matched: idRows.length - orphans.length,
    unmatched: orphans.length,
  }, notes);

  console.log(`appellations=${appOut} names=${nameOut} appellation_grapes=${grapeOut}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
