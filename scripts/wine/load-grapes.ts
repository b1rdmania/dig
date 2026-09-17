/**
 * load-grapes.ts - Wikidata grape varieties, then resolve the register's
 * permitted-variety strings against them.
 *
 * Reads:  data/wine/raw/wikidata/03_grape_varieties.csv (2,747 rows, "|"-separated cells)
 *         data/wine/raw/grapes-catalogues/vivc/vivc-wine-grape-passport-data.csv (berry colour by VIVC number)
 *         scripts/wine/grape-synonyms.json (manual raw_norm -> QID, verified only)
 * Writes: wine.grapes, wine.grape_names, and wine.appellation_grapes.grape_id
 *
 * Owns source='wikidata' in wine.grapes/grape_names. Idempotent: nulls the
 * grape_id values it set, deletes its grapes, reloads, re-resolves.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-grapes.ts
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { RAW, connect, insertMany, logLoad, na, norm, readCsv, readJson, upsertSource } from "./lib";

const SYNONYMS_PATH = resolve(__dirname, "grape-synonyms.json");

/** Wikidata colour statements -> the four values the schema allows. */
const ROSE = ["pink", "grey", "gris", "rose", "rosé", "rosa"];
const RED = ["black", "blue", "noir", "red", "purpl", "violet", "ruby", "brick", "jet"];
const WHITE = ["white", "green", "yellow", "blanc", "gold", "lime", "amber"];

/**
 * Wikidata carries two colour statements per variety - berry-skin colour and
 * a plain colour - and they disagree for 368 rows: Semillon is "black berry
 * skin|white", Silvaner "yellow-green|black berry skin". "black berry skin"
 * is the spurious one, so rose beats white beats red rather than first-wins.
 */
function colourOf(cell: string | null | undefined): string {
  const raw = na(cell);
  if (!raw) return "unknown";
  const toks = raw.split("|").map((t) => t.toLowerCase());
  // A lone "black berry skin" is no evidence at all: where VIVC can check it,
  // it is wrong 45% of the time (Xarel·lo, Altesse, Arbois, Bacchus all
  // "black"). Unknown beats a coin toss on the counter.
  if (toks.length === 1 && toks[0] === "black berry skin") return "unknown";
  if (toks.some((t) => ROSE.some((k) => t.includes(k)))) return "rose";
  if (toks.some((t) => WHITE.some((k) => t.includes(k)))) return "white";
  if (toks.some((t) => RED.some((k) => t.includes(k)))) return "red";
  return "unknown";
}

/** VIVC passport "Color of berry skin" -> schema colour. VIVC is ampelography; it wins over Wikidata. */
const VIVC_COLOUR: Record<string, string> = { BLANC: "white", NOIR: "red", ROUGE: "red", ROSE: "rose", GRIS: "rose" };
const VIVC_PATH = resolve(RAW, "grapes-catalogues", "vivc", "vivc-wine-grape-passport-data.csv");

/** VIVC number -> colour, for every wine-grape passport row that states one. */
async function readVivcColours(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!existsSync(VIVC_PATH)) return out;
  for await (const r of readCsv(VIVC_PATH)) {
    const id = na(r["VIVC number"]);
    const colour = VIVC_COLOUR[(na(r["Color of berry skin"]) ?? "").toUpperCase()];
    if (id && colour) out.set(id, colour);
  }
  return out;
}

/** VIVC berry colour when the item carries a VIVC number that VIVC knows; Wikidata's statements otherwise. */
function grapeColour(vivcIds: string[], wikidataCell: string | null | undefined, vivc: Map<string, string>): string {
  const fromVivc = [...new Set(vivcIds.map((id) => vivc.get(id)).filter((c): c is string => !!c))];
  if (fromVivc.length === 1) return fromVivc[0];
  return colourOf(wikidataCell);
}

/** Register colour code -> expected grape colour, for the fuzzy stages. */
function colourFromCode(code: string | null): string | null {
  if (!code) return null;
  if (code === "B") return "white";
  if (code === "N") return "red";
  if (code === "Rs" || code === "Rg" || code === "G" || code === "Gr" || code === "R") return "rose";
  return null;
}

/**
 * Colour adjectives the national registers bolt onto a variety name:
 * "Weißer Riesling" is Riesling, "Blauer Spätburgunder" is Pinot Noir.
 */
const COLOUR_WORDS = new Set([
  "weisser", "weisse", "weiss", "weisen", "blauer", "blaue", "blau", "grauer", "graue",
  "roter", "rote", "rot", "gelber", "gelbe", "fruhroter", "fruhrote", "schwarzer",
  "blanc", "blanche", "blancs", "noir", "noire", "noirs", "gris", "grise", "rouge", "rose",
  "bianco", "bianca", "bianchi", "nero", "nera", "neri", "grigio", "grigia", "rosso", "rossa",
  "blanco", "blanca", "tinto", "tinta", "negro", "negra", "rosado", "roxo", "branco",
]);

