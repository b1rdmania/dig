#!/usr/bin/env npx tsx
/**
 * Seed hand-curated entity image overrides from
 * packages/db/seeds/entity_image_overrides.csv into enrich.entity_images.
 *
 * Rows are written with source='manual' so they sort ahead of machine-
 * harvested Wikidata/MusicBrainz rows in getEntityImages().
 *
 * Use this whenever the automated harvesters come back empty for an entity
 * we actually care about. Most pre-2005 house/techno artists fall into that
 * bucket — their Wikidata entries (where they even exist) rarely have P18.
 *
 * CSV format (see the header row of the seed file):
 *   entity_type,discogs_id,image_kind,source_id,source_url,attribution,license,notes
 *
 * Idempotent: UPSERT on (entity_type, discogs_id, image_kind).
 *
 * Usage:
 *   DATABASE_URL=<pg_url> npx tsx scripts/seed-entity-image-overrides.ts
 *
 * Fly (against dig-db-scene via proxy):
 *   fly proxy 15433:5432 -a dig-db-scene &
 *   DATABASE_URL=postgresql://postgres:<pass>@localhost:15433/dig \
 *     npx tsx scripts/seed-entity-image-overrides.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database } from "../packages/db/src/schema.js";

const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_CSV = resolve(REPO_ROOT, "packages/db/seeds/entity_image_overrides.csv");

interface OverrideRow {
  entity_type: "label" | "artist";
  discogs_id: number;
  image_kind: "logo" | "photo" | "hero";
  source_id: string | null;
  source_url: string;
  attribution: string | null;
  license: string | null;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cell += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c === "\r") { /* skip */ }
      else { cell += c; }
    }
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function loadRows(csvPath: string): OverrideRow[] {
  const text = readFileSync(csvPath, "utf8");
  const all = parseCsv(text);
  // Skip comment rows (first cell starts with `#`) and find the header.
  const noComments = all.filter((r) => !r[0].trim().startsWith("#"));
  const [header, ...rest] = noComments;
  const idx = (col: string) => header.indexOf(col);
  const ix = {
    entity_type: idx("entity_type"),
    discogs_id: idx("discogs_id"),
    image_kind: idx("image_kind"),
    source_id: idx("source_id"),
    source_url: idx("source_url"),
    attribution: idx("attribution"),
    license: idx("license"),
  };
  for (const [k, v] of Object.entries(ix)) {
    if (v < 0) throw new Error(`CSV missing column '${k}' in ${csvPath}`);
  }

  const out: OverrideRow[] = [];
  for (const r of rest) {
    const id = parseInt(r[ix.discogs_id].trim(), 10);
    if (!Number.isFinite(id)) continue;
    const entity_type = r[ix.entity_type].trim() as "label" | "artist";
    const image_kind = r[ix.image_kind].trim() as "logo" | "photo" | "hero";
    const source_url = r[ix.source_url].trim();
    if (!source_url) continue;
    out.push({
      entity_type,
      discogs_id: id,
      image_kind,
      source_id: r[ix.source_id]?.trim() || null,
      source_url,
      attribution: r[ix.attribution]?.trim() || null,
      license: r[ix.license]?.trim() || null,
    });
  }
  return out;
}

async function upsert(db: Kysely<Database>, row: OverrideRow): Promise<void> {
  await sql`
    INSERT INTO enrich.entity_images
      (entity_type, discogs_id, image_kind, source, source_id, source_url, attribution, license)
    VALUES
      (${row.entity_type}, ${row.discogs_id}, ${row.image_kind}, 'manual',
       ${row.source_id}, ${row.source_url}, ${row.attribution}, ${row.license})
    ON CONFLICT (entity_type, discogs_id, image_kind) DO UPDATE SET
      source      = EXCLUDED.source,
      source_id   = EXCLUDED.source_id,
      source_url  = EXCLUDED.source_url,
      attribution = EXCLUDED.attribution,
      license     = EXCLUDED.license,
      updated_at  = now()
  `.execute(db);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL not set"); process.exit(2); }
  const csvArg = process.argv.find((a) => a.startsWith("--csv="));
  const csvPath = csvArg ? resolve(process.cwd(), csvArg.slice("--csv=".length)) : DEFAULT_CSV;

  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  try {
    const rows = loadRows(csvPath);
    console.log(`Loaded ${rows.length} override rows from ${csvPath}`);
    let done = 0;
    for (const r of rows) {
      await upsert(db, r);
      done++;
    }
    console.log(`Upserted ${done} rows into enrich.entity_images (source='manual').`);
  } finally {
    // db.destroy() already ends the underlying pg pool.
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
