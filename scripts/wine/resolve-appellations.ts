/**
 * resolve-appellations.ts - point every LWIN wine at an appellation.
 *
 * Agent C, after agent A (LWIN spine) and agent B (EU register).
 *
 * LWIN carries country / region / sub_region / site / designation. The
 * register (eAmbrosia) is EU-only, so there are two jobs:
 *
 *   1. EU wines: match the LWIN strings against wine.appellation_names,
 *      country-restricted, in the order sub_region -> site -> region.
 *      Where LWIN's spelling differs from the register's, the difference is
 *      fixed by INSERTING the LWIN spelling into wine.appellation_names with
 *      kind='lwin', so the join stays a join and the alias is auditable.
 *      Two alias generators run: a curated English/spelling table
 *      (LWIN_ALIASES, every entry verified against the register at load time
 *      and dropped with a note when it does not resolve), and a mechanical
 *      one that strips a trailing wine-type word ("Etna Rosso" -> "Etna")
 *      from strings that did not match exactly.
 *
 *   2. Non-EU wines: no register exists, so synthesise one appellation row
 *      per (country, designation, sub_region-or-region) with source='lwin'
 *      and gi_type from the designation, and match the wines to it. Only
 *      where the wine actually carries a designation - an undesignated
 *      Californian red gets nothing.
 *
 * EU wines that do not match stay NULL with appellation_match='none'. The
 * top unmatched buckets are printed and written to load_log.notes so the
 * alias table can grow.
 *
 * Idempotent: nulls every wines.appellation_id, drops its own
 * appellation_names (kind='lwin') and synthetic appellations (source='lwin'),
 * then rebuilds.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/resolve-appellations.ts
 */
import type pg from "pg";
import { connect, insertMany, logLoad, norm, upsertSource } from "./lib";

/**
 * Countries the EU register covers. A wine here either matches a register
 * row or stays NULL - no synthetic rows, because inventing a PDO for an EU
 * country would put a made-up name next to 1,688 real ones. GB is in the set:
 * eAmbrosia still carries the six UK protected names.
 */
const EU_REGISTER = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/** Designations that name a real non-EU GI scheme; everything else is 'other'. */
const GI_TYPES = new Set(["AVA", "GI", "WO", "VQA"]);

/**
 * LWIN spelling -> register spelling, per country. LWIN's REGION column is in
 * English ("Burgundy", "Tuscany") and its SUB_REGION sometimes names a wine
 * type rather than the protected name ("Moscato d'Asti" is made under the
 * Asti DOCG). Every right-hand side is looked up in wine.appellation_names
 * before it is used; misses are reported, never silently dropped.
 *
 * Deliberately NOT aliased, with the reason:
 *   ES "Castilla La Mancha" - the region spans the "Castilla" PGI and the
 *     "La Mancha" PDO; picking one would be a guess.
 *   PT "Beiras" - splits into Beira Atlantico (PGI) and Beira Interior (PDO).
 *   HR "Dalmacija" - three register names (Sjeverna / Srednja i Juzna /
 *     Dalmatinska zagora).
 *   IT "Piedmont"/"Sicily" ARE aliased (Piemonte and Sicilia are DOCs), but
 *     "Sardinia", "Lombardia", "Liguria", "Trentino Alto Adige" are not
 *     region-level protected names.
 *   BG "Thracian Lowlands", GR "Pangeon", DE "Rhein" - no register row.
 *   NL "Maasvallei Limburg" - the register files it under BE; a cross-border
 *     match would break the country restriction every other stage relies on.
 */