/**
 * The colour a variety name states about itself: "Caino blanco" is white,
 * "Douce noir" red. Name words are reliable where Wikidata's colour
 * statements are not, so they veto a match the colour code contradicts.
 */
const NAME_WHITE = new Set(["blanc", "blanche", "blanco", "bianco", "branco", "weiss", "weisser", "white", "belyi", "zold", "verde", "bily"]);
const NAME_RED = new Set(["noir", "noire", "nero", "nera", "negro", "negra", "tinto", "tinta", "neagra", "modre", "modry", "schwarz", "schwarzer", "black", "rouge", "rosso", "rossa", "kek"]);

function nameColourWord(nameNorm: string): string | null {
  const toks = nameNorm.split(" ");
  if (toks.some((t) => NAME_WHITE.has(t))) return "white";
  if (toks.some((t) => NAME_RED.has(t))) return "red";
  return null;
}

function splitPipe(v: string | null | undefined): string[] {
  const t = na(v);
  if (!t) return [];
  return t.split("|").map((s) => s.trim()).filter(Boolean);
}

function stripColourWords(nameNorm: string): string {
  const toks = nameNorm.split(" ").filter((t) => t && !COLOUR_WORDS.has(t));
  return toks.join(" ");
}

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await upsertSource(pool, {
    slug: "vivc",
    name: "Vitis International Variety Catalogue (JKI Geilweilerhof)",
    licence: "open, citation requested (Roeckel et al.)",
    pulled_at: "2026-09-03",
    notes: "wine-grape passport data, 6,893 records; supplies berry-skin colour over Wikidata",
  });
  const vivc = await readVivcColours();
  notes.vivc_colours = vivc.size;

  await upsertSource(pool, {
    slug: "wikidata",
    name: "Wikidata (wineries, regions, grape varieties, wines)",
    licence: "CC0",
    pulled_at: "2026-09-03",
    notes: "SPARQL exports; 03_grape_varieties.csv = 2,747 varieties with VIVC ids and parentage",
  });

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

  // ---- grapes ---------------------------------------------------------
  const grapeRows: unknown[][] = [];
  let noLabel = 0;
  const seenQid = new Set<string>();
  const weightByQid = new Map<string, number>();
  type Parsed = { qid: string; name: string; labels: [string, string][]; aliases: string[] };
  const parsed: Parsed[] = [];

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
    // How much Wikidata actually knows about this item. The export holds thin
    // duplicates ("Mourvedre" Q139941743 next to "Mourvèdre" Q161864); the
    // richer item wins when two grapes normalise to the same string.
    const weight = (splitPipe(r.vivcIds).length ? 4 : 0) + aliases.length
      + (splitPipe(r.parentVarieties).length ? 2 : 0) + (splitPipe(r.countriesOfOrigin).length ? 1 : 0);
    weightByQid.set(qid, weight);
    parsed.push({ qid, name, labels, aliases });
    grapeRows.push([
      name, norm(name), grapeColour(splitPipe(r.vivcIds), r.colours, vivc), qid,
      splitPipe(r.vivcIds), splitPipe(r.parentVarieties), splitPipe(r.countriesOfOrigin),
      "wikidata", qid,
    ]);
  }

  const grapesOut = await insertMany(
    pool, "wine.grapes",
    ["name", "name_norm", "colour", "wikidata_qid", "vivc_ids", "parent_varieties", "countries_of_origin", "source", "source_ref"],
    grapeRows, "ON CONFLICT DO NOTHING",
  );

  const { rows: back } = await pool.query(`SELECT id, source_ref, colour, name_norm FROM wine.grapes WHERE source='wikidata'`);
  const idByQid = new Map<string, number>();
  const colourById = new Map<number, string>();
  const primaryNormById = new Map<number, string>();
  const rankById = new Map<number, [number, number]>(); // [weight, -qidNumber]
  for (const r of back) {
    idByQid.set(r.source_ref, r.id);
    colourById.set(r.id, r.colour);
    primaryNormById.set(r.id, r.name_norm);
    rankById.set(r.id, [weightByQid.get(r.source_ref) ?? 0, -Number(String(r.source_ref).slice(1))]);
  }

  // ---- grape_names (PK is (grape_id, name_norm): primary > translation > synonym)
  const nameRows: unknown[][] = [];
  const takenName = new Set<string>();
  const pushName = (gid: number, raw: string, kind: string, lang: string | null) => {
    const n = na(raw);
    if (!n) return;
    const nn = norm(n);
    if (!nn) return;
    const key = `${gid}|${nn}`;
    if (takenName.has(key)) return;
    takenName.add(key);
    nameRows.push([gid, n, nn, kind, lang, "wikidata"]);
  };
  for (const p of parsed) {
    const gid = idByQid.get(p.qid);
    if (!gid) continue;
    pushName(gid, p.name, "primary", p.labels.find(([, v]) => v === p.name)?.[0] ?? "en");
    for (const [lang, v] of p.labels) pushName(gid, v, "translation", lang);
    for (const a of p.aliases) pushName(gid, a, "synonym", null);
  }
  const namesOut = await insertMany(
    pool, "wine.grape_names", ["grape_id", "name", "name_norm", "kind", "lang", "source"],
    nameRows, "ON CONFLICT DO NOTHING",
  );

  // ---- resolve appellation_grapes.grape_id ----------------------------
  // norm -> candidate grape ids, from every name we just loaded.
  const byNorm = new Map<string, Set<number>>();
  for (const r of nameRows) {
    const gid = r[0] as number;
    const nn = r[2] as string;
    if (!byNorm.has(nn)) byNorm.set(nn, new Set());
    (byNorm.get(nn) as Set<number>).add(gid);
  }

  const manual: Record<string, string> = existsSync(SYNONYMS_PATH) ? readJson<Record<string, string>>(SYNONYMS_PATH) : {};
  const manualIds = new Map<string, number>();
  const manualMissing: string[] = [];
  for (const [rawNorm, qid] of Object.entries(manual)) {
    const gid = idByQid.get(qid);
    if (gid) manualIds.set(rawNorm, gid);
    else manualMissing.push(`${rawNorm}=${qid}`);
  }

  /**
   * One candidate, or none. A norm that hits several grapes is decided by an
   * exact primary-name hit, then by how much Wikidata knows about the item,
   * then by the older QID - never left to insertion order.
   */
  let disambiguated = 0;
  let vetoedByColourWord = 0;
  function pick(nn: string, wantColour: string | null, strict: boolean): { gid: number | null; ambiguous: boolean } {
    const set = byNorm.get(nn);
    if (!set || set.size === 0) return { gid: null, ambiguous: false };
    let ids = [...set];
    // A white variety never resolves to a name that says "noir", and back.
    if (wantColour === "white" || wantColour === "red") {
      const kept = ids.filter((id) => {
        const w = nameColourWord(primaryNormById.get(id) ?? "");
        return !w || w === wantColour || wantColour === "rose";
      });
      if (kept.length === 0) { vetoedByColourWord++; return { gid: null, ambiguous: false }; }
      if (kept.length < ids.length) vetoedByColourWord++;
      ids = kept;
    }
    if (ids.length > 1) {
      const primaries = ids.filter((id) => primaryNormById.get(id) === nn);
      if (primaries.length >= 1) ids = primaries;
      if (ids.length > 1) {
        disambiguated++;
        ids = ids.sort((a, b) => {
          const ra = rankById.get(a) ?? [0, 0];
          const rb = rankById.get(b) ?? [0, 0];
          const ca = colourById.get(a) === wantColour ? 1 : 0;
          const cb = colourById.get(b) === wantColour ? 1 : 0;
          return cb - ca || rb[0] - ra[0] || rb[1] - ra[1];
        });
      }
    }
    const gid = ids[0];
    if (strict && wantColour) {
      const c = colourById.get(gid);
      if (c && c !== "unknown" && c !== wantColour) return { gid: null, ambiguous: false };
    }
    return { gid, ambiguous: false };
  }

  const { rows: agRows } = await pool.query(
    `SELECT appellation_id, grape_name_raw, kind, category, colour_code FROM wine.appellation_grapes WHERE source='pdo-dataset'`,
  );

  const stages: Record<string, number> = { manual: 0, exact: 0, colour_stripped: 0, first_two: 0 };
  let ambiguous = 0;
  const updates: [number, number, string, string, string][] = []; // gid, appId, raw, kind, category
  const unresolved = new Map<string, Set<number>>();

  for (const r of agRows) {
    const raw = r.grape_name_raw as string;
    const nn = norm(raw);
    const want = colourFromCode(r.colour_code as string | null);
    let gid: number | null = null;
    let amb = false;

    const m = manualIds.get(nn);
    if (m) { gid = m; stages.manual++; }

    if (!gid) {
      const e = pick(nn, want, false);
      if (e.gid) { gid = e.gid; stages.exact++; } else if (e.ambiguous) amb = true;
    }
    if (!gid) {
      const stripped = stripColourWords(nn);
      if (stripped && stripped !== nn) {
        const s = pick(stripped, want, true);
        if (s.gid) { gid = s.gid; stages.colour_stripped++; } else if (s.ambiguous) amb = true;
      }
    }
    if (!gid) {
      for (const cand of [nn, stripColourWords(nn)]) {
        const toks = cand.split(" ").filter(Boolean);
        if (toks.length <= 2) continue;
        const two = toks.slice(0, 2).join(" ");
        const s = pick(two, want, true);
        if (s.gid) { gid = s.gid; stages.first_two++; break; }
        if (s.ambiguous) amb = true;
      }
    }

    if (gid) {
      updates.push([gid, r.appellation_id as number, raw, r.kind as string, r.category as string]);
    } else {
      if (amb) ambiguous++;
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
  notes.ambiguous_norm_skipped = ambiguous;
  notes.disambiguated_by_rank = disambiguated;
  notes.colour_word_vetoes = vetoedByColourWord;
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
