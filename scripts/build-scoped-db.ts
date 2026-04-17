/**
 * Build the scoped, denormed, master-first slim catalog from the live
 * full Discogs DB into a portable SQL dump.
 *
 * State is held in PERSISTENT tables in the `scope_workspace` schema on
 * SOURCE so that proxy/connection drops never lose work. Each phase checks
 * whether its output table already exists and skips if so. Use --reset to
 * force a clean rebuild, or --from-phase N to start from a specific phase.
 *
 *   1. Resolves the current live batch on SOURCE.
 *   2. Builds the in-scope id sets in scope_workspace.* tables on SOURCE
 *      (style allowlist + year window + quality filter + breakbeat year gate).
 *   3. Computes scene_weight per master.
 *      - With --histogram: prints distribution + 20 sample masters per
 *        weight bucket and exits. NO dump produced.
 *      - With --scene-weight-min N: prunes masters below N from the scope
 *        and rebuilds downstream closures.
 *   4. Computes denormed columns for catalog.masters (primary_artist_*,
 *      primary_label_*, primary_country, primary_format, artists_credit_text,
 *      genres TEXT[], styles TEXT[], scene_weight) into a temp table.
 *   5. Builds the Frankenstein catalog.master_tracks rows.
 *   6. Builds the catalog.master_videos_unified rows (master + release videos).
 *   7. Computes aliases_text per artist into a temp table.
 *   8. Writes a single SQL file containing:
 *        - INSERT INTO ingest.dump_batches  (the batch row)
 *        - INSERT INTO catalog.* (slim shape, with denormed columns inline)
 *        - INSERT INTO catalog.master_tracks (derived)
 *        - INSERT INTO catalog.master_videos_unified (derived)
 *        - INSERT INTO catalog.release_shadow (derived)
 *        - INSERT INTO enrich.* (subset)
 *        - INSERT INTO enrich.scene_scope_audit (provenance row)
 *      Restorable via `psql -d dig < scoped-build.sql` against a freshly
 *      migrated DB (must include migrations 025 + 026).
 *   9. Optionally pipes the dump straight into a TARGET DSN if --target is set.
 *
 * Run order (per docs/scoped-catalog-90s-house-techno.md §"Cutover Sequence"):
 *
 *   1. Provision dig-db-scene in lhr (Fly Postgres, small).
 *   2. Apply Kysely migrations 001-026 on dig-db-scene.
 *   3. Histogram pass on dig-db:
 *        SOURCE_DATABASE_URL=postgres://... \
 *          pnpm exec tsx scripts/build-scoped-db.ts \
 *            --histogram --quality-active-only
 *   4. Pick a threshold from the histogram output.
 *   5. Real build (run on a Fly machine to avoid laptop sleep):
 *        SOURCE_DATABASE_URL=postgres://... TARGET_DATABASE_URL=postgres://... \
 *          pnpm exec tsx scripts/build-scoped-db.ts \
 *            --year-min 1985 --year-max 2003 --quality-active-only \
 *            --scene-weight-min N \
 *            --output /tmp/dig-scene.sql --target
 *   6. Run scripts/seed-label-editorial.ts on dig-db-scene.
 *
 * SOURCE access requires READ. TARGET access requires WRITE.
 *
 * IMPORTANT: this is NOT a pg_dump replacement. It only writes the slim
 * subset of tables Dig actually needs at runtime. It does NOT carry over:
 * raw_entities, auth.* (already retired), enrich rows for out-of-scope
 * entities, catalog.releases family (replaced by release_shadow), tracks
 * (replaced by master_tracks), master_videos (folded into the unified table),
 * artist_aliases / name_variations / members / groups (denormed or dropped).
 */

import { createDb, sql, type Kysely, type Database } from "@dig/db";
import { spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { WriteStream } from "node:fs";

interface Args {
  yearMin: number;
  yearMax: number;
  styles: string[];
  qualityActiveOnly: boolean;
  breakbeatYearGate: number;
  output: string;
  target: boolean;
  batchIdOverride: string | null;
  dryRun: boolean;
  histogram: boolean;
  sceneWeightMin: number;
  reset: boolean;
  fromPhase: number;
}

// All persistent scope tables live here. Resilient to connection drops.
const WS = "scope_workspace";

const DEFAULT_STYLES = [
  // Core house + techno
  "Acid House", "Acid Techno", "Chicago House", "Deep House", "Detroit Techno",
  "Dub Techno", "Garage House", "Hard House", "House", "Minimal",
  "Minimal Techno", "Progressive House", "Tech House", "Techno", "Tribal House",
  // Locked edge styles
  "Electro",
  "IDM", "Experimental", "Abstract",
  "Ambient", "Drone", "Dub",
  "Breakbeat", "Hardcore",
  "Italo-Disco",
  "Trance", "Goa Trance",
  "Electroclash", "Leftfield", "Balearic",
];

// Slim TABLE_GROUPS: only what dig-db-scene reads at runtime. Each entry maps
// to an explicit column list — we avoid the introspection-based getColumns
// because the destination shape (with denormed columns) intentionally diverges
// from the source shape.
//
// catalog.masters / catalog.artists / catalog.labels are dumped via a custom
// path that joins in the denormed columns; they're not in this list.
const KEPT_TABLES = [
  "catalog.master_artists",
  "catalog.artist_urls",
  "catalog.label_urls",
  "enrich.entity_quality",
  "enrich.label_linkouts",
] as const;

function help(): never {
  console.log(`
build-scoped-db: extract scoped, denormed, slim catalog into a portable SQL dump.

Required env:
  SOURCE_DATABASE_URL   live full DB (read-only access fine)
  TARGET_DATABASE_URL   destination scoped DB (only used when --target is set)

Options:
  --year-min <n>            Default: 1985
  --year-max <n>            Default: 2003
  --style <name>            Repeatable. Defaults to scene canon (see source).
  --no-default-styles       Don't include default style allowlist; only --style values.
  --quality-active-only     Filter to enrich.entity_quality.quality_status='active'.
  --breakbeat-year-gate <n> Drop masters seeded only via Breakbeat/Hardcore with year > n.
                            Default: 1994. Set to 9999 to disable.
  --batch-id <uuid>         Override SOURCE batch id discovery.
  --output <path>           Where to write the SQL file. Default: ./scoped-build.sql
  --target                  Also pipe the dump into TARGET_DATABASE_URL via psql.
  --histogram               Build scope, compute scene_weight, print distribution
                            + 20 sample masters per bucket. NO dump.
  --scene-weight-min <n>    Drop masters with scene_weight < n. Default: 0 (no cut).
  --dry-run                 Build scope tables and print counts; don't write any SQL.
  --reset                   Drop all scope_workspace.* tables before phase 1.
  --from-phase <n>          Start from phase N (1=scope, 2=weight, 3=closures, 4=denorm,
                            5=dump). Each phase reuses any existing scope_workspace.*
                            tables. Default: 1.
  --help                    Show this help.
`);
  process.exit(0);
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let yearMin = 1985;
  let yearMax = 2003;
  let useDefaultStyles = true;
  const styles: string[] = [];
  let qualityActiveOnly = false;
  let breakbeatYearGate = 1994;
  let output = "./scoped-build.sql";
  let target = false;
  let batchIdOverride: string | null = null;
  let dryRun = false;
  let histogram = false;
  let sceneWeightMin = 0;
  let reset = false;
  let fromPhase = 1;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help") help();
    if (a === "--year-min" && args[i + 1]) { yearMin = parseInt(args[++i], 10); continue; }
    if (a === "--year-max" && args[i + 1]) { yearMax = parseInt(args[++i], 10); continue; }
    if (a === "--style" && args[i + 1])    { styles.push(args[++i]); continue; }
    if (a === "--no-default-styles")       { useDefaultStyles = false; continue; }
    if (a === "--quality-active-only")     { qualityActiveOnly = true; continue; }
    if (a === "--breakbeat-year-gate" && args[i + 1]) { breakbeatYearGate = parseInt(args[++i], 10); continue; }
    if (a === "--batch-id" && args[i + 1]) { batchIdOverride = args[++i]; continue; }
    if (a === "--output" && args[i + 1])   { output = args[++i]; continue; }
    if (a === "--target")                  { target = true; continue; }
    if (a === "--histogram")               { histogram = true; continue; }
    if (a === "--scene-weight-min" && args[i + 1]) { sceneWeightMin = parseInt(args[++i], 10); continue; }
    if (a === "--dry-run")                 { dryRun = true; continue; }
    if (a === "--reset")                   { reset = true; continue; }
    if (a === "--from-phase" && args[i + 1]) { fromPhase = parseInt(args[++i], 10); continue; }
    console.error(`Unknown arg: ${a}`);
    help();
  }

  const finalStyles = styles.length > 0
    ? (useDefaultStyles ? [...new Set([...DEFAULT_STYLES, ...styles])] : styles)
    : DEFAULT_STYLES;

  if (yearMin > yearMax) {
    console.error("year-min must be <= year-max");
    process.exit(1);
  }

  return {
    yearMin, yearMax, styles: finalStyles, qualityActiveOnly,
    breakbeatYearGate, output, target, batchIdOverride, dryRun,
    histogram, sceneWeightMin, reset, fromPhase,
  };
}

