#!/usr/bin/env npx tsx
/**
 * Seed `enrich.label_editorial` from packages/db/seeds/label_editorial_v2.csv
 * (and the legacy tier1 CSV as a fallback for labels that haven't been
 * upgraded to v2 yet).
 *
 * Resolves each `name` to a `discogs_label_id` via case-insensitive trim
 * match against `catalog.labels`. Falls back to a fuzzy `pg_trgm` similarity
 * lookup at threshold ≥ 0.85 when the exact match misses. Logs unresolved
 * names to stderr (these are usually labels not in scope).
 *
 * Idempotent: UPSERT on `(discogs_label_id)`.
 *
 * Usage:
 *   DATABASE_URL=<pg_url> npx tsx scripts/seed-label-editorial.ts
 *
 * Local (via Docker):
 *   DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
 *     npx tsx scripts/seed-label-editorial.ts
 *
 * Fly (against dig-db-scene via proxy):
 *   fly proxy 15433:5432 -a dig-db-scene &
 *   DATABASE_URL=postgresql://postgres:<pass>@localhost:15433/dig \
 *     npx tsx scripts/seed-label-editorial.ts
 */

import { createReadStream, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database } from "../packages/db/src/schema.js";

const REPO_ROOT = resolve(__dirname, "..");
const V2_CSV = resolve(REPO_ROOT, "packages/db/seeds/label_editorial_v2.csv");
const TIER1_CSV = resolve(REPO_ROOT, "packages/db/seeds/label_editorial_tier1.csv");

interface SeedRowV2 {
  name: string;
  tier: "tier1" | "denylist";
  accent: string | null;
  accent_ink: string | null;
  founded_year: number | null;
  closed_year: number | null;
  is_active: boolean;
  location: string | null;
  blurb: string | null;
  notes: string | null;
}

