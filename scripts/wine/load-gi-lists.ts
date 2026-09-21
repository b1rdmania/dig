/**
 * load-gi-lists.ts - real non-EU appellation lists, in place of the
 * synthetic per-place rows resolve-appellations.ts used to invent.
 *
 * Reads:
 *   data/wine/raw/ttb-ava/avas.geojson                         (US, 276 AVAs)
 *   data/wine/raw/wine-australia-gi/wine_gi_{zones,regions,subregions}.geojson (AU)
 *   scripts/wine/gi-lists/{nz,za,cl,ar}.json                    (committed, reproducible)
 *
 * Writes: wine.appellations, wine.appellation_names.
 * Owns source in {'ttb-ava','wine-australia-gi','iponz-gi','sawis-wo',
 * 'cl-decreto-464','inv-ig'}. Idempotent: upserts on (source, source_ref) with pinned ids (names rebuilt)
 * and reloads. parent_id is set within each source from its own hierarchy
 * (TTB `within`, or the committed list's `parent` field); AU's geojson states
 * no hierarchy field, so AU rows keep parent_id NULL.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm exec tsx scripts/wine/load-gi-lists.ts
 */
import { resolve } from "node:path";
import { dedupeAliases, parseAkaList, parsePipeList, resolveParents, type GiListRow } from "./gi-lists";
import { RAW, connect, insertMany, logLoad, norm, readJson, upsertSource } from "./lib";

const SOURCES = ["ttb-ava", "wine-australia-gi", "iponz-gi", "sawis-wo", "cl-decreto-464", "inv-ig"];

type AppRow = {
  name: string;
  country: string;
  gi_type: string;
  source: string;
  source_ref: string;
  parentRef: string | null; // source_ref of the parent, resolved to parent_id after insert
  aliases: string[];
};

// ---- US: TTB American Viticultural Areas ---------------------------------
type AvaFeature = { properties: { ava_id: string; name: string; aka: string | null; within: string | null; removed: string | null } };

function loadUsAvas(): AppRow[] {
  const geojson = readJson<{ features: AvaFeature[] }>(resolve(RAW, "ttb-ava", "avas.geojson"));
  const out: AppRow[] = [];
  for (const f of geojson.features) {
    const p = f.properties;
    if (p.removed) continue; // no AVA is actually flagged removed in this dataset, but honour it if one appears
    const parents = parsePipeList(p.within);
    out.push({
      name: p.name,
      country: "US",
      gi_type: "AVA",
      source: "ttb-ava",
      source_ref: p.ava_id,
      parentRef: parents[0] ?? null, // TTB's own name string; resolved to an ava_id below
      aliases: dedupeAliases(p.name, parseAkaList(p.aka)),
    });
  }
  // within holds a TTB AVA *name*, not an ava_id - resolve name -> ava_id inside this source.
  const idByNameNorm = new Map<string, string>();
  for (const r of out) idByNameNorm.set(norm(r.name), r.source_ref);
  for (const r of out) {
    if (r.parentRef) r.parentRef = idByNameNorm.get(norm(r.parentRef)) ?? null;
  }
  return out;
}

// ---- AU: Wine Australia GI zones / regions / subregions ------------------
type AuFeature = { properties: { GI_TYPE: string; GI_NAME: string; GI_NUMBER: number | string } };

function loadAuGis(): AppRow[] {
  const files = ["wine_gi_zones.geojson", "wine_gi_regions.geojson", "wine_gi_subregions.geojson"];
  const out: AppRow[] = [];
  const seenNumber = new Set<string>();
  for (const file of files) {
    const geojson = readJson<{ features: AuFeature[] }>(resolve(RAW, "wine-australia-gi", file));
    for (const f of geojson.features) {
      const p = f.properties;
      const ref = String(p.GI_NUMBER);
      if (seenNumber.has(ref)) continue; // a handful of rows repeat across the three files
      seenNumber.add(ref);
      out.push({
        name: p.GI_NAME,
        country: "AU",
        gi_type: p.GI_TYPE, // 'zone' | 'region' | 'subregion', as Wine Australia labels them
        source: "wine-australia-gi",
        source_ref: ref,
        parentRef: null, // the geojson states no zone/region/subregion parent field
        aliases: [],
      });
    }
  }
  return out;
}

