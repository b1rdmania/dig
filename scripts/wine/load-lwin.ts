/**
 * load-lwin.ts - LWIN database -> wine.producers + wine.wines.
 *
 * LWIN is the spine: every wine row is a LWIN-7 and every producer is a
 * distinct (PRODUCER_TITLE, PRODUCER_NAME, COUNTRY) triple. Only TYPE in
 * ('Wine', 'Fortified Wine') is loaded; spirits, beer, cider and 'Other' are
 * skipped. Every STATUS is kept (Live | Combined | Deleted) - status records it.
 *
 * Idempotent: deletes wine.wines and wine.producers where source='lwin' first.
 * appellation_id is left NULL for resolve-appellations.ts.
 *
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
 *     pnpm exec tsx scripts/wine/load-lwin.ts
 */
import { resolve } from "node:path";
import { RAW, connect, countryCode, insertMany, intOrNull, logLoad, na, norm, readCsv, upsertSource } from "./lib";

const SRC = "lwin";
const KEEP_TYPES = new Set(["Wine", "Fortified Wine"]);

type Prod = {
  key: string;
  title: string | null;
  name: string;
  countryName: string | null;
  regions: Map<string, number>;
  liveCount: number;
};

type WineRow = {
  lwin: number;
  display_name: string;
  prodKey: string;
  wine_name: string | null;
  country: string | null;
  country_name: string | null;
  region: string | null;
  sub_region: string | null;
  site: string | null;
  parcel: string | null;
  colour: string | null;
  sub_type: string | null;
  wine_type: string;
  designation: string | null;
  classification: string | null;
  vintage_config: string | null;
  first_vintage: number | null;
  final_vintage: number | null;
  status: string;
};