// ---------------------------------------------------------------------------
// Workspace helpers — persistent scope tables for resumability
// ---------------------------------------------------------------------------
const SCOPE_TABLES = [
  "scope_seeded_via_breakbeat_only",
  "scope_mr", "scope_seed_rel", "scope_m", "scope_r",
  "scope_a", "scope_l",
  "scope_m_weight", "scope_m_canonical_release", "scope_m_denorm",
] as const;

async function ensureWorkspace(c: Kysely<Database>) {
  await sql.raw(`CREATE SCHEMA IF NOT EXISTS ${WS}`).execute(c);
}

async function dropAllScopeTables(c: Kysely<Database>) {
  console.log(`[build-scope] --reset: dropping all ${WS}.* tables`);
  for (const t of SCOPE_TABLES) {
    await sql.raw(`DROP TABLE IF EXISTS ${WS}.${t}`).execute(c);
  }
}

async function tableExists(c: Kysely<Database>, schema: string, name: string): Promise<boolean> {
  const r = await sql<{ exists_: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = ${schema} AND tablename = ${name}
    ) AS exists_
  `.execute(c);
  return r.rows[0]?.exists_ ?? false;
}

async function tableRowCount(c: Kysely<Database>, schema: string, name: string): Promise<number> {
  const r = await sql<{ n: number }>`
    SELECT COUNT(*)::int AS n FROM ${sql.raw(`${schema}.${name}`)}
  `.execute(c);
  return r.rows[0]?.n ?? 0;
}

async function resolveBatchId(db: Kysely<Database>, override: string | null): Promise<string> {
  if (override) return override;
  const rows = await sql<{ id: string }>`
    SELECT id::text
    FROM ingest.dump_batches
    WHERE status IN ('active', 'qa')
    ORDER BY created_at DESC
  `.execute(db);
  for (const row of rows.rows) {
    const probe = await sql<{ exists_: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM catalog.releases
        WHERE batch_id = ${row.id}::uuid
        LIMIT 1
      ) AS exists_
    `.execute(db);
    if (probe.rows[0]?.exists_) return row.id;
  }
  throw new Error("Could not resolve a live batch id with rows in catalog.releases");
}

