#!/usr/bin/env npx tsx
/**
 * Seed `enrich.label_core_run` (auto) and `enrich.label_related` (hand) for
 * the label essentials block on label pages.
 *
 * Auto core_run:
 *   For every label with at least one master in catalog.masters, pick the top
 *   N (default 8) masters ranked by:
 *     1. catalog.masters.scene_weight DESC  (the existing canonical score)
 *     2. year ASC                            (chronological tiebreak — older
 *                                             releases generally define a
 *                                             label's identity more)
 *     3. discogs_id ASC                      (final stable tiebreak)
 *   Inserted with source='auto'. A subsequent curated pass that inserts with
 *   source='curated' takes precedence — the API returns curated first.
 *
 *   Throttled to scene-member labels + tier-1 by default (`--all` overrides).
 *
 * Hand-seeded label_related:
 *   Loaded from packages/db/seeds/label_related_v1.json, name-resolved against
 *   catalog.labels using the same master-count tiebreak as seed-scenes.ts.
 *
 * Idempotent. UPSERT on PKs. Auto core_run runs are non-destructive of any
 * existing curated entries (they are skipped via WHERE source = 'auto').
 *
 * Usage:
 *   DATABASE_URL=<pg_url> npx tsx scripts/seed-label-essentials.ts
 *   DATABASE_URL=<pg_url> npx tsx scripts/seed-label-essentials.ts --all
 *   DATABASE_URL=<pg_url> npx tsx scripts/seed-label-essentials.ts --per-label 10
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";
import type { Database, LabelRelatedDirection } from "../packages/db/src/schema.js";

const REPO_ROOT = resolve(__dirname, "..");
const RELATED_SEED = resolve(REPO_ROOT, "packages/db/seeds/label_related_v1.json");

const DEFAULT_PER_LABEL = 8;

const VALID_DIRECTIONS: LabelRelatedDirection[] = [
  "deeper",
  "harder",
  "rawer",
  "cleaner",
  "weirder",
  "poppier",
  "earlier",
  "later",
];

interface RelatedEdgeSeed {
  from: string;
  to: string;
  direction: LabelRelatedDirection;
  blurb?: string | null;
  rank?: number;
}

interface RelatedSeedFile {
  edges: RelatedEdgeSeed[];
}

function parseArgs(argv: string[]): { all: boolean; perLabel: number } {
  const opts = { all: false, perLabel: DEFAULT_PER_LABEL };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") opts.all = true;
    else if (a === "--per-label") {
      const v = parseInt(argv[++i] ?? "", 10);
      if (Number.isFinite(v) && v >= 1 && v <= 25) opts.perLabel = v;
    }
  }
  return opts;
}

async function resolveLabelByName(
  db: Kysely<Database>,
  name: string,
): Promise<number | null> {
  // Same name-resolution semantics as seed-scenes.ts: prefer the entity that
  // actually carries masters when there are siblings sharing a name.
  const r = await sql<{ discogs_id: number }>`
    SELECT l.discogs_id
    FROM catalog.labels l
    WHERE LOWER(TRIM(l.name)) = LOWER(TRIM(${name}))
    ORDER BY (
      SELECT COUNT(*) FROM catalog.masters m WHERE m.primary_label_discogs_id = l.discogs_id
    ) DESC,
    l.discogs_id ASC
    LIMIT 1
  `.execute(db);
  return r.rows.length > 0 ? r.rows[0].discogs_id : null;
}

async function pickLabelsForCoreRun(
  db: Kysely<Database>,
  all: boolean,
): Promise<number[]> {
  if (all) {
    const r = await sql<{ discogs_id: number }>`
      SELECT DISTINCT primary_label_discogs_id AS discogs_id
      FROM catalog.masters
      WHERE primary_label_discogs_id IS NOT NULL
    `.execute(db);
    return r.rows.map((x) => x.discogs_id);
  }
  // Default: scene members + editorial tier-1 — these are the labels that
  // actually have a label page worth surfacing right now.
  const r = await sql<{ discogs_id: number }>`
    SELECT DISTINCT discogs_id FROM (
      SELECT discogs_label_id AS discogs_id FROM enrich.scene_labels
      UNION
      SELECT discogs_label_id AS discogs_id FROM enrich.label_editorial WHERE tier = 'tier1'
    ) s
  `.execute(db);
  return r.rows.map((x) => x.discogs_id);
}

async function seedCoreRunForLabel(
  db: Kysely<Database>,
  labelId: number,
  perLabel: number,
): Promise<{ inserted: number; skipped: number }> {
  // First, clear any prior auto entries — we want this to re-rank cleanly when
  // the underlying scene_weight changes. Curated entries are preserved.
  await sql`
    DELETE FROM enrich.label_core_run
    WHERE discogs_label_id = ${labelId} AND source = 'auto'
  `.execute(db);

  const candidates = await sql<{ discogs_id: string }>`
    SELECT m.discogs_id::text AS discogs_id
    FROM catalog.masters m
    WHERE m.primary_label_discogs_id = ${labelId}
    ORDER BY
      COALESCE(m.scene_weight, 0) DESC,
      COALESCE(m.year, 9999) ASC,
      m.discogs_id ASC
    LIMIT ${perLabel}
  `.execute(db);

  if (candidates.rows.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  // Skip masters that already have a curated entry for this label (don't
  // double-rank).
  const curated = await sql<{ master_discogs_id: string }>`
    SELECT master_discogs_id::text AS master_discogs_id
    FROM enrich.label_core_run
    WHERE discogs_label_id = ${labelId} AND source = 'curated'
  `.execute(db);
  const curatedSet = new Set(curated.rows.map((r) => r.master_discogs_id));

  let rank = 1;
  let inserted = 0;
  let skipped = 0;
  for (const row of candidates.rows) {
    if (curatedSet.has(row.discogs_id)) {
      skipped++;
      continue;
    }
    await sql`
      INSERT INTO enrich.label_core_run
        (discogs_label_id, master_discogs_id, rank, source, updated_at)
      VALUES (
        ${labelId}, ${row.discogs_id}::bigint, ${rank}, 'auto', now()
      )
      ON CONFLICT (discogs_label_id, master_discogs_id) DO UPDATE SET
        rank       = EXCLUDED.rank,
        updated_at = now()
      WHERE enrich.label_core_run.source = 'auto'
    `.execute(db);
    inserted++;
    rank++;
  }
  return { inserted, skipped };
}

async function seedRelatedFromFile(db: Kysely<Database>): Promise<{
  inserted: number;
  unresolved: Array<{ from: string; to: string; direction: string }>;
}> {
  if (!existsSync(RELATED_SEED)) {
    return { inserted: 0, unresolved: [] };
  }
  const seed: RelatedSeedFile = JSON.parse(readFileSync(RELATED_SEED, "utf8"));

  // Re-seed cleanly each run.
  await sql`DELETE FROM enrich.label_related`.execute(db);

  let inserted = 0;
  const unresolved: Array<{ from: string; to: string; direction: string }> = [];

  for (const edge of seed.edges) {
    if (!VALID_DIRECTIONS.includes(edge.direction)) {
      console.warn(`  ! skipping edge with unknown direction: ${edge.direction}`);
      continue;
    }
    const fromId = await resolveLabelByName(db, edge.from);
    const toId = await resolveLabelByName(db, edge.to);
    if (!fromId || !toId || fromId === toId) {
      unresolved.push({ from: edge.from, to: edge.to, direction: edge.direction });
      continue;
    }
    await sql`
      INSERT INTO enrich.label_related
        (from_label_id, to_label_id, direction, rank, blurb)
      VALUES (
        ${fromId}, ${toId}, ${edge.direction},
        ${edge.rank ?? 0}, ${edge.blurb ?? null}
      )
      ON CONFLICT (from_label_id, to_label_id, direction) DO UPDATE SET
        rank  = EXCLUDED.rank,
        blurb = COALESCE(EXCLUDED.blurb, enrich.label_related.blurb)
    `.execute(db);
    inserted++;
  }
  return { inserted, unresolved };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }
  const opts = parseArgs(process.argv.slice(2));
  console.log(`seed-label-essentials: all=${opts.all} perLabel=${opts.perLabel}`);

  const pool = new pg.Pool({ connectionString: url, max: 4 });
  const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });

  try {
    const labels = await pickLabelsForCoreRun(db, opts.all);
    console.log(`  → ${labels.length} labels eligible for auto core_run`);

    let totalInserted = 0;
    let totalSkipped = 0;
    let labelsWithMasters = 0;
    let i = 0;
    for (const labelId of labels) {
      const { inserted, skipped } = await seedCoreRunForLabel(db, labelId, opts.perLabel);
      if (inserted > 0) labelsWithMasters++;
      totalInserted += inserted;
      totalSkipped += skipped;
      i++;
      if (i % 50 === 0) {
        console.log(`  ... ${i}/${labels.length} labels processed`);
      }
    }

    console.log("");
    console.log("=== core_run summary ===");
    console.log(`  labels processed:           ${labels.length}`);
    console.log(`  labels with auto entries:   ${labelsWithMasters}`);
    console.log(`  auto entries inserted:      ${totalInserted}`);
    console.log(`  curated entries preserved:  ${totalSkipped}`);

    const { inserted: relatedInserted, unresolved } = await seedRelatedFromFile(db);
    console.log("");
    console.log("=== label_related summary ===");
    console.log(`  edges inserted:   ${relatedInserted}`);
    console.log(`  edges unresolved: ${unresolved.length}`);
    if (unresolved.length > 0) {
      for (const u of unresolved.slice(0, 20)) {
        console.log(`    ! ${u.from}  --[${u.direction}]-->  ${u.to}`);
      }
      if (unresolved.length > 20) {
        console.log(`    ... and ${unresolved.length - 20} more`);
      }
    }
  } finally {
    // db.destroy() ends the pool internally; calling pool.end() after would
    // throw "Called end on pool more than once".
    await db.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