const LWIN_ALIASES: Array<[string, string, string]> = [
  // country, LWIN string, register name
  ["FR", "Burgundy", "Bourgogne"],
  ["FR", "Loire", "Val de Loire"],
  ["FR", "Corsica", "Corse"],
  ["FR", "Rhone", "Cotes du Rhone"],
  ["FR", "Macon-Villages", "Macon"],
  ["FR", "Arbois Pupillin", "Arbois"],
  ["FR", "Bouches-du-Rhone", "Pays des Bouches-du-Rhone"],
  ["IT", "Tuscany", "Toscana"],
  ["IT", "Piedmont", "Piemonte"],
  ["IT", "Sicily", "Sicilia"],
  ["IT", "Moscato d'Asti", "Asti"],
  ["IT", "Barolo Chinato", "Barolo"],
  ["ES", "Canary Islands", "Islas Canarias"],
  ["ES", "Tenerife", "Islas Canarias"],
  ["PT", "Moscatel de Setubal", "Setubal"],
  ["DK", "Sjalland", "Sjælland"],
  ["BE", "Cotes de Sambre & Meuse", "Cotes de Sambre et Meuse"],
  ["GR", "Crete", "Kriti"],
  ["GR", "Peloponnese", "Peloponnisos"],
  ["GR", "Macedonia", "Makedonia"],
  ["GR", "Cyclades", "Kiklades"],
  ["GR", "Aegean Islands", "Aegeo Pelagos"],
  ["GR", "Amyndaio", "Amynteo"],
  ["GR", "Corinthia", "Korinthos"],
  ["GR", "Arcadia", "Arkadia"],
  ["GR", "Laconia", "Lakonia"],
  ["GR", "Mount Athos", "Ayio Oros"],
  ["GR", "Thivaikos", "Thiva"],
  ["GR", "Lemnos", "Limnos"],
  ["GR", "Valley of Atalanti", "Kilada Atalantis"],
  ["GR", "Central Greece", "Sterea Ellada"],
  ["GR", "Thrace", "Thraki"],
  ["CY", "Commandaria", "Koumandaria"],
  ["CZ", "Moravia", "Morava"],
  // The UK protected names are adjectives, not places: the register row is
  // "English", LWIN's region is "England".
  ["GB", "England", "English"],
  ["GB", "Wales", "Welsh"],
];

/**
 * Wine-type words LWIN bolts onto a protected name. Stripped from the END of
 * a string only, and only after the exact stage has failed - so
 * "Bordeaux Superieur", which is its own PDO, is never reduced to "Bordeaux".
 */
const TYPE_SUFFIX = new Set([
  "rosso", "rossa", "bianco", "bianca", "rosato", "spumante", "chinato", "passito",
  "liquoroso", "novello", "frizzante", "amabile", "dolce", "secco", "vendemmia",
  "tardiva", "rouge", "blanc", "blanche", "rose", "sec", "moelleux", "doux", "mousseux",
  "tinto", "blanco", "espumoso", "dulce", "branco", "red", "white", "sparkling", "sweet",
]);

/**
 * norm() cannot see through the letters NFKD does not decompose, so the
 * register's "Sjælland" is stored as name_norm "sj lland". Curated alias
 * targets are therefore resolved through this second spelling as well - it is
 * used only to FIND the register row, never stored as a join key.
 */
const LIGATURES: Array<[RegExp, string]> = [
  [/æ/g, "ae"], [/ø/g, "o"], [/å/g, "a"], [/œ/g, "oe"], [/đ/g, "d"], [/ð/g, "d"],
  [/þ/g, "th"], [/ł/g, "l"], [/ı/g, "i"], [/ħ/g, "h"], [/ŋ/g, "ng"],
];

export function looseNorm(s: string): string {
  let t = s.toLowerCase();
  for (const [re, to] of LIGATURES) t = t.replace(re, to);
  return norm(t);
}

function stripTypeSuffix(nn: string): string {
  let toks = nn.split(" ").filter(Boolean);
  while (toks.length > 1 && TYPE_SUFFIX.has(toks[toks.length - 1])) toks = toks.slice(0, -1);
  return toks.join(" ");
}

type App = { id: number; gi_type: string; grapes: number };
type Wine = {
  lwin: string;
  country: string | null;
  region: string | null;
  sub_region: string | null;
  site: string | null;
  designation: string | null;
  status: string;
};

/** country|name_norm -> appellation ids. Rebuilt after each alias insert. */
class Index {
  private map = new Map<string, App[]>();
  constructor(private apps: Map<number, App>) {}

  add(country: string, nameNorm: string, id: number) {
    if (!nameNorm) return;
    const a = this.apps.get(id);
    if (!a) return;
    const k = `${country}|${nameNorm}`;
    const list = this.map.get(k);
    if (!list) this.map.set(k, [a]);
    else if (!list.some((x) => x.id === a.id)) list.push(a);
  }