// ---------------------------------------------------------------------------
// Phase 1: build raw scope (releases → masters → quality + breakbeat gates)
// ---------------------------------------------------------------------------
async function buildScopeOnSource(c: Kysely<Database>, batchId: string, args: Args) {
  await ensureWorkspace(c);
  // search_path: unqualified scope_X => scope_workspace.scope_X.
  // catalog.* and enrich.* remain explicitly schema-qualified throughout.
  await sql.raw(`SET search_path TO ${WS}, public`).execute(c);
  await sql`SET statement_timeout = '120min'`.execute(c);
  await sql`SET work_mem = '256MB'`.execute(c);

  // ---- scope_mr: per-style release seed (the slow part) -----------------
  // Per-style insert uses idx_release_styles_style. We deliberately do NOT
  // use SELECT DISTINCT — uq_release_styles already guarantees one row per
  // (batch_id, style, release); DISTINCT was forcing heap fetches.
  //
  // We also do NOT use RETURNING — for the broadest styles ('House', 'Techno',
  // 'Trance') the inserted set is millions of rows, and shipping them back
  // over the wire just to count them stalls the script for >10 minutes per
  // style. numAffectedRows from the CommandTag gives us the same number for
  // free.
  if (await tableExists(c, WS, "scope_mr")) {
    const n = await tableRowCount(c, WS, "scope_mr");
    console.log(`  [scope] reusing existing ${WS}.scope_mr (${n.toLocaleString()} rows)`);
  } else {
    await sql`CREATE TABLE scope_mr (release_discogs_id integer PRIMARY KEY)`.execute(c);
    for (const style of args.styles) {
      const t0 = Date.now();
      const result = await sql`
        INSERT INTO scope_mr (release_discogs_id)
        SELECT release_discogs_id
        FROM catalog.release_styles
        WHERE batch_id = ${batchId}::uuid AND style = ${style}
        ON CONFLICT DO NOTHING
      `.execute(c);
      const ms = Date.now() - t0;
      const inserted = Number(result.numAffectedRows ?? 0n);
      console.log(`  [scope] seeded style="${style}" added=${inserted} in ${ms}ms`);
    }
    await sql`ANALYZE scope_mr`.execute(c);
  }

  // ---- scope_seed_rel: year-window-filtered seed releases ---------------
  if (await tableExists(c, WS, "scope_seed_rel")) {
    const n = await tableRowCount(c, WS, "scope_seed_rel");
    console.log(`  [scope] reusing existing ${WS}.scope_seed_rel (${n.toLocaleString()} rows)`);
  } else {
    console.log(`  [scope] building scope_seed_rel...`);
    const t0 = Date.now();
    await sql`
      CREATE TABLE scope_seed_rel AS
      SELECT DISTINCT r.discogs_id
      FROM scope_mr mr
      JOIN catalog.releases r
        ON r.discogs_id = mr.release_discogs_id
        AND r.batch_id = ${batchId}::uuid
      LEFT JOIN catalog.masters m
        ON m.discogs_id = r.master_discogs_id
        AND m.batch_id = ${batchId}::uuid
      WHERE COALESCE(r.release_year, m.year) BETWEEN ${args.yearMin} AND ${args.yearMax}
    `.execute(c);
    await sql`CREATE UNIQUE INDEX ON scope_seed_rel (discogs_id)`.execute(c);
    await sql`ANALYZE scope_seed_rel`.execute(c);
    console.log(`  [scope] scope_seed_rel built in ${Date.now() - t0}ms`);
  }

  // ---- scope_m: candidate masters from seed releases --------------------
  if (await tableExists(c, WS, "scope_m")) {
    const n = await tableRowCount(c, WS, "scope_m");
    console.log(`  [scope] reusing existing ${WS}.scope_m (${n.toLocaleString()} rows)`);
  } else {
    console.log(`  [scope] building scope_m + quality + breakbeat gates...`);
    const t0 = Date.now();
    // Drive from scope_seed_rel (small, ~1M rows) and PK-seek catalog.releases.
    // The previous IN-clause shape was forcing a full scan of catalog.releases
    // (555M rows / hours of DataFileRead). This explicit join with the smaller
    // side first lets the planner pick nested-loop + PK lookup.
    await sql`
      CREATE TABLE scope_m AS
      SELECT DISTINCT r.master_discogs_id AS discogs_id
      FROM scope_seed_rel ssr
      JOIN catalog.releases r
        ON r.discogs_id = ssr.discogs_id
        AND r.batch_id = ${batchId}::uuid
      WHERE r.master_discogs_id IS NOT NULL
    `.execute(c);
    await sql`CREATE UNIQUE INDEX ON scope_m (discogs_id)`.execute(c);

    if (args.qualityActiveOnly) {
      await sql`
        DELETE FROM scope_m
        USING enrich.entity_quality eq
        WHERE eq.entity_type = 'master'
          AND eq.discogs_id = scope_m.discogs_id
          AND eq.quality_status <> 'active'
      `.execute(c);
    }

    if (args.breakbeatYearGate < 9999) {
      await sql`DROP TABLE IF EXISTS scope_seeded_via_breakbeat_only`.execute(c);
      await sql`
        CREATE TABLE scope_seeded_via_breakbeat_only AS
        WITH seed_styles AS (
          SELECT DISTINCT r.master_discogs_id, rs.style
          FROM catalog.releases r
          JOIN catalog.release_styles rs
            ON rs.release_discogs_id = r.discogs_id
            AND rs.batch_id = ${batchId}::uuid
          WHERE r.batch_id = ${batchId}::uuid
            AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
            AND rs.style = ANY(${args.styles})
        )
        SELECT master_discogs_id
        FROM seed_styles
        GROUP BY master_discogs_id
        HAVING bool_and(style IN ('Breakbeat', 'Hardcore'))
      `.execute(c);

      await sql`
        DELETE FROM scope_m
        WHERE discogs_id IN (
          SELECT b.master_discogs_id
          FROM scope_seeded_via_breakbeat_only b
          JOIN catalog.masters m
            ON m.discogs_id = b.master_discogs_id
            AND m.batch_id = ${batchId}::uuid
          WHERE m.year IS NOT NULL AND m.year > ${args.breakbeatYearGate}
        )
      `.execute(c);
    }
    await sql`ANALYZE scope_m`.execute(c);
    console.log(`  [scope] scope_m built in ${Date.now() - t0}ms`);
  }

  // ---- scope_r: in-scope releases (for Notable Versions / videos) -------
  if (await tableExists(c, WS, "scope_r")) {
    const n = await tableRowCount(c, WS, "scope_r");
    console.log(`  [scope] reusing existing ${WS}.scope_r (${n.toLocaleString()} rows)`);
  } else {
    console.log(`  [scope] building scope_r...`);
    const t0 = Date.now();
    // Releases anchored to the year window. Without the year window on the
    // closure, a master pulls every reissue/repress through the present,
    // blowing scope to 47% of source. release_shadow's "Notable Versions"
    // therefore reflects the scene era, not modern reissues.
    await sql`
      CREATE TABLE scope_r AS
      SELECT DISTINCT scoped.discogs_id
      FROM (
        SELECT discogs_id FROM scope_seed_rel
        UNION
        SELECT r.discogs_id
        FROM scope_m sm
        JOIN catalog.releases r
          ON r.master_discogs_id = sm.discogs_id
          AND r.batch_id = ${batchId}::uuid
        LEFT JOIN catalog.masters m
          ON m.discogs_id = r.master_discogs_id
          AND m.batch_id = ${batchId}::uuid
        WHERE COALESCE(r.release_year, m.year) BETWEEN ${args.yearMin} AND ${args.yearMax}
      ) scoped
    `.execute(c);
    await sql`CREATE UNIQUE INDEX ON scope_r (discogs_id)`.execute(c);

    if (args.qualityActiveOnly) {
      await sql`
        DELETE FROM scope_r
        USING enrich.entity_quality eq
        WHERE eq.entity_type = 'release'
          AND eq.discogs_id = scope_r.discogs_id
          AND eq.quality_status <> 'active'
      `.execute(c);
    }
    await sql`ANALYZE scope_r`.execute(c);
    console.log(`  [scope] scope_r built in ${Date.now() - t0}ms`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: scene_weight per master + optional pruning
// ---------------------------------------------------------------------------
async function computeSceneWeight(c: Kysely<Database>, batchId: string) {
  if (await tableExists(c, WS, "scope_m_weight")) {
    const n = await tableRowCount(c, WS, "scope_m_weight");
    console.log(`[build-scope] reusing existing ${WS}.scope_m_weight (${n.toLocaleString()} rows)`);
    return;
  }
  console.log("[build-scope] computing scene_weight per master...");
  const t0 = Date.now();

  // Detect whether enrich.label_editorial exists on the source. Migration 024
  // is applied on dig-db-scene (and optionally on dig-db) but the live full
  // catalog DB historically only had migrations through 023. If absent, we
  // skip the tier-1 boost rather than failing — the histogram still tells us
  // a useful story, just without the +10 nudge for canonical imprints.
  const tierTable = await sql<{ exists_: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'enrich' AND tablename = 'label_editorial'
    ) AS exists_
  `.execute(c);
  const hasTier1Table = tierTable.rows[0]?.exists_ ?? false;
  if (!hasTier1Table) {
    console.warn("[build-scope] WARN: enrich.label_editorial missing on source — tier-1 boost (+10) skipped in scene_weight");
  }

  // Always emits a CTE named has_tier1_label. When the source table is
  // missing we substitute an empty CTE so the LEFT JOIN further down still
  // resolves and just doesn't contribute any +10 boosts.
  const tier1Cte = hasTier1Table
    ? sql`has_tier1_label AS (
      -- master is on a tier-1 label if any of its in-scope releases is on one
      SELECT DISTINCT r.master_discogs_id, true AS tier1
      FROM catalog.release_labels rl
      JOIN catalog.releases r
        ON r.discogs_id = rl.release_discogs_id
        AND r.batch_id = rl.batch_id
      JOIN enrich.label_editorial le
        ON le.discogs_label_id = rl.label_discogs_id
        AND le.tier = 'tier1'
      WHERE rl.batch_id = ${batchId}::uuid
        AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
        AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
    )`
    : sql`has_tier1_label AS (
      SELECT NULL::integer AS master_discogs_id, false AS tier1 WHERE false
    )`;

  await sql`
    CREATE TABLE scope_m_weight AS
    WITH
    -- one row per master with: data_quality + year-known + has-named-artist
    base AS (
      SELECT
        m.discogs_id,
        m.data_quality,
        (m.year IS NOT NULL) AS year_known
      FROM catalog.masters m
      WHERE m.batch_id = ${batchId}::uuid
        AND m.discogs_id IN (SELECT discogs_id FROM scope_m)
    ),
    has_named_artist AS (
      SELECT master_discogs_id, true AS has_named
      FROM catalog.master_artists
      WHERE batch_id = ${batchId}::uuid
        AND master_discogs_id IN (SELECT discogs_id FROM scope_m)
        AND artist_name IS NOT NULL AND artist_name <> ''
      GROUP BY master_discogs_id
    ),
    rel_stats AS (
      SELECT
        r.master_discogs_id,
        COUNT(*) AS n_releases,
        COUNT(DISTINCT r.country) FILTER (WHERE r.country IS NOT NULL) AS n_countries
      FROM catalog.releases r
      WHERE r.batch_id = ${batchId}::uuid
        AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
        AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
      GROUP BY r.master_discogs_id
    ),
    has_master_video AS (
      SELECT master_discogs_id, true AS has_video
      FROM catalog.master_videos
      WHERE batch_id = ${batchId}::uuid
        AND master_discogs_id IN (SELECT discogs_id FROM scope_m)
      GROUP BY master_discogs_id
    ),
    has_release_video AS (
      SELECT r.master_discogs_id, true AS has_video
      FROM catalog.release_videos rv
      JOIN catalog.releases r
        ON r.discogs_id = rv.release_discogs_id
        AND r.batch_id = rv.batch_id
      WHERE rv.batch_id = ${batchId}::uuid
        AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
        AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
      GROUP BY r.master_discogs_id
    ),
    ${tier1Cte}
    SELECT
      b.discogs_id,
      (
        -- data_quality buckets (Discogs editorial state)
        CASE
          WHEN b.data_quality IN ('Correct', 'Complete and Correct') THEN 5
          WHEN b.data_quality IN ('Needs Vote', 'Needs Minor Changes') THEN 2
          WHEN b.data_quality IN ('Needs Major Changes', 'Entirely Incorrect') THEN -5
          ELSE 0
        END
        -- release count, capped
        + LEAST(COALESCE(rs.n_releases, 0), 5)
        -- distinct countries, capped
        + LEAST(COALESCE(rs.n_countries, 0), 3)
        -- master-level video
        + CASE WHEN hmv.has_video THEN 3 ELSE 0 END
        -- release-level video on any in-scope pressing
        + CASE WHEN hrv.has_video THEN 3 ELSE 0 END
        -- tier-1 label
        + CASE WHEN htl.tier1 THEN 10 ELSE 0 END
        -- named artist credit
        + CASE WHEN hna.has_named THEN 2 ELSE 0 END
        -- year known
        + CASE WHEN b.year_known THEN 1 ELSE 0 END
      ) AS scene_weight
    FROM base b
    LEFT JOIN rel_stats        rs  ON rs.master_discogs_id  = b.discogs_id
    LEFT JOIN has_master_video  hmv ON hmv.master_discogs_id = b.discogs_id
    LEFT JOIN has_release_video hrv ON hrv.master_discogs_id = b.discogs_id
    LEFT JOIN has_tier1_label   htl ON htl.master_discogs_id = b.discogs_id
    LEFT JOIN has_named_artist  hna ON hna.master_discogs_id = b.discogs_id
  `.execute(c);
  await sql`CREATE UNIQUE INDEX ON scope_m_weight (discogs_id)`.execute(c);
  await sql`CREATE INDEX ON scope_m_weight (scene_weight)`.execute(c);
  await sql`ANALYZE scope_m_weight`.execute(c);

  console.log(`[build-scope] scene_weight computed in ${Date.now() - t0}ms`);
}

async function pruneByWeight(c: Kysely<Database>, batchId: string, threshold: number) {
  if (threshold <= 0) return;
  console.log(`[build-scope] pruning masters with scene_weight < ${threshold}...`);
  const before = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM scope_m`.execute(c);
  await sql`
    DELETE FROM scope_m
    USING scope_m_weight w
    WHERE w.discogs_id = scope_m.discogs_id
      AND w.scene_weight < ${threshold}
  `.execute(c);
  // Drop releases whose master is gone
  await sql`
    DELETE FROM scope_r
    USING catalog.releases r
    WHERE r.discogs_id = scope_r.discogs_id
      AND r.batch_id = ${batchId}::uuid
      AND r.master_discogs_id IS NOT NULL
      AND r.master_discogs_id NOT IN (SELECT discogs_id FROM scope_m)
  `.execute(c);
  await sql`ANALYZE scope_m`.execute(c);
  await sql`ANALYZE scope_r`.execute(c);
  const after = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM scope_m`.execute(c);
  console.log(`[build-scope] pruned masters: ${before.rows[0].n} -> ${after.rows[0].n}`);
}

// ---------------------------------------------------------------------------
// Histogram + sample report (for threshold pick)
// ---------------------------------------------------------------------------
async function printHistogram(c: Kysely<Database>, batchId: string) {
  console.log("\n=== scene_weight distribution ===");
  const dist = await sql<{ bucket: string; n: number }>`
    SELECT
      CASE
        WHEN scene_weight < 0  THEN 'negative'
        WHEN scene_weight = 0  THEN '0'
        WHEN scene_weight BETWEEN 1 AND 2  THEN '1-2'
        WHEN scene_weight BETWEEN 3 AND 4  THEN '3-4'
        WHEN scene_weight BETWEEN 5 AND 9  THEN '5-9'
        WHEN scene_weight BETWEEN 10 AND 14 THEN '10-14'
        WHEN scene_weight BETWEEN 15 AND 19 THEN '15-19'
        ELSE '20+'
      END AS bucket,
      COUNT(*)::int AS n
    FROM scope_m_weight
    GROUP BY bucket
    ORDER BY MIN(scene_weight)
  `.execute(c);
  for (const row of dist.rows) {
    console.log(`  ${row.bucket.padEnd(10)} ${row.n.toString().padStart(8)} masters`);
  }

  const cumulative = await sql<{ threshold: number; kept: number }>`
    SELECT t.threshold, COUNT(*) FILTER (WHERE w.scene_weight >= t.threshold)::int AS kept
    FROM (VALUES (0), (1), (2), (3), (4), (5), (7), (10), (15), (20)) AS t(threshold)
    CROSS JOIN scope_m_weight w
    GROUP BY t.threshold
    ORDER BY t.threshold
  `.execute(c);
  console.log("\n=== cumulative kept-at-threshold ===");
  for (const row of cumulative.rows) {
    console.log(`  scene_weight >= ${row.threshold.toString().padStart(2)} -> ${row.kept.toString().padStart(8)} masters kept`);
  }

  console.log("\n=== sample masters per bucket (15 random per bucket) ===");
  const buckets: Array<{ label: string; min: number; max: number }> = [
    { label: "0",    min: 0, max: 0 },
    { label: "1-2",  min: 1, max: 2 },
    { label: "3-4",  min: 3, max: 4 },
    { label: "5-9",  min: 5, max: 9 },
    { label: "10-14",min: 10, max: 14 },
    { label: "15+",  min: 15, max: 9999 },
  ];
  for (const b of buckets) {
    console.log(`\n--- weight ${b.label} ---`);
    const samples = await sql<{
      discogs_id: number; title: string; year: number | null;
      data_quality: string; scene_weight: number;
    }>`
      SELECT m.discogs_id, m.title, m.year, m.data_quality, w.scene_weight
      FROM catalog.masters m
      JOIN scope_m_weight w ON w.discogs_id = m.discogs_id
      WHERE m.batch_id = ${batchId}::uuid
        AND w.scene_weight BETWEEN ${b.min} AND ${b.max}
      ORDER BY random()
      LIMIT 15
    `.execute(c);
    for (const s of samples.rows) {
      console.log(`  [w=${s.scene_weight.toString().padStart(2)}] ${(s.year ?? "----").toString()} ${s.title} (id=${s.discogs_id}, dq=${s.data_quality})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: artist & label closures (run AFTER weight prune so we don't ship
// artists/labels that only existed via discarded masters)
// ---------------------------------------------------------------------------
async function buildArtistLabelClosure(c: Kysely<Database>, batchId: string, args: Args) {
  // Always rebuild closures — they depend on post-prune scope_m / scope_r.
  await sql`DROP TABLE IF EXISTS scope_a`.execute(c);
  await sql`DROP TABLE IF EXISTS scope_l`.execute(c);

  await sql`
    CREATE TABLE scope_a AS
    SELECT DISTINCT artist_discogs_id AS discogs_id
    FROM catalog.master_artists
    WHERE batch_id = ${batchId}::uuid
      AND master_discogs_id IN (SELECT discogs_id FROM scope_m)
    UNION
    SELECT DISTINCT artist_discogs_id AS discogs_id
    FROM catalog.release_artists
    WHERE batch_id = ${batchId}::uuid
      AND release_discogs_id IN (SELECT discogs_id FROM scope_r)
  `.execute(c);
  await sql`CREATE UNIQUE INDEX ON scope_a (discogs_id)`.execute(c);
  if (args.qualityActiveOnly) {
    await sql`
      DELETE FROM scope_a
      USING enrich.entity_quality eq
      WHERE eq.entity_type = 'artist'
        AND eq.discogs_id = scope_a.discogs_id
        AND eq.quality_status <> 'active'
    `.execute(c);
  }
  await sql`ANALYZE scope_a`.execute(c);

  await sql`
    CREATE TABLE scope_l AS
    SELECT DISTINCT label_discogs_id AS discogs_id
    FROM catalog.release_labels
    WHERE batch_id = ${batchId}::uuid
      AND release_discogs_id IN (SELECT discogs_id FROM scope_r)
  `.execute(c);
  await sql`CREATE UNIQUE INDEX ON scope_l (discogs_id)`.execute(c);
  if (args.qualityActiveOnly) {
    await sql`
      DELETE FROM scope_l
      USING enrich.entity_quality eq
      WHERE eq.entity_type = 'label'
        AND eq.discogs_id = scope_l.discogs_id
        AND eq.quality_status <> 'active'
    `.execute(c);
  }
  await sql`ANALYZE scope_l`.execute(c);
}

// ---------------------------------------------------------------------------
// Phase 4: master denorms (primary_artist_*, primary_label_*, etc.)
// ---------------------------------------------------------------------------
async function buildMasterDenorms(c: Kysely<Database>, batchId: string) {
  // Always rebuild — depends on post-prune scope_m / scope_r.
  await sql`DROP TABLE IF EXISTS scope_m_canonical_release`.execute(c);
  await sql`DROP TABLE IF EXISTS scope_m_denorm`.execute(c);

  console.log("[build-scope] computing master denorms (primary_*, genres, styles)...");
  const t0 = Date.now();

  // Pick canonical release per master (for primary_country / primary_format /
  // primary_label and for the Frankenstein tracklist source). Prefer
  // main_release if it's in scope; else earliest in-scope release.
  await sql`
    CREATE TABLE scope_m_canonical_release AS
    SELECT
      m.discogs_id AS master_discogs_id,
      COALESCE(
        CASE WHEN m.main_release_discogs_id IN (SELECT discogs_id FROM scope_r)
          THEN m.main_release_discogs_id END,
        (SELECT r.discogs_id
         FROM catalog.releases r
         WHERE r.batch_id = ${batchId}::uuid
           AND r.master_discogs_id = m.discogs_id
           AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
         ORDER BY r.release_year ASC NULLS LAST, r.discogs_id ASC
         LIMIT 1)
      ) AS release_discogs_id
    FROM catalog.masters m
    WHERE m.batch_id = ${batchId}::uuid
      AND m.discogs_id IN (SELECT discogs_id FROM scope_m)
  `.execute(c);
  await sql`CREATE UNIQUE INDEX ON scope_m_canonical_release (master_discogs_id)`.execute(c);
  await sql`CREATE INDEX ON scope_m_canonical_release (release_discogs_id)`.execute(c);
  await sql`ANALYZE scope_m_canonical_release`.execute(c);

  await sql`
    CREATE TABLE scope_m_denorm AS
    WITH
    primary_artist AS (
      SELECT DISTINCT ON (ma.master_discogs_id)
        ma.master_discogs_id,
        ma.artist_discogs_id,
        ma.artist_name
      FROM catalog.master_artists ma
      WHERE ma.batch_id = ${batchId}::uuid
        AND ma.master_discogs_id IN (SELECT discogs_id FROM scope_m)
      ORDER BY ma.master_discogs_id, ma.position ASC
    ),
    artists_credit AS (
      SELECT
        ma.master_discogs_id,
        string_agg(
          ma.artist_name || COALESCE(' ' || ma.join_relation, ''),
          ' ' ORDER BY ma.position ASC
        ) AS credit_text
      FROM catalog.master_artists ma
      WHERE ma.batch_id = ${batchId}::uuid
        AND ma.master_discogs_id IN (SELECT discogs_id FROM scope_m)
      GROUP BY ma.master_discogs_id
    ),
    primary_label AS (
      SELECT DISTINCT ON (rl.release_discogs_id)
        cr.master_discogs_id,
        rl.label_discogs_id,
        rl.label_name
      FROM scope_m_canonical_release cr
      JOIN catalog.release_labels rl
        ON rl.release_discogs_id = cr.release_discogs_id
        AND rl.batch_id = ${batchId}::uuid
      ORDER BY rl.release_discogs_id, rl.id ASC
    ),
    primary_country AS (
      SELECT cr.master_discogs_id, r.country
      FROM scope_m_canonical_release cr
      JOIN catalog.releases r
        ON r.discogs_id = cr.release_discogs_id
        AND r.batch_id = ${batchId}::uuid
    ),
    primary_format AS (
      SELECT DISTINCT ON (cr.master_discogs_id)
        cr.master_discogs_id,
        rf.name || COALESCE(' ' || rf.qty, '') AS format_text
      FROM scope_m_canonical_release cr
      JOIN catalog.release_formats rf
        ON rf.release_discogs_id = cr.release_discogs_id
        AND rf.batch_id = ${batchId}::uuid
      ORDER BY cr.master_discogs_id, rf.position ASC
    ),
    genres_agg AS (
      SELECT master_discogs_id, array_agg(DISTINCT genre ORDER BY genre) AS genres
      FROM catalog.master_genres
      WHERE batch_id = ${batchId}::uuid
        AND master_discogs_id IN (SELECT discogs_id FROM scope_m)
      GROUP BY master_discogs_id
    ),
    styles_agg AS (
      SELECT master_discogs_id, array_agg(DISTINCT style ORDER BY style) AS styles
      FROM catalog.master_styles
      WHERE batch_id = ${batchId}::uuid
        AND master_discogs_id IN (SELECT discogs_id FROM scope_m)
      GROUP BY master_discogs_id
    )
    SELECT
      m.discogs_id,
      pa.artist_discogs_id              AS primary_artist_discogs_id,
      pa.artist_name                    AS primary_artist_name,
      ac.credit_text                    AS artists_credit_text,
      pl.label_discogs_id               AS primary_label_discogs_id,
      pl.label_name                     AS primary_label_name,
      pc.country                        AS primary_country,
      pf.format_text                    AS primary_format,
      COALESCE(ga.genres, '{}'::text[]) AS genres,
      COALESCE(sa.styles, '{}'::text[]) AS styles,
      COALESCE(w.scene_weight, 0)       AS scene_weight
    FROM catalog.masters m
    LEFT JOIN primary_artist  pa ON pa.master_discogs_id = m.discogs_id
    LEFT JOIN artists_credit  ac ON ac.master_discogs_id = m.discogs_id
    LEFT JOIN primary_label   pl ON pl.master_discogs_id = m.discogs_id
    LEFT JOIN primary_country pc ON pc.master_discogs_id = m.discogs_id
    LEFT JOIN primary_format  pf ON pf.master_discogs_id = m.discogs_id
    LEFT JOIN genres_agg      ga ON ga.master_discogs_id = m.discogs_id
    LEFT JOIN styles_agg      sa ON sa.master_discogs_id = m.discogs_id
    LEFT JOIN scope_m_weight  w  ON w.discogs_id         = m.discogs_id
    WHERE m.batch_id = ${batchId}::uuid
      AND m.discogs_id IN (SELECT discogs_id FROM scope_m)
  `.execute(c);
  await sql`CREATE UNIQUE INDEX ON scope_m_denorm (discogs_id)`.execute(c);
  await sql`ANALYZE scope_m_denorm`.execute(c);

  console.log(`[build-scope] master denorms in ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------------------
// Counts (used in dry-run + audit row)
// ---------------------------------------------------------------------------
async function collectScopeCounts(c: Kysely<Database>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ["scope_a", "scope_l", "scope_m", "scope_r"]) {
    const r = await sql<{ count: number }>`SELECT COUNT(*)::int AS count FROM ${sql.raw(t)}`.execute(c);
    out[t] = r.rows[0]?.count ?? 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dump phase — emit SQL for everything
// ---------------------------------------------------------------------------
async function dumpAll(
  c: Kysely<Database>,
  batchId: string,
  args: Args,
): Promise<{ counts: Record<string, number>; output: string }> {
  mkdirSync(dirname(args.output), { recursive: true });
  const out: WriteStream = createWriteStream(args.output, { encoding: "utf8" });
  const writeLine = (line: string) => new Promise<void>((res) => out.write(line + "\n", () => res()));

  await writeLine("-- scoped slim master-first build");
  await writeLine("SET session_replication_role = 'replica';");
  await writeLine("BEGIN;");

  // batch row
  const batch = await sql<{
    id: string; dump_date: string; status: string;
    started_at: Date | null; completed_at: Date | null;
    stats: unknown; created_at: Date;
  }>`
    SELECT id::text, dump_date::text, status, started_at, completed_at, stats, created_at
    FROM ingest.dump_batches WHERE id = ${batchId}::uuid
  `.execute(c);
  await writeLine("-- ingest.dump_batches");
  for (const row of batch.rows) {
    await writeLine(
      `INSERT INTO ingest.dump_batches (id, dump_date, status, started_at, completed_at, stats, created_at) ` +
      `VALUES (${pgVal(row.id)}, ${pgVal(row.dump_date)}, ${pgVal(row.status)}, ` +
      `${pgVal(row.started_at)}, ${pgVal(row.completed_at)}, ${pgVal(row.stats)}, ${pgVal(row.created_at)}) ` +
      `ON CONFLICT (id) DO NOTHING;`,
    );
  }

  // catalog.masters with denormed columns inline
  await dumpMasters(c, batchId, writeLine);
  // catalog.artists with aliases_text inline
  await dumpArtists(c, batchId, writeLine);
  // catalog.labels (aliases_text empty for now — label aliases not derived in v1)
  await dumpLabels(c, batchId, writeLine);

  // Plain table dumps (slim list)
  for (const table of KEPT_TABLES) {
    await dumpTable(c, table, writeLine);
  }

  // Derived tables
  await dumpMasterTracks(c, batchId, writeLine);
  await dumpMasterVideosUnified(c, batchId, writeLine);
  await dumpReleaseShadow(c, batchId, writeLine);

  await writeLine("COMMIT;");
  await writeLine("SET session_replication_role = 'origin';");
  await new Promise<void>((res) => out.end(res));

  const counts = await collectScopeCounts(c);
  return { counts, output: args.output };
}

async function dumpMasters(
  c: Kysely<Database>,
  batchId: string,
  writeLine: (s: string) => Promise<void>,
) {
  await writeLine("-- catalog.masters (with denormed slim columns)");
  const cols = [
    "id", "discogs_id", "title", "main_release_discogs_id", "year", "data_quality", "batch_id",
    "primary_artist_discogs_id", "primary_artist_name", "artists_credit_text",
    "primary_label_discogs_id", "primary_label_name",
    "primary_country", "primary_format",
    "genres", "styles", "scene_weight",
    "created_at", "updated_at",
  ];
  console.log(`  [dump] catalog.masters`);
  const result = await sql<Record<string, unknown>>`
    SELECT
      m.id, m.discogs_id, m.title, m.main_release_discogs_id, m.year, m.data_quality, m.batch_id,
      d.primary_artist_discogs_id, d.primary_artist_name, d.artists_credit_text,
      d.primary_label_discogs_id, d.primary_label_name,
      d.primary_country, d.primary_format,
      d.genres, d.styles, d.scene_weight,
      m.created_at, m.updated_at
    FROM catalog.masters m
    JOIN scope_m_denorm d ON d.discogs_id = m.discogs_id
    WHERE m.batch_id = ${batchId}::uuid
      AND m.discogs_id IN (SELECT discogs_id FROM scope_m)
  `.execute(c);
  await emitChunkedInserts("catalog.masters", cols, result.rows, writeLine);
}

async function dumpArtists(
  c: Kysely<Database>,
  batchId: string,
  writeLine: (s: string) => Promise<void>,
) {
  await writeLine("-- catalog.artists (with denormed aliases_text)");
  const cols = [
    "id", "discogs_id", "name", "real_name", "profile", "data_quality", "batch_id",
    "aliases_text", "created_at", "updated_at",
  ];
  console.log(`  [dump] catalog.artists`);
  const result = await sql<Record<string, unknown>>`
    SELECT
      a.id, a.discogs_id, a.name, a.real_name, a.profile, a.data_quality, a.batch_id,
      COALESCE(
        (SELECT array_agg(DISTINCT al.alias_name ORDER BY al.alias_name)
         FROM catalog.artist_aliases al
         WHERE al.batch_id = ${batchId}::uuid
           AND al.artist_discogs_id = a.discogs_id),
        '{}'::text[]
      ) AS aliases_text,
      a.created_at, a.updated_at
    FROM catalog.artists a
    WHERE a.batch_id = ${batchId}::uuid
      AND a.discogs_id IN (SELECT discogs_id FROM scope_a)
  `.execute(c);
  await emitChunkedInserts("catalog.artists", cols, result.rows, writeLine);
}

async function dumpLabels(
  c: Kysely<Database>,
  batchId: string,
  writeLine: (s: string) => Promise<void>,
) {
  await writeLine("-- catalog.labels (aliases_text empty in v1)");
  const cols = [
    "id", "discogs_id", "name", "profile", "contact_info", "data_quality",
    "parent_label_discogs_id", "batch_id", "aliases_text", "created_at", "updated_at",
  ];
  console.log(`  [dump] catalog.labels`);
  const result = await sql<Record<string, unknown>>`
    SELECT
      l.id, l.discogs_id, l.name, l.profile, l.contact_info, l.data_quality,
      l.parent_label_discogs_id, l.batch_id,
      '{}'::text[] AS aliases_text,
      l.created_at, l.updated_at
    FROM catalog.labels l
    WHERE l.batch_id = ${batchId}::uuid
      AND (
        l.discogs_id IN (SELECT discogs_id FROM scope_l)
        OR l.discogs_id IN (
          SELECT parent_label_discogs_id
          FROM catalog.labels
          WHERE batch_id = ${batchId}::uuid
            AND parent_label_discogs_id IS NOT NULL
            AND discogs_id IN (SELECT discogs_id FROM scope_l)
        )
      )
  `.execute(c);
  await emitChunkedInserts("catalog.labels", cols, result.rows, writeLine);
}

async function dumpMasterTracks(
  c: Kysely<Database>,
  batchId: string,
  writeLine: (s: string) => Promise<void>,
) {
  await writeLine("-- catalog.master_tracks (Frankenstein from canonical release)");
  const cols = [
    "master_discogs_id", "position", "title", "duration_seconds",
    "artists_text", "source_release_discogs_id",
  ];
  console.log(`  [dump] catalog.master_tracks`);
  const result = await sql<Record<string, unknown>>`
    SELECT
      cr.master_discogs_id,
      COALESCE(t.track_number, t.position::text) AS position,
      t.title,
      t.duration_seconds,
      (SELECT string_agg(DISTINCT tc.artist_name, ', ' ORDER BY tc.artist_name)
       FROM catalog.track_credits tc
       WHERE tc.batch_id = ${batchId}::uuid
         AND tc.track_id = t.id) AS artists_text,
      cr.release_discogs_id AS source_release_discogs_id
    FROM scope_m_canonical_release cr
    JOIN catalog.tracks t
      ON t.release_discogs_id = cr.release_discogs_id
      AND t.batch_id = ${batchId}::uuid
    WHERE cr.release_discogs_id IS NOT NULL
      AND t.title IS NOT NULL
    ORDER BY cr.master_discogs_id, t.position
  `.execute(c);
  await emitChunkedInserts("catalog.master_tracks", cols, result.rows, writeLine);
}

async function dumpMasterVideosUnified(
  c: Kysely<Database>,
  batchId: string,
  writeLine: (s: string) => Promise<void>,
) {
  await writeLine("-- catalog.master_videos_unified (master + release videos)");
  const cols = [
    "master_discogs_id", "source_type", "source_release_discogs_id",
    "url", "title", "duration_seconds", "discogs_release_url",
  ];
  console.log(`  [dump] catalog.master_videos_unified`);
  const result = await sql<Record<string, unknown>>`
    SELECT
      mv.master_discogs_id,
      'master'::text AS source_type,
      NULL::integer AS source_release_discogs_id,
      mv.url,
      mv.title,
      mv.duration_seconds,
      NULL::text AS discogs_release_url
    FROM catalog.master_videos mv
    WHERE mv.batch_id = ${batchId}::uuid
      AND mv.master_discogs_id > 0
      AND mv.master_discogs_id IN (SELECT discogs_id FROM scope_m)
    UNION ALL
    SELECT
      r.master_discogs_id,
      'release'::text AS source_type,
      r.discogs_id    AS source_release_discogs_id,
      rv.url,
      rv.title,
      rv.duration_seconds,
      ('https://www.discogs.com/release/' || r.discogs_id::text) AS discogs_release_url
    FROM catalog.release_videos rv
    JOIN catalog.releases r
      ON r.discogs_id = rv.release_discogs_id
      AND r.batch_id = rv.batch_id
    WHERE rv.batch_id = ${batchId}::uuid
      AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
      AND r.master_discogs_id IS NOT NULL
      AND r.master_discogs_id > 0
      AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
  `.execute(c);
  await emitChunkedInserts("catalog.master_videos_unified", cols, result.rows, writeLine);
}

async function dumpReleaseShadow(
  c: Kysely<Database>,
  batchId: string,
  writeLine: (s: string) => Promise<void>,
) {
  await writeLine("-- catalog.release_shadow (Notable Versions feed)");
  const cols = [
    "release_discogs_id", "master_discogs_id", "title", "release_year",
    "country", "label", "format", "is_main_release",
    "has_tracklist_delta", "has_remix_signal", "discogs_url",
  ];
  console.log(`  [dump] catalog.release_shadow`);
  const result = await sql<Record<string, unknown>>`
    SELECT
      r.discogs_id AS release_discogs_id,
      r.master_discogs_id,
      r.title,
      r.release_year,
      r.country,
      (SELECT label_name FROM catalog.release_labels rl
       WHERE rl.batch_id = ${batchId}::uuid
         AND rl.release_discogs_id = r.discogs_id
       ORDER BY rl.id ASC LIMIT 1) AS label,
      (SELECT name FROM catalog.release_formats rf
       WHERE rf.batch_id = ${batchId}::uuid
         AND rf.release_discogs_id = r.discogs_id
       ORDER BY rf.position ASC LIMIT 1) AS format,
      COALESCE(r.is_main_release, false) AS is_main_release,
      false AS has_tracklist_delta,
      EXISTS (
        SELECT 1 FROM catalog.release_styles rs
        WHERE rs.batch_id = ${batchId}::uuid
          AND rs.release_discogs_id = r.discogs_id
          AND rs.style ILIKE '%remix%'
      ) AS has_remix_signal,
      ('https://www.discogs.com/release/' || r.discogs_id::text) AS discogs_url
    FROM catalog.releases r
    WHERE r.batch_id = ${batchId}::uuid
      AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
      AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
  `.execute(c);
  await emitChunkedInserts("catalog.release_shadow", cols, result.rows, writeLine);
}

async function dumpTable(
  c: Kysely<Database>,
  table: string,
  writeLine: (s: string) => Promise<void>,
) {
  const where = whereClauseFor(table);
  const cols = await getColumns(c, table);
  const colList = cols.join(", ");
  console.log(`  [dump] ${table}`);
  const result = await sql<Record<string, unknown>>`
    SELECT ${sql.raw(colList)}
    FROM ${sql.raw(table)}
    WHERE ${sql.raw(where)}
  `.execute(c);
  await writeLine(`-- ${table}`);
  await emitChunkedInserts(table, cols, result.rows, writeLine);
}

async function emitChunkedInserts(
  table: string,
  cols: string[],
  rows: Record<string, unknown>[],
  writeLine: (s: string) => Promise<void>,
) {
  const colList = cols.join(", ");
  let buf: string[] = [];
  for (const row of rows) {
    const vals = cols.map((c) => pgVal(row[c])).join(", ");
    buf.push(`(${vals})`);
    if (buf.length >= 500) {
      await writeLine(`INSERT INTO ${table} (${colList}) VALUES ${buf.join(", ")} ON CONFLICT DO NOTHING;`);
      buf = [];
    }
  }
  if (buf.length > 0) {
    await writeLine(`INSERT INTO ${table} (${colList}) VALUES ${buf.join(", ")} ON CONFLICT DO NOTHING;`);
  }
}

function whereClauseFor(table: string): string {
  switch (table) {
    case "catalog.master_artists":
      return `batch_id IS NOT NULL AND master_discogs_id IN (SELECT discogs_id FROM scope_m)`;
    case "catalog.artist_urls":
      return `batch_id IS NOT NULL AND artist_discogs_id IN (SELECT discogs_id FROM scope_a)`;
    case "catalog.label_urls":
      return `batch_id IS NOT NULL AND label_discogs_id IN (SELECT discogs_id FROM scope_l)`;
    case "enrich.entity_quality":
      return `(entity_type = 'artist'  AND discogs_id IN (SELECT discogs_id FROM scope_a))
           OR (entity_type = 'label'   AND discogs_id IN (SELECT discogs_id FROM scope_l))
           OR (entity_type = 'master'  AND discogs_id IN (SELECT discogs_id FROM scope_m))
           OR (entity_type = 'release' AND discogs_id IN (SELECT discogs_id FROM scope_r))`;
    case "enrich.label_linkouts":
      return `discogs_label_id IN (SELECT discogs_id FROM scope_l)`;
    default:
      throw new Error(`No WHERE clause for table ${table}`);
  }
}

async function getColumns(c: Kysely<Database>, table: string): Promise<string[]> {
  const [schema, name] = table.split(".");
  const rows = await sql<{ column_name: string }>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = ${schema} AND table_name = ${name}
    ORDER BY ordinal_position
  `.execute(c);
  return rows.rows.map((r) => r.column_name);
}

function pgVal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  if (Array.isArray(v)) {
    const inner = v.map((x) => {
      if (x === null || x === undefined) return "NULL";
      if (typeof x === "number") return String(x);
      return `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    }).join(",");
    return `'{${inner.replace(/'/g, "''")}}'`;
  }
  if (typeof v === "object") {
    return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  }
  const s = String(v).replace(/'/g, "''");
  return `'${s}'`;
}

async function writeAuditRow(batchId: string, args: Args, output: string, counts: Record<string, number>) {
  const fs = await import("node:fs/promises");
  const audit =
    `INSERT INTO enrich.scene_scope_audit ` +
    `(source_batch_id, year_min, year_max, style_allowlist, quality_filter, ` +
    `breakbeat_year_gate, counts, notes) VALUES (` +
    `${pgVal(batchId)}::uuid, ${args.yearMin}, ${args.yearMax}, ${pgVal(args.styles)}, ` +
    `${pgVal(args.qualityActiveOnly)}, ` +
    `${args.breakbeatYearGate < 9999 ? args.breakbeatYearGate : "NULL"}, ` +
    `${pgVal({ ...counts, scene_weight_min: args.sceneWeightMin })}, ` +
    `'built by scripts/build-scoped-db.ts (slim master-first; weight_min=${args.sceneWeightMin})');\n`;
  await fs.appendFile(output, audit);
}

async function pipeIntoTarget(targetUrl: string, sqlPath: string) {
  console.log(`  [target] piping ${sqlPath} into target via psql`);
  const result = spawnSync("psql", [targetUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlPath], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`psql restore failed (exit ${result.status})`);
  }
}

/**
 * Phase 6 — backfill on TARGET after import.
 *
 * The dump emits raw column values for catalog.{masters,artists,labels} but
 * not search_vector (it's a tsvector built from other denormed columns and
 * would bloat the dump considerably). We populate it post-restore so search
 * works immediately on cutover. We also ANALYZE to refresh planner stats.
 */
async function postLoadBackfill(targetUrl: string) {
  console.log("  [target] phase 6: search_vector backfill + ANALYZE");
  const sql = `
    SET statement_timeout = '60min';
    UPDATE catalog.masters
    SET search_vector =
          setweight(to_tsvector('english', coalesce(title, '')), 'A')
       || setweight(to_tsvector('english', coalesce(primary_artist_name, '')), 'B')
       || setweight(to_tsvector('english', coalesce(artists_credit_text, '')), 'B')
       || setweight(to_tsvector('english', coalesce(primary_label_name, '')), 'C')
       || setweight(to_tsvector('english', array_to_string(coalesce(styles, '{}'), ' ')), 'D')
       || setweight(to_tsvector('english', array_to_string(coalesce(genres, '{}'), ' ')), 'D')
    WHERE search_vector IS NULL;

    UPDATE catalog.artists
    SET search_vector =
          setweight(to_tsvector('english', coalesce(name, '')), 'A')
       || setweight(to_tsvector('english', coalesce(real_name, '')), 'B')
       || setweight(to_tsvector('english', array_to_string(coalesce(aliases_text, '{}'), ' ')), 'C')
    WHERE search_vector IS NULL;

    UPDATE catalog.labels
    SET search_vector =
          setweight(to_tsvector('english', coalesce(name, '')), 'A')
       || setweight(to_tsvector('english', array_to_string(coalesce(aliases_text, '{}'), ' ')), 'C')
    WHERE search_vector IS NULL;

    VACUUM ANALYZE catalog.masters;
    VACUUM ANALYZE catalog.artists;
    VACUUM ANALYZE catalog.labels;
    VACUUM ANALYZE catalog.master_videos_unified;
    VACUUM ANALYZE catalog.master_tracks;
    VACUUM ANALYZE catalog.release_shadow;
  `;
  const result = spawnSync("psql", [targetUrl, "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`postLoadBackfill failed (exit ${result.status})`);
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) {
    console.error("SOURCE_DATABASE_URL is required");
    process.exit(1);
  }
  const targetUrl = args.target ? process.env.TARGET_DATABASE_URL : null;
  if (args.target && !targetUrl) {
    console.error("TARGET_DATABASE_URL required when --target is set");
    process.exit(1);
  }

  const source = createDb(sourceUrl);
  try {
    const batchId = await resolveBatchId(source, args.batchIdOverride);
    console.log(
      `[build-scope] source batch_id=${batchId} year=${args.yearMin}-${args.yearMax} ` +
      `quality=${args.qualityActiveOnly} breakbeat-gate=${args.breakbeatYearGate} ` +
      `weight-min=${args.sceneWeightMin} histogram=${args.histogram}`,
    );
    console.log(`[build-scope] styles (${args.styles.length}): ${args.styles.join(", ")}`);

    await source.connection().execute(async (c) => {
      await ensureWorkspace(c);
      // search_path applies to ALL subsequent queries on this connection.
      // Unqualified scope_X => scope_workspace.scope_X. catalog.* / enrich.*
      // remain explicit. Keep this BEFORE any phase, including --from-phase
      // skips, so dumpAll's SELECTs from scope_X resolve correctly.
      await sql.raw(`SET search_path TO ${WS}, public`).execute(c);
      await sql`SET statement_timeout = '120min'`.execute(c);
      await sql`SET work_mem = '256MB'`.execute(c);

      if (args.reset) {
        await dropAllScopeTables(c);
      }

      if (args.fromPhase <= 1) {
        console.log("[build-scope] phase 1: building scope on source...");
        await buildScopeOnSource(c, batchId, args);
      } else {
        console.log(`[build-scope] phase 1: SKIPPED (--from-phase ${args.fromPhase})`);
      }

      if (args.fromPhase <= 2) {
        console.log("[build-scope] phase 2: scene_weight...");
        await computeSceneWeight(c, batchId);
      } else {
        console.log(`[build-scope] phase 2: SKIPPED (--from-phase ${args.fromPhase})`);
      }

      if (args.histogram) {
        await printHistogram(c, batchId);
        console.log("\n[build-scope] histogram mode — exiting without dump");
        return;
      }

      await pruneByWeight(c, batchId, args.sceneWeightMin);

      if (args.fromPhase <= 3) {
        console.log("[build-scope] phase 3: artist + label closures...");
        await buildArtistLabelClosure(c, batchId, args);
      } else {
        console.log(`[build-scope] phase 3: SKIPPED (--from-phase ${args.fromPhase})`);
      }

      if (args.fromPhase <= 4) {
        console.log("[build-scope] phase 4: master denorms...");
        await buildMasterDenorms(c, batchId);
      } else {
        console.log(`[build-scope] phase 4: SKIPPED (--from-phase ${args.fromPhase})`);
      }

      const counts = await collectScopeCounts(c);
      console.log("[build-scope] scope counts:", counts);

      if (args.dryRun) {
        console.log("[build-scope] dry-run: not writing dump");
        return;
      }

      console.log(`[build-scope] phase 5: writing dump to ${args.output}`);
      const { counts: finalCounts } = await dumpAll(c, batchId, args);
      await writeAuditRow(batchId, args, args.output, finalCounts);

      if (targetUrl) {
        await pipeIntoTarget(targetUrl, args.output);
        await postLoadBackfill(targetUrl);
      }
      console.log("[build-scope] done");
    });
  } finally {
    await source.destroy();
  }
}

main().catch((err) => {
  console.error("[build-scope] fatal:", err);
  process.exit(1);
});