async function main(): Promise<void> {
  const pool = connect();
  const path = resolve(RAW, "lwin", "lwin.csv");

  await upsertSource(pool, {
    slug: SRC,
    name: "LWIN (Liv-ex Wine Identification Number) database",
    licence: "CC BY 4.0",
    pulled_at: "2026-09-03",
    demo_only: false,
    notes: "LWINdatabase.xlsx converted by scripts/wine/lwin-to-csv.py; 212,311 rows.",
  });

  const producers = new Map<string, Prod>();
  const wines: WineRow[] = [];
  const skipped = new Map<string, number>();
  let rowsIn = 0;
  let badLwin = 0;

  for await (const r of readCsv(path)) {
    rowsIn++;
    const type = na(r.TYPE);
    if (!type || !KEEP_TYPES.has(type)) {
      skipped.set(type ?? "(blank)", (skipped.get(type ?? "(blank)") ?? 0) + 1);
      continue;
    }
    const lwin = intOrNull(r.LWIN);
    if (lwin === null) { badLwin++; continue; }

    const name = na(r.PRODUCER_NAME);
    if (!name) { badLwin++; continue; }
    const title = na(r.PRODUCER_TITLE);
    const countryName = na(r.COUNTRY);
    const key = `${title ?? ""}|${name}|${countryName ?? ""}`;

    let p = producers.get(key);
    if (!p) {
      p = { key, title, name, countryName, regions: new Map(), liveCount: 0 };
      producers.set(key, p);
    }
    const region = na(r.REGION);
    const status = na(r.STATUS) ?? "Live";
    if (region) p.regions.set(region, (p.regions.get(region) ?? 0) + 1);
    if (status === "Live") p.liveCount++;

    wines.push({
      lwin,
      display_name: na(r.DISPLAY_NAME) ?? [title, name, na(r.WINE)].filter(Boolean).join(" "),
      prodKey: key,
      wine_name: na(r.WINE),
      country: countryCode(countryName),
      country_name: countryName,
      region,
      sub_region: na(r.SUB_REGION),
      site: na(r.SITE),
      parcel: na(r.PARCEL),
      colour: na(r.COLOUR),
      sub_type: na(r.SUB_TYPE),
      wine_type: type,
      designation: na(r.DESIGNATION),
      classification: na(r.CLASSIFICATION),
      vintage_config: na(r.VINTAGE_CONFIG),
      first_vintage: intOrNull(r.FIRST_VINTAGE),
      final_vintage: intOrNull(r.FINAL_VINTAGE),
      status,
    });
  }

  console.log(`[lwin] read ${rowsIn} rows, kept ${wines.length}, ${producers.size} producers`);

  // Idempotent, but only as the FIRST loader: wine.listings and the link /
  // name / grape tables point at these rows, and listings' FKs do not cascade.
  // Reloading the spine under a loaded corpus would fail on a foreign key, so
  // say so instead, and require FORCE=1 to clear the downstream rows for a
  // full rebuild (after which loaders 2-4 must be re-run).
  const dep = await pool.query<{ listings: string; links: string; names: string; grapes: string }>(
    `SELECT (SELECT count(*) FROM wine.listings)::text listings,
            (SELECT count(*) FROM wine.producer_links)::text links,
            (SELECT count(*) FROM wine.wine_names)::text names,
            (SELECT count(*) FROM wine.wine_grapes)::text grapes`,
  );
  const d = dep.rows[0];
  const depTotal = Number(d.listings) + Number(d.links) + Number(d.names) + Number(d.grapes);
  if (depTotal > 0) {
    if (process.env.FORCE !== "1") {
      throw new Error(
        `wine.wines / wine.producers have dependent rows (listings=${d.listings} producer_links=${d.links} ` +
        `wine_names=${d.names} wine_grapes=${d.grapes}). load-lwin rebuilds the spine, so those rows must go ` +
        `first. Re-run with FORCE=1 to clear them, then re-run load-producer-links, load-systembolaget and ` +
        `load-wikidata-wines.`,
      );
    }
    console.warn(`[lwin] FORCE=1: clearing ${depTotal} dependent rows (loaders 2-4 must be re-run)`);
    await pool.query(`DELETE FROM wine.wine_grapes`);
    await pool.query(`DELETE FROM wine.wine_names`);
    await pool.query(`DELETE FROM wine.listings`);
    await pool.query(`DELETE FROM wine.producer_links`);
  }
  await pool.query(`DELETE FROM wine.wines WHERE source = $1`, [SRC]);
  await pool.query(`DELETE FROM wine.producers WHERE source = $1`, [SRC]);

  const prodRows = [...producers.values()].map((p) => {
    let region: string | null = null;
    let best = -1;
    for (const [k, v] of p.regions) if (v > best) { best = v; region = k; }
    return [
      p.name,
      p.title,
      p.title ? `${p.title} ${p.name}` : p.name,
      norm(p.name),
      countryCode(p.countryName),
      p.countryName,
      region,
      p.liveCount,
      SRC,
      p.key,
    ];
  });

  const prodOut = await insertMany(
    pool,
    "wine.producers",
    ["name", "title", "display_name", "name_norm", "country", "country_name", "region", "wine_count", "source", "source_ref"],
    prodRows,
    "ON CONFLICT (source, source_ref) DO NOTHING",
  );

  const ids = await pool.query<{ source_ref: string; id: number }>(
    `SELECT source_ref, id FROM wine.producers WHERE source = $1`,
    [SRC],
  );
  const idByKey = new Map(ids.rows.map((r) => [r.source_ref, r.id]));

  const wineRows = wines.map((w) => [
    w.lwin, w.display_name, idByKey.get(w.prodKey) ?? null, w.wine_name, w.country, w.country_name,
    w.region, w.sub_region, w.site, w.parcel, w.colour, w.sub_type, w.wine_type, w.designation,
    w.classification, w.vintage_config, w.first_vintage, w.final_vintage, w.status, SRC,
  ]);

  const wineOut = await insertMany(
    pool,
    "wine.wines",
    ["lwin", "display_name", "producer_id", "wine_name", "country", "country_name", "region", "sub_region",
      "site", "parcel", "colour", "sub_type", "wine_type", "designation", "classification", "vintage_config",
      "first_vintage", "final_vintage", "status", "source"],
    wineRows,
    "ON CONFLICT (lwin) DO NOTHING",
  );

  const noCountry = await pool.query<{ n: string }>(
    `SELECT count(*)::text n FROM wine.producers WHERE source=$1 AND country IS NULL AND country_name IS NOT NULL`,
    [SRC],
  );

  await logLoad(pool, "load-lwin", {
    rows_in: rowsIn,
    rows_out: wineOut,
    matched: prodOut,
    unmatched: wines.length - wineOut,
  }, {
    producers: prodOut,
    distinct_producers: producers.size,
    wine_rows: wines.length,
    skipped_by_type: Object.fromEntries(skipped),
    dropped_bad_lwin_or_no_producer: badLwin,
    producers_country_unmapped: Number(noCountry.rows[0].n),
  });

  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