  /** PDO beats PGI beats the rest; then more permitted grapes; then lower id. */
  pick(country: string | null, nameNorm: string): { id: number | null; tie: boolean } {
    if (!country || !nameNorm) return { id: null, tie: false };
    const list = this.map.get(`${country}|${nameNorm}`);
    if (!list || list.length === 0) return { id: null, tie: false };
    if (list.length === 1) return { id: list[0].id, tie: false };
    const rank = (t: string) => (t === "PDO" ? 2 : t === "PGI" ? 1 : 0);
    const sorted = [...list].sort(
      (a, b) => rank(b.gi_type) - rank(a.gi_type) || b.grapes - a.grapes || a.id - b.id,
    );
    return { id: sorted[0].id, tie: true };
  }
}

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await upsertSource(pool, {
    slug: "lwin",
    name: "Liv-ex LWIN database",
    licence: "Liv-ex LWIN, free registration; identifiers and names only",
    pulled_at: "2026-09-14",
    notes: "LWIN-7 spine: producers, wines. resolve-appellations.ts also files non-EU designations here.",
  });

  // ---- idempotence ----------------------------------------------------
  await pool.query(`UPDATE wine.wines SET appellation_id = NULL, appellation_match = NULL`);
  await pool.query(`DELETE FROM wine.appellation_names WHERE source = 'lwin'`);
  const dropped = await pool.query(`DELETE FROM wine.appellations WHERE source = 'lwin'`);
  notes.synthetic_dropped_on_rerun = dropped.rowCount ?? 0;

  // ---- register index -------------------------------------------------
  const apps = new Map<number, App>();
  {
    const { rows } = await pool.query(
      `SELECT a.id, a.gi_type, a.country,
              (SELECT count(*)::int FROM wine.appellation_grapes g WHERE g.appellation_id = a.id) grapes
         FROM wine.appellations a`,
    );
    for (const r of rows) apps.set(r.id, { id: r.id, gi_type: r.gi_type, grapes: r.grapes });
  }
  const index = new Index(apps);
  const countryOf = new Map<number, string>();
  {
    const { rows } = await pool.query(
      `SELECT n.appellation_id id, n.name_norm, a.country FROM wine.appellation_names n
         JOIN wine.appellations a ON a.id = n.appellation_id`,
    );
    for (const r of rows) {
      index.add(r.country, r.name_norm, r.id);
      countryOf.set(r.id, r.country);
    }
  }
  const { rows: acRows } = await pool.query(`SELECT id, country, name FROM wine.appellations`);
  for (const r of acRows) countryOf.set(r.id, r.country);
  // country|looseNorm(name) -> id, for curated alias targets only.
  const looseTarget = new Map<string, number>();
  for (const r of acRows) {
    const k = `${r.country}|${looseNorm(r.name)}`;
    if (!looseTarget.has(k)) looseTarget.set(k, r.id);
  }

  // ---- curated aliases ------------------------------------------------
  // The right-hand side must already be a known name for an appellation in
  // that country, or the entry is dropped and reported.
  const aliasRows: unknown[][] = [];
  const aliasMisses: string[] = [];
  for (const [country, lwinName, registerName] of LWIN_ALIASES) {
    const targetId = index.pick(country, norm(registerName)).id
      ?? looseTarget.get(`${country}|${looseNorm(registerName)}`)
      ?? null;
    if (!targetId) { aliasMisses.push(`${country}|${lwinName}->${registerName}`); continue; }
    if (index.pick(country, norm(lwinName)).id) continue; // already joins, nothing to add
    aliasRows.push([targetId, lwinName, norm(lwinName), "lwin", "lwin"]);
  }
  const aliasInserted = await insertMany(
    pool, "wine.appellation_names",
    ["appellation_id", "name", "name_norm", "kind", "source"],
    aliasRows, "ON CONFLICT DO NOTHING",
  );
  for (const r of aliasRows) index.add(countryOf.get(r[0] as number) as string, r[2] as string, r[0] as number);
  notes.curated_aliases = aliasInserted;
  notes.curated_alias_misses = aliasMisses;

  // ---- wines ----------------------------------------------------------
  const { rows: wines } = (await pool.query(
    `SELECT lwin::text, country, region, sub_region, site, designation, status FROM wine.wines`,
  )) as { rows: Wine[] };

  const methodOf = new Map<string, { id: number; method: string }>();
  const ties: Record<string, number> = {};

  /** One wine, register stages only. Returns null when nothing matched. */
  function matchRegister(w: Wine): { id: number; method: string } | null {
    const c = w.country;
    if (!c) return null;
    const stages: Array<[string, string]> = [];
    if (w.sub_region) {
      stages.push(["sub_region", norm(w.sub_region)]);
      // LWIN files the Alsace grand cru lieux-dits in SUB_REGION, not SITE
      // ("Alsace / Eichberg / Grand Cru"), and each one is its own PDO named
      // "Alsace grand cru <lieu-dit>". Without this the wine falls through to
      // the region stage and lands on plain Alsace.
      if (w.country === "FR") stages.push(["sub_region", norm(`alsace grand cru ${w.sub_region}`)]);
    }
    if (w.site) {
      stages.push(["site", norm(w.site)]);
      // Alsace grand cru lieux-dits are each their own PDO, named
      // "Alsace grand cru <lieu-dit>"; LWIN keeps the bare lieu-dit.
      if (c === "FR") stages.push(["site", norm(`alsace grand cru ${w.site}`)]);
    }
    if (w.region) stages.push(["region", norm(w.region)]);
    for (const [method, nn] of stages) {
      const hit = index.pick(c, nn);
      if (hit.id) {
        if (hit.tie) ties[`${c}|${nn}`] = (ties[`${c}|${nn}`] ?? 0) + 1;
        return { id: hit.id, method };
      }
    }
    return null;
  }

  // Pass 1: the register as agent B loaded it, plus the curated aliases.
  for (const w of wines) {
    const m = matchRegister(w);
    if (m) methodOf.set(w.lwin, m);
  }

  // ---- generated aliases: strip a trailing wine-type word -------------
  // Only for strings that failed pass 1, so an exact PDO is never shadowed.
  const genCandidates = new Map<string, { country: string; raw: string }>();
  for (const w of wines) {
    if (methodOf.has(w.lwin) || !w.country) continue;
    for (const raw of [w.sub_region, w.region]) {
      if (!raw) continue;
      const nn = norm(raw);
      const stripped = stripTypeSuffix(nn);
      if (!stripped || stripped === nn) continue;
      genCandidates.set(`${w.country}|${nn}`, { country: w.country, raw });
    }
  }
  const genRows: unknown[][] = [];
  for (const { country, raw } of genCandidates.values()) {
    const stripped = stripTypeSuffix(norm(raw));
    const target = index.pick(country, stripped);
    if (!target.id) continue;
    genRows.push([target.id, raw, norm(raw), "lwin", "lwin"]);
  }
  const genInserted = await insertMany(
    pool, "wine.appellation_names",
    ["appellation_id", "name", "name_norm", "kind", "source"],
    genRows, "ON CONFLICT DO NOTHING",
  );
  for (const r of genRows) index.add(countryOf.get(r[0] as number) as string, r[2] as string, r[0] as number);
  notes.generated_type_suffix_aliases = genInserted;
  notes.generated_examples = genRows.slice(0, 12).map((r) => r[1]);

  // Pass 2: the strings the generator just taught the index.
  for (const w of wines) {
    if (methodOf.has(w.lwin)) continue;
    const m = matchRegister(w);
    if (m) methodOf.set(w.lwin, m);
  }

  // ---- synthetic non-EU appellations ----------------------------------
  // One row per PLACE, not per (place, designation). LWIN's DESIGNATION
  // column is not consistent within a region - Paso Robles is filed as AVA,
  // DO and AOP, Stellenbosch as WO and AVA - so keying the row on the
  // designation splits one appellation into three. The place is the key; the
  // designation that most of its wines carry becomes the gi_type and the
  // source_ref, which keeps the source_ref shape country|designation|place.
  type Syn = { country: string; name: string; via: string; designations: Map<string, number> };
  const syn = new Map<string, Syn>();
  const placeOf = new Map<string, string>(); // wine lwin -> place key
  for (const w of wines) {
    if (methodOf.has(w.lwin)) continue;
    const c = w.country;
    if (!c || EU_REGISTER.has(c) || !w.designation) continue;
    const via = w.sub_region ? "sub_region" : w.region ? "region" : null;
    if (!via) continue;
    const name = (via === "sub_region" ? w.sub_region : w.region) as string;
    const key = `${c}|${norm(name)}`;
    let e = syn.get(key);
    if (!e) { e = { country: c, name, via, designations: new Map() }; syn.set(key, e); }
    e.designations.set(w.designation, (e.designations.get(w.designation) ?? 0) + 1);
    placeOf.set(w.lwin, key);
  }
  /** The designation most of the place's wines carry; alphabetical on a tie. */
  function modal(m: Map<string, number>): string {
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  }
  const split = [...syn.values()].filter((s) => s.designations.size > 1).length;
  const refByKey = new Map<string, string>();
  const synRows = [...syn.entries()].map(([key, s]) => {
    const d = modal(s.designations);
    const ref = `${s.country}|${d}|${s.name}`;
    refByKey.set(key, ref);
    return [s.name, norm(s.name), s.country,
      GI_TYPES.has(d.toUpperCase()) ? d.toUpperCase() : "other", "lwin", ref];
  });
  await insertMany(
    pool, "wine.appellations",
    ["name", "name_norm", "country", "gi_type", "source", "source_ref"],
    synRows, "ON CONFLICT (source, source_ref) DO NOTHING",
  );
  const { rows: synBack } = await pool.query(
    `SELECT id, source_ref FROM wine.appellations WHERE source = 'lwin'`,
  );
  const synId = new Map<string, number>(synBack.map((r: any) => [r.source_ref, r.id]));
  notes.synthetic_appellations = synBack.length;
  notes.synthetic_places_with_mixed_designations = split;

  for (const w of wines) {
    if (methodOf.has(w.lwin)) continue;
    const key = placeOf.get(w.lwin);
    if (!key) continue;
    const id = synId.get(refByKey.get(key) as string);
    // The method is this wine's own column, not the place's first one: a place
    // can be a sub_region for some wines and the region for others.
    if (id) methodOf.set(w.lwin, { id, method: w.sub_region ? "sub_region" : "region" });
  }

  // ---- write ----------------------------------------------------------
  const byMethod: Record<string, number> = {};
  const pairs: Array<[string, number, string]> = [];
  for (const w of wines) {
    const m = methodOf.get(w.lwin);
    if (m) pairs.push([w.lwin, m.id, m.method]);
    if (w.status === "Live") byMethod[m ? m.method : "none"] = (byMethod[m ? m.method : "none"] ?? 0) + 1;
  }
  await writeMatches(pool, pairs);
  await pool.query(`UPDATE wine.wines SET appellation_match = 'none' WHERE appellation_id IS NULL`);

  // ---- report ---------------------------------------------------------
  const euLive = wines.filter((w) => w.status === "Live" && w.country && EU_REGISTER.has(w.country));
  const euHit = euLive.filter((w) => methodOf.has(w.lwin)).length;
  notes.eu_live = euLive.length;
  notes.eu_live_resolved = euHit;
  notes.eu_live_pct = Number(((100 * euHit) / euLive.length).toFixed(2));
  notes.by_method_live = byMethod;
  notes.ties = Object.entries(ties).sort((a, b) => b[1] - a[1]).slice(0, 20);
  notes.tie_count = Object.keys(ties).length;

  const byCountry: Record<string, [number, number]> = {};
  for (const w of wines) {
    if (w.status !== "Live" || !w.country) continue;
    const e = byCountry[w.country] ?? [0, 0];
    e[1]++;
    if (methodOf.has(w.lwin)) e[0]++;
    byCountry[w.country] = e;
  }
  notes.by_country_live = Object.fromEntries(
    Object.entries(byCountry).sort((a, b) => b[1][1] - a[1][1]).slice(0, 25)
      .map(([k, [r, t]]) => [k, `${r}/${t} ${Math.round((100 * r) / t)}%`]),
  );

  const unmatched = new Map<string, number>();
  for (const w of wines) {
    if (w.status !== "Live" || methodOf.has(w.lwin)) continue;
    const k = `${w.country ?? ""}\t${w.region ?? ""}\t${w.sub_region ?? ""}`;
    unmatched.set(k, (unmatched.get(k) ?? 0) + 1);
  }
  const top = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  notes.top_unmatched = top.map(([k, v]) => {
    const [c, r, s] = k.split("\t");
    return { country: c, region: r, sub_region: s, wines: v };
  });

  console.log(`EU live ${euHit}/${euLive.length} = ${notes.eu_live_pct}%`);
  console.log("by method (Live):", byMethod);
  console.log("top 40 unmatched Live (country / region / sub_region / count):");
  for (const [k, v] of top) console.log(`  ${String(v).padStart(6)}  ${k.split("\t").join(" / ")}`);

  await logLoad(pool, "resolve-appellations", {
    rows_in: wines.length,
    rows_out: pairs.length,
    matched: euHit,
    unmatched: euLive.length - euHit,
  }, notes);

  await pool.end();
}

/** Batched UPDATE ... FROM (VALUES ...) so 190k rows do not become 190k statements. */
async function writeMatches(pool: pg.Pool, pairs: Array<[string, number, string]>): Promise<void> {
  const CHUNK = 5000;
  for (let i = 0; i < pairs.length; i += CHUNK) {
    const slice = pairs.slice(i, i + CHUNK);
    const params: unknown[] = [];
    const values = slice.map((p) => {
      params.push(p[0], p[1], p[2]);
      return `($${params.length - 2}::bigint,$${params.length - 1}::int,$${params.length})`;
    }).join(",");
    await pool.query(
      `UPDATE wine.wines w SET appellation_id = v.app, appellation_match = v.m
         FROM (VALUES ${values}) AS v(lwin, app, m) WHERE w.lwin = v.lwin`,
      params,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