/** Minimal RFC-4180-ish CSV parser. Handles quoted fields with embedded commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else if (c === "\r") {
        // skip — \n will close the row
      } else {
        cell += c;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function loadV2(): SeedRowV2[] {
  const text = readFileSync(V2_CSV, "utf8");
  const [header, ...rows] = parseCsv(text);
  const idx = (col: string) => header.indexOf(col);
  const cName = idx("name");
  const cTier = idx("tier");
  const cAccent = idx("accent");
  const cAccentInk = idx("accent_ink");
  const cFounded = idx("founded_year");
  const cClosed = idx("closed_year");
  const cActive = idx("is_active");
  const cLocation = idx("location");
  const cBlurb = idx("blurb");
  return rows.map((r) => ({
    name: r[cName].trim(),
    tier: (r[cTier].trim() as "tier1" | "denylist"),
    accent: r[cAccent]?.trim() || null,
    accent_ink: r[cAccentInk]?.trim() || null,
    founded_year: r[cFounded]?.trim() ? parseInt(r[cFounded].trim(), 10) : null,
    closed_year: r[cClosed]?.trim() ? parseInt(r[cClosed].trim(), 10) : null,
    is_active: r[cActive]?.trim().toLowerCase() === "true",
    location: r[cLocation]?.trim() || null,
    blurb: r[cBlurb]?.trim() || null,
    notes: null,
  }));
}

function loadTier1Legacy(seenNames: Set<string>): SeedRowV2[] {
  const text = readFileSync(TIER1_CSV, "utf8");
  const [header, ...rows] = parseCsv(text);
  const cName = header.indexOf("name");
  const cTier = header.indexOf("tier");
  const cNotes = header.indexOf("notes");
  return rows
    .filter((r) => !seenNames.has(r[cName].trim().toLowerCase()))
    .map((r) => ({
      name: r[cName].trim(),
      tier: (r[cTier].trim() as "tier1" | "denylist"),
      accent: null,
      accent_ink: null,
      founded_year: null,
      closed_year: null,
      is_active: true,
      location: null,
      blurb: null,
      notes: r[cNotes]?.trim() || null,
    }));
}

async function resolveDiscogsId(
  db: Kysely<Database>,
  name: string,
): Promise<{ discogs_id: number; resolved_name: string; method: "exact" | "fuzzy" } | null> {
  const exact = await sql<{ discogs_id: number; name: string }>`
    SELECT discogs_id, name
    FROM catalog.labels
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(${name}))
    ORDER BY discogs_id ASC
    LIMIT 1
  `.execute(db);
  if (exact.rows.length > 0) {
    return { discogs_id: exact.rows[0].discogs_id, resolved_name: exact.rows[0].name, method: "exact" };
  }

  // Fuzzy fallback via pg_trgm — only accept high-confidence matches
  const fuzzy = await sql<{ discogs_id: number; name: string; sim: number }>`
    SELECT discogs_id, name, similarity(name, ${name}) AS sim
    FROM catalog.labels
    WHERE name % ${name}
    ORDER BY sim DESC, discogs_id ASC
    LIMIT 1
  `.execute(db).catch(() => ({ rows: [] }));
  if (fuzzy.rows.length > 0 && fuzzy.rows[0].sim >= 0.85) {
    return { discogs_id: fuzzy.rows[0].discogs_id, resolved_name: fuzzy.rows[0].name, method: "fuzzy" };
  }
  return null;
}

async function upsert(db: Kysely<Database>, row: SeedRowV2, discogsLabelId: number): Promise<void> {
  const palette = row.accent && row.accent_ink
    ? JSON.stringify({ accent: row.accent, accent_ink: row.accent_ink })
    : null;
  await sql`
    INSERT INTO enrich.label_editorial (
      discogs_label_id, tier, notes, palette, blurb,
      founded_year, closed_year, is_active, location,
      source, updated_at
    ) VALUES (
      ${discogsLabelId}, ${row.tier}, ${row.notes}, ${palette}::jsonb, ${row.blurb},
      ${row.founded_year}, ${row.closed_year}, ${row.is_active}, ${row.location},
      'seed:label_editorial_v2.csv', now()
    )
    ON CONFLICT (discogs_label_id) DO UPDATE SET
      tier         = EXCLUDED.tier,
      notes        = COALESCE(EXCLUDED.notes, enrich.label_editorial.notes),
      palette      = COALESCE(EXCLUDED.palette, enrich.label_editorial.palette),
      blurb        = COALESCE(EXCLUDED.blurb, enrich.label_editorial.blurb),
      founded_year = COALESCE(EXCLUDED.founded_year, enrich.label_editorial.founded_year),
      closed_year  = COALESCE(EXCLUDED.closed_year, enrich.label_editorial.closed_year),
      is_active    = EXCLUDED.is_active,
      location     = COALESCE(EXCLUDED.location, enrich.label_editorial.location),
      source       = EXCLUDED.source,
      updated_at   = now()
  `.execute(db);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  try {
    const v2Rows = loadV2();
    const seenNames = new Set(v2Rows.map((r) => r.name.toLowerCase()));
    const legacyRows = loadTier1Legacy(seenNames);
    const allRows = [...v2Rows, ...legacyRows];
    console.log(`Loaded ${v2Rows.length} v2 rows + ${legacyRows.length} legacy tier1-only rows = ${allRows.length} total.`);

    let resolved = 0;
    let unresolved = 0;
    let upserted = 0;
    let palettesApplied = 0;
    let blurbsApplied = 0;
    const unresolvedNames: string[] = [];
    const fuzzyMatches: Array<{ requested: string; matched: string }> = [];

    for (const row of allRows) {
      const lookup = await resolveDiscogsId(db, row.name);
      if (!lookup) {
        unresolved++;
        unresolvedNames.push(row.name);
        continue;
      }
      resolved++;
      if (lookup.method === "fuzzy") {
        fuzzyMatches.push({ requested: row.name, matched: lookup.resolved_name });
      }
      await upsert(db, row, lookup.discogs_id);
      upserted++;
      if (row.accent) palettesApplied++;
      if (row.blurb) blurbsApplied++;
    }

    console.log("");
    console.log("=== seed-label-editorial summary ===");
    console.log(`  resolved:   ${resolved}/${allRows.length}`);
    console.log(`  upserted:   ${upserted}`);
    console.log(`  palettes:   ${palettesApplied}`);
    console.log(`  blurbs:     ${blurbsApplied}`);
    console.log(`  unresolved: ${unresolved}`);

    if (fuzzyMatches.length > 0) {
      console.log("");
      console.log(`  fuzzy matches (${fuzzyMatches.length}):`);
      for (const fm of fuzzyMatches) {
        console.log(`    ${fm.requested}  →  ${fm.matched}`);
      }
    }

    if (unresolvedNames.length > 0) {
      console.error("");
      console.error(`Unresolved labels (likely not in scope):`);
      for (const n of unresolvedNames) {
        console.error(`  - ${n}`);
      }
    }
  } finally {
    // Kysely owns the pg pool through PostgresDialect — destroying the Kysely
    // instance closes it. Calling pool.end() afterwards throws "end called more
    // than once". Just destroy the Kysely.
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