// ---- NZ / ZA / CL / AR: committed gi-lists JSON ---------------------------
function loadCommittedList(cc: string, source: string): { rows: AppRow[]; parentMisses: string[] } {
  const list = readJson<GiListRow[]>(resolve(__dirname, "gi-lists", `${cc.toLowerCase()}.json`));
  const { parentIndex, misses } = resolveParents(list);
  const rows: AppRow[] = list.map((r, i) => ({
    name: r.name,
    country: cc,
    gi_type: r.gi_type,
    source,
    source_ref: `${cc}|${norm(r.name)}`,
    parentRef: parentIndex[i] === null ? null : `${cc}|${norm(list[parentIndex[i] as number].name)}`,
    aliases: dedupeAliases(r.name, r.aliases),
  }));
  return { rows, parentMisses: misses };
}

async function main() {
  const pool = connect();
  const notes: Record<string, unknown> = {};

  await upsertSource(pool, {
    slug: "ttb-ava", name: "TTB American Viticultural Areas (UC Davis AVA Project)",
    licence: "CC-BY 4.0 (UC Davis Library / DataLab)", pulled_at: "2026-09-03",
    notes: "avas.geojson, 276 AVAs with within/contains hierarchy and aka spellings.",
  });
  await upsertSource(pool, {
    slug: "wine-australia-gi", name: "Wine Australia register of protected GIs",
    licence: "Wine Australia open spatial data", pulled_at: "2026-09-03",
    notes: "wine_gi_{zones,regions,subregions}.geojson; no stated zone/region/subregion hierarchy field.",
  });
  await upsertSource(pool, {
    slug: "iponz-gi", name: "New Zealand wine geographical indications",
    licence: "public domain (NZ Crown legislation / IPONZ)", pulled_at: "2026-09-21",
    notes: "18 GIs registered 2017-2019 plus the enduring GIs New Zealand/North Island/South Island; scripts/wine/gi-lists/nz.json, sourced from Wikipedia (see data/wine/raw/gi-lists/nz/manifest.json).",
  });
  await upsertSource(pool, {
    slug: "sawis-wo", name: "South Africa Wine of Origin scheme",
    licence: "public domain (SA statutory scheme)", pulled_at: "2026-09-21",
    notes: "geographical unit / region / district / ward hierarchy; scripts/wine/gi-lists/za.json.",
  });
  await upsertSource(pool, {
    slug: "cl-decreto-464", name: "Chile zonificacion viticola (Decreto 464/1994, as modified 2018)",
    licence: "public domain (Chilean official gazette)", pulled_at: "2026-09-21",
    notes: "region / subregion (valle) / zona / area; scripts/wine/gi-lists/cl.json.",
  });
  await upsertSource(pool, {
    slug: "inv-ig", name: "Argentina INV Indicaciones Geograficas / Denominaciones de Origen Controladas",
    licence: "public domain (Argentine statutory scheme)", pulled_at: "2026-09-21",
    notes: "province -> DOC/IG -> paraje; scripts/wine/gi-lists/ar.json.",
  });

  // ---- idempotence ------------------------------------------------------
  // Upsert on (source, source_ref), never delete-and-insert: wine.wines and
  // the pack (bores/wine-bore/pack/shelves.json) store these ids, and a fresh
  // serial id on every run breaks both. Rows that left a list are removed
  // after the upsert, once nothing points at them.

  const us = loadUsAvas();
  const au = loadAuGis();
  const nz = loadCommittedList("NZ", "iponz-gi");
  const za = loadCommittedList("ZA", "sawis-wo");
  const cl = loadCommittedList("CL", "cl-decreto-464");
  const ar = loadCommittedList("AR", "inv-ig");

  const allRows: AppRow[] = [...us, ...au, ...nz.rows, ...za.rows, ...cl.rows, ...ar.rows];
  notes.rows_by_source = Object.fromEntries(
    SOURCES.map((s) => [s, allRows.filter((r) => r.source === s).length]),
  );
  notes.parent_misses = { NZ: nz.parentMisses, ZA: za.parentMisses, CL: cl.parentMisses, AR: ar.parentMisses };

  // ---- appellations -------------------------------------------------------
  // gi-lists/ids.json pins the id of every row ("source|source_ref" -> id), so
  // a first load into another database (prod) lands on the ids the pack holds.
  // A row that is not in the file yet takes the next serial id; add it.
  const pinned = readJson<Record<string, number>>(resolve(__dirname, "gi-lists", "ids.json"));
  const appCols = ["name", "name_norm", "country", "gi_type", "source", "source_ref"];
  const onConflict = "ON CONFLICT (source, source_ref) DO UPDATE SET name = EXCLUDED.name, name_norm = EXCLUDED.name_norm, country = EXCLUDED.country, gi_type = EXCLUDED.gi_type";
  const withId: unknown[][] = [];
  const withoutId: unknown[][] = [];
  for (const r of allRows) {
    const row = [r.name, norm(r.name), r.country, r.gi_type, r.source, r.source_ref];
    const id = pinned[`${r.source}|${r.source_ref}`];
    if (id) withId.push([id, ...row]); else withoutId.push(row);
  }
  let appOut = await insertMany(pool, "wine.appellations", ["id", ...appCols], withId, onConflict);
  await pool.query(`SELECT setval('wine.appellations_id_seq', (SELECT max(id) FROM wine.appellations))`);
  appOut += await insertMany(pool, "wine.appellations", appCols, withoutId, onConflict);
  notes.rows_without_pinned_id = withoutId.length;
  const liveRefs = allRows.map((r) => `${r.source}|${r.source_ref}`);
  const stale = `SELECT id FROM wine.appellations WHERE source = ANY($1::text[]) AND NOT (source || '|' || source_ref = ANY($2::text[]))`;
  await pool.query(`UPDATE wine.wines SET appellation_id = NULL, appellation_match = NULL WHERE appellation_id IN (${stale})`, [SOURCES, liveRefs]);
  await pool.query(`UPDATE wine.appellations SET parent_id = NULL WHERE parent_id IN (${stale})`, [SOURCES, liveRefs]);
  const dropped = await pool.query(`DELETE FROM wine.appellations WHERE id IN (${stale})`, [SOURCES, liveRefs]);
  notes.stale_rows_removed = dropped.rowCount ?? 0;
  // This loader's own names are rebuilt below; the resolver's kind='lwin' rows stay.
  await pool.query(`DELETE FROM wine.appellation_names WHERE source = ANY($1::text[])`, [SOURCES]);

  const { rows: back } = await pool.query(
    `SELECT id, source, source_ref FROM wine.appellations WHERE source = ANY($1::text[])`,
    [SOURCES],
  );
  const idByRef = new Map<string, number>(back.map((r: any) => [`${r.source}|${r.source_ref}`, r.id]));

  // ---- parent_id ------------------------------------------------------
  const parentPairs: Array<[number, number]> = [];
  for (const r of allRows) {
    if (!r.parentRef) continue;
    const childId = idByRef.get(`${r.source}|${r.source_ref}`);
    const parentId = idByRef.get(`${r.source}|${r.parentRef}`);
    if (childId && parentId) parentPairs.push([childId, parentId]);
  }
  for (let i = 0; i < parentPairs.length; i += 1000) {
    const slice = parentPairs.slice(i, i + 1000);
    const params: unknown[] = [];
    const values = slice.map((p) => { params.push(p[0], p[1]); return `($${params.length - 1}::int,$${params.length}::int)`; }).join(",");
    await pool.query(`UPDATE wine.appellations a SET parent_id = v.parent FROM (VALUES ${values}) AS v(child, parent) WHERE a.id = v.child`, params);
  }
  notes.parent_id_rows = parentPairs.length;

  // ---- appellation_names ------------------------------------------------
  const seen = new Set<string>();
  const nameRows: unknown[][] = [];
  const pushName = (appId: number, raw: string, kind: string, source: string) => {
    const nn = norm(raw);
    if (!nn) return;
    const key = `${appId}|${nn}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    nameRows.push([appId, raw, nn, kind, source]);
  };
  for (const r of allRows) {
    const appId = idByRef.get(`${r.source}|${r.source_ref}`);
    if (!appId) continue;
    pushName(appId, r.name, "protected", r.source);
    for (const a of r.aliases) pushName(appId, a, "alias", r.source);
  }
  const nameOut = await insertMany(
    pool, "wine.appellation_names", ["appellation_id", "name", "name_norm", "kind", "source"],
    nameRows, "ON CONFLICT DO NOTHING",
  );

  notes.appellations_out = appOut;
  notes.names_out = nameOut;
  notes.us_avas = us.length;
  notes.au_gis = au.length;
  notes.nz_rows = nz.rows.length;
  notes.za_rows = za.rows.length;
  notes.cl_rows = cl.rows.length;
  notes.ar_rows = ar.rows.length;

  console.log(`appellations=${appOut} names=${nameOut}`, notes.rows_by_source);

  await logLoad(pool, "load-gi-lists", {
    rows_in: allRows.length,
    rows_out: appOut + nameOut,
    matched: appOut,
    unmatched: 0,
  }, notes);

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
