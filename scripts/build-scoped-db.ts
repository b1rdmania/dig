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
 *   3. Histogram pass on the full-catalog staging DB (local Docker PG):
 *        SOURCE_DATABASE_URL=postgres://... \
 *          pnpm exec tsx scripts/build-scoped-db.ts \
 *            --histogram --quality-active-only
 *   4. Pick a threshold from the histogram output.
 *   5. Real build (run on a Fly machine to avoid laptop sleep):
 *        SOURCE_DATABASE_URL=postgres://... TARGET_DATABASE_URL=postgres://... \
 *          pnpm exec tsx scripts/build-scoped-db.ts \
 *            --year-min 1985 --year-max 2008 --quality-active-only \
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
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WriteStream } from "node:fs";
import pg from "pg";
import { spawn } from "node:child_process";

// Dedicated pool for streamQueryToInserts. Each call acquires a fresh
// connection from the pool and releases it when done, so a dropped/idle
// connection only kills one batch (which we retry). Long-running dumps on
// the pinned Kysely connection previously dropped after ~1 hour with
// "Connection terminated unexpectedly". Using a pool + per-query fresh
// connections + retry on transient errors + persistent staging tables
// (in scope_workspace) lets us recover without restarting the dump.
let streamPool: pg.Pool | null = null;
// Shared WriteStream for the current dump (set by dumpAll/dumpCreditsOnly).
// streamQueryToInserts writes COPY data directly to this stream so we avoid
// the per-line writeLine wrapper (which appends \n and is async per call).
let currentOut: WriteStream | null = null;

function isTransientConnError(err: unknown): boolean {
  const msg = (err as Error)?.message ?? "";
  const code = (err as { code?: string })?.code ?? "";
  return (
    /Connection terminated|server closed|read ECONNRESET|ETIMEDOUT|connection timeout|Client has encountered a connection error|socket hang up|terminated by administrator|timeout exceeded when trying to connect/i.test(
      msg,
    ) ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "57P01" || // admin_shutdown
    code === "57P02" || // crash_shutdown
    code === "57P03"    // cannot_connect_now
  );
}

async function streamExec<T extends pg.QueryResultRow = Record<string, unknown>>(
  q: string,
  opts: { maxRetries?: number; quiet?: boolean; queryTimeoutMs?: number } = {},
): Promise<pg.QueryResult<T>> {
  if (!streamPool) throw new Error("streamPool not initialized");
  const maxRetries = opts.maxRetries ?? 10;
  const queryTimeoutMs = opts.queryTimeoutMs ?? 30 * 60 * 1000; // 30 min wall clock
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const client = await streamPool.connect();
    let timer: NodeJS.Timeout | null = null;
    try {
      await client.query("SET statement_timeout = '60min'");
      await client.query("SET idle_in_transaction_session_timeout = '5min'");
      await client.query("SET work_mem = '256MB'");
      await client.query("SET search_path TO scope_workspace, public");
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`streamExec wall-clock timeout after ${queryTimeoutMs}ms`)),
          queryTimeoutMs,
        );
      });
      const res = (await Promise.race([client.query<T>(q), timeoutPromise])) as pg.QueryResult<T>;
      if (timer) clearTimeout(timer);
      client.release();
      return res;
    } catch (err) {
      if (timer) clearTimeout(timer);
      try {
        client.release(true);
      } catch {
        // ignore
      }
      lastErr = err;
      const transient = isTransientConnError(err) ||
        /wall-clock timeout/.test((err as Error).message ?? "");
      if (!transient) throw err;
      const backoff = Math.min(30_000, 2_000 * Math.pow(2, attempt));
      if (!opts.quiet) {
        console.log(
          `  [stream] transient error on attempt ${attempt + 1}/${maxRetries}: ` +
          `${(err as Error).message} — retrying in ${backoff}ms`,
        );
      }
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

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
  // --- Manifest + credit layer (added 2026-04) ---
  manifestPath: string | null;
  manifest: ScopeManifest | null;
  creditsOnly: boolean;
  skipCredits: boolean;
}

// ---------------------------------------------------------------------------
// Scope Manifest (JSON) — see packages/db/scope-manifests/*.json
// CLI flags still take precedence; the manifest only fills in defaults.
// ---------------------------------------------------------------------------
interface ScopeManifest {
  id: string;
  version: string;
  description?: string;
  scope?: {
    year_min?: number;
    year_max?: number;
    styles?: string[];
    use_default_styles?: boolean;
    quality_active_only?: boolean;
    breakbeat_year_gate?: number;
    scene_weight_min?: number;
  };
  credits?: {
    enabled?: boolean;
    rule_a?: {
      enabled?: boolean;
      track_credits?: boolean;
      release_credits?: boolean;
      role_allowlist?: string[]; // post-normalisation buckets
    };
    rule_b?: {
      enabled?: boolean;
      role_allowlist?: string[];
    };
    group_members?: { enabled?: boolean };
  };
}

const DEFAULT_RULE_A_ROLES = [
  "Remix", "Producer", "Mixed By", "Edit", "Dub",
  "Additional Production", "Engineer", "Mastered By",
  "Written By", "Vocals",
];

const DEFAULT_RULE_B_ROLES = [
  "Remix", "Producer", "Mixed By", "Edit", "Dub", "Additional Production",
];

function loadManifest(path: string): ScopeManifest {
  const raw = readFileSync(path, "utf8");
  let m: ScopeManifest;
  try {
    m = JSON.parse(raw) as ScopeManifest;
  } catch (err) {
    throw new Error(`Failed to parse manifest ${path}: ${(err as Error).message}`);
  }
  if (!m.id) throw new Error(`Manifest ${path} missing required "id"`);
  if (!m.version) throw new Error(`Manifest ${path} missing required "version"`);
  return m;
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
  --year-max <n>            Default: 2008
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
  --manifest <path>         Load defaults from a Scope Manifest JSON file
                            (packages/db/scope-manifests/*.json). CLI flags still
                            override individual values.
  --credits-only            Only run the credit-extraction phases + dump credit
                            tables. Reuses existing scope_workspace.* tables on
                            SOURCE (build phases 1-3 are still required to derive
                            the scope; phase 4 denorm is skipped). Useful for
                            adding credits to an already-built scoped DB without
                            re-shipping 2GB of unchanged catalog data.
  --skip-credits            Run a normal build but DO NOT extract credits even
                            if the manifest enables them. Useful for the first
                            cut of a new scope where you want the catalogue
                            shape before paying the credit-extraction cost.
  --help                    Show this help.
`);
  process.exit(0);
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let yearMin = 1985;
  let yearMax = 2008;
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
  let manifestPath: string | null = null;
  let creditsOnly = false;
  let skipCredits = false;
  // Track which CLI flags the user explicitly set so the manifest only fills
  // in the gaps. (We still want CLI overrides to win, but we should not have
  // CLI defaults stomp on manifest values.)
  const cliSet = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help") help();
    if (a === "--year-min" && args[i + 1]) { yearMin = parseInt(args[++i], 10); cliSet.add("year_min"); continue; }
    if (a === "--year-max" && args[i + 1]) { yearMax = parseInt(args[++i], 10); cliSet.add("year_max"); continue; }
    if (a === "--style" && args[i + 1])    { styles.push(args[++i]); cliSet.add("styles"); continue; }
    if (a === "--no-default-styles")       { useDefaultStyles = false; cliSet.add("use_default_styles"); continue; }
    if (a === "--quality-active-only")     { qualityActiveOnly = true; cliSet.add("quality_active_only"); continue; }
    if (a === "--breakbeat-year-gate" && args[i + 1]) { breakbeatYearGate = parseInt(args[++i], 10); cliSet.add("breakbeat_year_gate"); continue; }
    if (a === "--batch-id" && args[i + 1]) { batchIdOverride = args[++i]; continue; }
    if (a === "--output" && args[i + 1])   { output = args[++i]; continue; }
    if (a === "--target")                  { target = true; continue; }
    if (a === "--histogram")               { histogram = true; continue; }
    if (a === "--scene-weight-min" && args[i + 1]) { sceneWeightMin = parseInt(args[++i], 10); cliSet.add("scene_weight_min"); continue; }
    if (a === "--dry-run")                 { dryRun = true; continue; }
    if (a === "--reset")                   { reset = true; continue; }
    if (a === "--from-phase" && args[i + 1]) { fromPhase = parseInt(args[++i], 10); continue; }
    if (a === "--manifest" && args[i + 1]) { manifestPath = args[++i]; continue; }
    if (a === "--credits-only")            { creditsOnly = true; continue; }
    if (a === "--skip-credits")            { skipCredits = true; continue; }
    console.error(`Unknown arg: ${a}`);
    help();
  }

  // Manifest fills in unset CLI defaults
  let manifest: ScopeManifest | null = null;
  if (manifestPath) {
    manifest = loadManifest(manifestPath);
    const s = manifest.scope ?? {};
    if (s.year_min !== undefined && !cliSet.has("year_min")) yearMin = s.year_min;
    if (s.year_max !== undefined && !cliSet.has("year_max")) yearMax = s.year_max;
    if (s.styles !== undefined && !cliSet.has("styles")) {
      styles.push(...s.styles);
    }
    if (s.use_default_styles !== undefined && !cliSet.has("use_default_styles")) {
      useDefaultStyles = s.use_default_styles;
    }
    if (s.quality_active_only !== undefined && !cliSet.has("quality_active_only")) {
      qualityActiveOnly = s.quality_active_only;
    }
    if (s.breakbeat_year_gate !== undefined && !cliSet.has("breakbeat_year_gate")) {
      breakbeatYearGate = s.breakbeat_year_gate;
    }
    if (s.scene_weight_min !== undefined && !cliSet.has("scene_weight_min")) {
      sceneWeightMin = s.scene_weight_min;
    }
  }

  const finalStyles = styles.length > 0
    ? (useDefaultStyles ? [...new Set([...DEFAULT_STYLES, ...styles])] : [...new Set(styles)])
    : DEFAULT_STYLES;

  if (yearMin > yearMax) {
    console.error("year-min must be <= year-max");
    process.exit(1);
  }

  return {
    yearMin, yearMax, styles: finalStyles, qualityActiveOnly,
    breakbeatYearGate, output, target, batchIdOverride, dryRun,
    histogram, sceneWeightMin, reset, fromPhase,
    manifestPath, manifest, creditsOnly, skipCredits,
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
  // Prefer Kysely connection but fall back to streamPool if it's gone stale.
  // Long-running COPY phases can idle out the pinned Kysely connection;
  // tableExists is called between phases so it sometimes hits a dead conn.
  try {
    const r = await sql<{ exists_: boolean }>`
      SELECT EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = ${schema} AND tablename = ${name}
      ) AS exists_
    `.execute(c);
    return r.rows[0]?.exists_ ?? false;
  } catch (err) {
    if (!streamPool) throw err;
    console.warn(`[tableExists] Kysely conn failed, falling back to streamPool: ${(err as Error)?.message ?? err}`);
    const r = await streamExec<{ exists_: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = '${schema.replace(/'/g, "''")}' AND tablename = '${name.replace(/'/g, "''")}') AS exists_`,
      { quiet: true },
    );
    return r.rows[0]?.exists_ ?? false;
  }
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
  // is applied on dig-db-scene, but a full-catalog staging DB built from an
  // older migration set may only have migrations through 023. If absent, we
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
  // In --credits-only mode (no prune happened, scope unchanged), reuse the
  // existing closures rather than rebuild — saves several minutes of
  // catalog.* re-scanning over a flycast pgbouncer connection that tends
  // to drop on long idle DDL.
  if (
    args.creditsOnly &&
    args.sceneWeightMin <= 0 &&
    (await tableExists(c, WS, "scope_a")) &&
    (await tableExists(c, WS, "scope_l"))
  ) {
    const a = await tableRowCount(c, WS, "scope_a");
    const l = await tableRowCount(c, WS, "scope_l");
    console.log(`  [scope] reusing scope_a (${a.toLocaleString()}) + scope_l (${l.toLocaleString()}) for credits-only mode`);
    return;
  }

  // Otherwise rebuild — closures depend on post-prune scope_m / scope_r.
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

// ===========================================================================
// PHASE 5 — credit + remix extraction (added 2026-04)
// ===========================================================================
// Two scoping rules (see docs/credit-and-remix-extraction-plan.md):
//   - Rule A (master_track_credits + master_release_credits): credits on
//     tracks/releases that belong to a master in scope_m.
//   - Rule B (cross_scope_credits): credits where the credited artist is in
//     scope_a but the host release is NOT in scope_r — terminal cards that
//     link out to Discogs.
//   - Optional: artist_group_members for the small slice of edges where
//     both ends are scope artists.
//
// Role normalisation runs in SQL via a CASE expression; role_raw preserves
// the original Discogs string so we can re-bucket later without re-extracting.
// All four phases write into scope_workspace.scope_* persistent tables so
// they're crash-resumable in the same way the catalogue phases are.
// ---------------------------------------------------------------------------

const ROLE_NORMALISE_SQL = `
  CASE
    WHEN role IS NULL OR btrim(role) = '' THEN 'Other'
    WHEN role ~* '(^|[^a-z])edit($|[^a-z])'              THEN 'Edit'
    WHEN role ~* '(^|[^a-z])dub($|[^a-z])|dub mix'       THEN 'Dub'
    WHEN role ~* '^remix|remixer|re-?mix'                THEN 'Remix'
    WHEN role ~* 'co-?produced|additional production|associate producer' THEN 'Additional Production'
    WHEN role ~* '^produced by|^producer|^production'    THEN 'Producer'
    WHEN role ~* 'mastered by|^master( |$)|mastering'    THEN 'Mastered By'
    WHEN role ~* '^mix|^mixed by|^mixing|mix engineer'   THEN 'Mixed By'
    WHEN role ~* 'engineer|recorded by|recording|programmed by' THEN 'Engineer'
    WHEN role ~* 'written by|writer|composer|composed by|words by|lyrics by' THEN 'Written By'
    WHEN role ~* 'vocals?|featuring|^feat|^ft\\.|sung by|backing vocals' THEN 'Vocals'
    ELSE 'Other'
  END
`;

interface CreditOpts {
  ruleAEnabled: boolean;
  ruleATrackCredits: boolean;
  ruleAReleaseCredits: boolean;
  ruleARoleAllowlist: string[];
  ruleBEnabled: boolean;
  ruleBRoleAllowlist: string[];
  groupMembersEnabled: boolean;
}

function resolveCreditOpts(args: Args): CreditOpts {
  const c = args.manifest?.credits;
  return {
    ruleAEnabled: c?.rule_a?.enabled !== false,
    ruleATrackCredits: c?.rule_a?.track_credits !== false,
    ruleAReleaseCredits: c?.rule_a?.release_credits !== false,
    ruleARoleAllowlist: c?.rule_a?.role_allowlist ?? DEFAULT_RULE_A_ROLES,
    ruleBEnabled: c?.rule_b?.enabled !== false,
    ruleBRoleAllowlist: c?.rule_b?.role_allowlist ?? DEFAULT_RULE_B_ROLES,
    groupMembersEnabled: c?.group_members?.enabled !== false,
  };
}

// ---------------------------------------------------------------------------
// Phase 5a: Rule A track-level credits
// ---------------------------------------------------------------------------
async function buildMasterTrackCredits(
  c: Kysely<Database>,
  batchId: string,
  opts: CreditOpts,
) {
  if (await tableExists(c, WS, "scope_master_track_credits")) {
    const n = await tableRowCount(c, WS, "scope_master_track_credits");
    console.log(`[build-credits] reusing ${WS}.scope_master_track_credits (${n.toLocaleString()} rows)`);
    return;
  }
  console.log("[build-credits] phase 5a: master_track_credits (Rule A, track-level)...");
  const t0 = Date.now();

  // Walk: scope_m -> canonical release -> tracks -> track_credits.
  // We use the canonical release as the source so per-track credits line up
  // 1:1 with catalog.master_tracks rows that the slim model already ships.
  await sql`
    CREATE TABLE scope_master_track_credits AS
    SELECT
      cr.master_discogs_id                          AS master_discogs_id,
      COALESCE(t.track_number, t.position::text)    AS track_position,
      t.title                                       AS track_title,
      tc.artist_discogs_id                          AS artist_discogs_id,
      tc.artist_name                                AS artist_name,
      tc.anv                                        AS anv,
      ${sql.raw(ROLE_NORMALISE_SQL.replace(/\brole\b/g, "tc.role"))} AS role,
      tc.role                                       AS role_raw,
      cr.release_discogs_id                         AS source_release_id
    FROM scope_m_canonical_release cr
    JOIN catalog.tracks t
      ON t.release_discogs_id = cr.release_discogs_id
      AND t.batch_id = ${batchId}::uuid
    JOIN catalog.track_credits tc
      ON tc.track_id = t.id
      AND tc.batch_id = ${batchId}::uuid
    WHERE tc.role IS NOT NULL AND btrim(tc.role) <> ''
      AND tc.artist_discogs_id IS NOT NULL
  `.execute(c);

  // Filter to allowlisted (post-normalisation) roles
  await sql`
    DELETE FROM scope_master_track_credits
    WHERE role NOT IN (${sql.join(opts.ruleARoleAllowlist.map((r) => sql.lit(r)))})
  `.execute(c);

  // De-dup (same artist on same track in same role only once)
  await sql`
    DELETE FROM scope_master_track_credits a
    USING scope_master_track_credits b
    WHERE a.ctid > b.ctid
      AND a.master_discogs_id = b.master_discogs_id
      AND COALESCE(a.track_position, '') = COALESCE(b.track_position, '')
      AND a.artist_discogs_id = b.artist_discogs_id
      AND a.role = b.role
  `.execute(c);

  await sql`CREATE INDEX ON scope_master_track_credits (master_discogs_id)`.execute(c);
  await sql`CREATE INDEX ON scope_master_track_credits (artist_discogs_id, role)`.execute(c);
  await sql`ANALYZE scope_master_track_credits`.execute(c);

  const n = await tableRowCount(c, WS, "scope_master_track_credits");
  console.log(`[build-credits] master_track_credits: ${n.toLocaleString()} rows in ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------------------
// Phase 5b: Rule A release-level credits (Mastered By, Cover Art, A&R, etc.)
// ---------------------------------------------------------------------------
async function buildMasterReleaseCredits(
  c: Kysely<Database>,
  batchId: string,
  opts: CreditOpts,
) {
  if (await tableExists(c, WS, "scope_master_release_credits")) {
    const n = await tableRowCount(c, WS, "scope_master_release_credits");
    console.log(`[build-credits] reusing ${WS}.scope_master_release_credits (${n.toLocaleString()} rows)`);
    return;
  }
  console.log("[build-credits] phase 5b: master_release_credits (Rule A, release-level)...");
  const t0 = Date.now();

  // Source: catalog.release_credits attached to the canonical release of each
  // in-scope master. We pin to the canonical release rather than every in-scope
  // pressing because release-level credits (mastered by, designed by, A&R,
  // etc.) repeat across reissues and we don't want N-fold duplication.
  await sql`
    CREATE TABLE scope_master_release_credits AS
    SELECT
      cr.master_discogs_id                          AS master_discogs_id,
      cr.release_discogs_id                         AS source_release_id,
      rc.artist_discogs_id                          AS artist_discogs_id,
      rc.artist_name                                AS artist_name,
      rc.anv                                        AS anv,
      ${sql.raw(ROLE_NORMALISE_SQL.replace(/\brole\b/g, "rc.role"))} AS role,
      rc.role                                       AS role_raw
    FROM scope_m_canonical_release cr
    JOIN catalog.release_credits rc
      ON rc.release_discogs_id = cr.release_discogs_id
      AND rc.batch_id = ${batchId}::uuid
    WHERE rc.role IS NOT NULL AND btrim(rc.role) <> ''
      AND rc.artist_discogs_id IS NOT NULL
  `.execute(c);

  await sql`
    DELETE FROM scope_master_release_credits
    WHERE role NOT IN (${sql.join(opts.ruleARoleAllowlist.map((r) => sql.lit(r)))})
  `.execute(c);

  await sql`
    DELETE FROM scope_master_release_credits a
    USING scope_master_release_credits b
    WHERE a.ctid > b.ctid
      AND a.master_discogs_id = b.master_discogs_id
      AND a.source_release_id = b.source_release_id
      AND a.artist_discogs_id = b.artist_discogs_id
      AND a.role = b.role
  `.execute(c);

  await sql`CREATE INDEX ON scope_master_release_credits (master_discogs_id)`.execute(c);
  await sql`CREATE INDEX ON scope_master_release_credits (artist_discogs_id, role)`.execute(c);
  await sql`ANALYZE scope_master_release_credits`.execute(c);

  const n = await tableRowCount(c, WS, "scope_master_release_credits");
  console.log(`[build-credits] master_release_credits: ${n.toLocaleString()} rows in ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------------------
// Phase 5c: Rule B — cross-scope credits
// ---------------------------------------------------------------------------
// "MAW remixed Madonna." Madonna's release isn't in scope_r, but MAW is in
// scope_a. We want a TERMINAL card on MAW's artist page that links out.
// We pull both track-level and release-level credits via UNION, then enrich
// with the host release's title/year/label/primary artist for nice display.
async function buildCrossScopeCredits(
  c: Kysely<Database>,
  batchId: string,
  opts: CreditOpts,
) {
  if (await tableExists(c, WS, "scope_cross_scope_credits")) {
    const n = await tableRowCount(c, WS, "scope_cross_scope_credits");
    console.log(`[build-credits] reusing ${WS}.scope_cross_scope_credits (${n.toLocaleString()} rows)`);
    return;
  }
  console.log("[build-credits] phase 5c: cross_scope_credits (Rule B)...");
  const t0 = Date.now();

  // Step 1: collect raw cross-scope rows. Track-level + release-level UNIONed.
  // We restrict to host releases NOT in scope_r (the cross-scope predicate).
  // NOTE: ON COMMIT DROP cannot be used here because each Kysely statement
  // runs in its own implicit transaction on the pinned connection; the temp
  // would vanish before the DELETE / INSERT steps run. We drop manually at the end.
  await sql`DROP TABLE IF EXISTS _csc_raw`.execute(c);
  await sql`
    CREATE TEMP TABLE _csc_raw AS
    -- track-level: MAW credited as Remix on track X of Madonna release Y
    SELECT
      tc.artist_discogs_id    AS artist_discogs_id,
      tc.artist_name          AS artist_name,
      tc.anv                  AS anv,
      ${sql.raw(ROLE_NORMALISE_SQL.replace(/\brole\b/g, "tc.role"))} AS role,
      tc.role                 AS role_raw,
      r.discogs_id            AS host_release_id,
      COALESCE(t.track_number, t.position::text) AS track_position,
      t.title                 AS track_title
    FROM catalog.track_credits tc
    JOIN catalog.tracks t
      ON t.id = tc.track_id
      AND t.batch_id = tc.batch_id
    JOIN catalog.releases r
      ON r.discogs_id = t.release_discogs_id
      AND r.batch_id = t.batch_id
    WHERE tc.batch_id = ${batchId}::uuid
      AND tc.artist_discogs_id IS NOT NULL
      AND tc.artist_discogs_id IN (SELECT discogs_id FROM scope_a)
      AND r.discogs_id NOT IN (SELECT discogs_id FROM scope_r)
      AND tc.role IS NOT NULL AND btrim(tc.role) <> ''
    UNION ALL
    -- release-level: MAW credited as Mixed By on a non-scope release
    SELECT
      rc.artist_discogs_id    AS artist_discogs_id,
      rc.artist_name          AS artist_name,
      rc.anv                  AS anv,
      ${sql.raw(ROLE_NORMALISE_SQL.replace(/\brole\b/g, "rc.role"))} AS role,
      rc.role                 AS role_raw,
      rc.release_discogs_id   AS host_release_id,
      NULL::text              AS track_position,
      NULL::text              AS track_title
    FROM catalog.release_credits rc
    WHERE rc.batch_id = ${batchId}::uuid
      AND rc.artist_discogs_id IS NOT NULL
      AND rc.artist_discogs_id IN (SELECT discogs_id FROM scope_a)
      AND rc.release_discogs_id NOT IN (SELECT discogs_id FROM scope_r)
      AND rc.role IS NOT NULL AND btrim(rc.role) <> ''
  `.execute(c);

  // Filter to allowlisted roles (much smaller B allowlist than A)
  await sql`
    DELETE FROM _csc_raw
    WHERE role NOT IN (${sql.join(opts.ruleBRoleAllowlist.map((r) => sql.lit(r)))})
  `.execute(c);

  // Step 2: enrich with host release metadata (title/year/label/primary artist)
  await sql`
    CREATE TABLE scope_cross_scope_credits AS
    SELECT
      raw.artist_discogs_id,
      raw.artist_name,
      raw.anv,
      raw.role,
      raw.role_raw,
      raw.host_release_id,
      r.title                     AS host_release_title,
      r.release_year              AS host_release_year,
      (SELECT ra.artist_name
         FROM catalog.release_artists ra
         WHERE ra.batch_id = ${batchId}::uuid
           AND ra.release_discogs_id = raw.host_release_id
         ORDER BY ra.position ASC
         LIMIT 1)                 AS host_primary_artist_name,
      (SELECT rl.label_name
         FROM catalog.release_labels rl
         WHERE rl.batch_id = ${batchId}::uuid
           AND rl.release_discogs_id = raw.host_release_id
         ORDER BY rl.id ASC
         LIMIT 1)                 AS host_label_name,
      raw.track_position,
      raw.track_title
    FROM _csc_raw raw
    JOIN catalog.releases r
      ON r.discogs_id = raw.host_release_id
      AND r.batch_id = ${batchId}::uuid
  `.execute(c);

  // Drop unverified releases (out-of-scope by quality gate, e.g. spam)
  // Optional but keeps cross-scope honest about Discogs editorial state.
  await sql`
    DELETE FROM scope_cross_scope_credits
    USING enrich.entity_quality eq
    WHERE eq.entity_type = 'release'
      AND eq.discogs_id = scope_cross_scope_credits.host_release_id
      AND eq.quality_status <> 'active'
  `.execute(c);

  // De-dup
  await sql`
    DELETE FROM scope_cross_scope_credits a
    USING scope_cross_scope_credits b
    WHERE a.ctid > b.ctid
      AND a.artist_discogs_id = b.artist_discogs_id
      AND a.host_release_id = b.host_release_id
      AND COALESCE(a.track_position, '') = COALESCE(b.track_position, '')
      AND a.role = b.role
  `.execute(c);

  await sql`CREATE INDEX ON scope_cross_scope_credits (artist_discogs_id, role)`.execute(c);
  await sql`ANALYZE scope_cross_scope_credits`.execute(c);
  await sql`DROP TABLE IF EXISTS _csc_raw`.execute(c);

  const n = await tableRowCount(c, WS, "scope_cross_scope_credits");
  console.log(`[build-credits] cross_scope_credits: ${n.toLocaleString()} rows in ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------------------
// Phase 5d: artist group members (only edges where both ends are scope artists)
// ---------------------------------------------------------------------------
async function buildArtistGroupMembers(c: Kysely<Database>, batchId: string) {
  if (await tableExists(c, WS, "scope_artist_group_members")) {
    const n = await tableRowCount(c, WS, "scope_artist_group_members");
    console.log(`[build-credits] reusing ${WS}.scope_artist_group_members (${n.toLocaleString()} rows)`);
    return;
  }
  console.log("[build-credits] phase 5d: artist_group_members...");
  const t0 = Date.now();

  // catalog.artist_members:
  //   artist_discogs_id  -> the GROUP (e.g. UR)
  //   member_discogs_id  -> the MEMBER (e.g. Mike Banks)
  //
  // We only carry edges where BOTH ends are scope artists. Single-direction
  // (group -> member) is enough — UI can render "members" or "groups" from
  // the same edges.
  await sql`
    CREATE TABLE scope_artist_group_members AS
    SELECT DISTINCT
      am.artist_discogs_id  AS group_artist_id,
      am.member_discogs_id  AS member_artist_id
    FROM catalog.artist_members am
    WHERE am.batch_id = ${batchId}::uuid
      AND am.member_discogs_id IS NOT NULL
      AND am.artist_discogs_id <> am.member_discogs_id
      AND am.artist_discogs_id IN (SELECT discogs_id FROM scope_a)
      AND am.member_discogs_id IN (SELECT discogs_id FROM scope_a)
  `.execute(c);

  await sql`CREATE UNIQUE INDEX ON scope_artist_group_members (group_artist_id, member_artist_id)`.execute(c);
  await sql`CREATE INDEX ON scope_artist_group_members (member_artist_id)`.execute(c);
  await sql`ANALYZE scope_artist_group_members`.execute(c);

  const n = await tableRowCount(c, WS, "scope_artist_group_members");
  console.log(`[build-credits] artist_group_members: ${n.toLocaleString()} rows in ${Date.now() - t0}ms`);
}

// Drives the four phases above (with reset support).
async function runCreditPhases(
  c: Kysely<Database>,
  batchId: string,
  args: Args,
): Promise<{ opts: CreditOpts; counts: Record<string, number> }> {
  const opts = resolveCreditOpts(args);
  console.log(
    `[build-credits] credit opts: ruleA=${opts.ruleAEnabled} ` +
    `(track=${opts.ruleATrackCredits} release=${opts.ruleAReleaseCredits}) ` +
    `ruleB=${opts.ruleBEnabled} groupMembers=${opts.groupMembersEnabled}`,
  );

  if (args.reset) {
    for (const t of CREDIT_TABLES) {
      await sql.raw(`DROP TABLE IF EXISTS ${WS}.${t}`).execute(c);
    }
  }

  if (opts.ruleAEnabled && opts.ruleATrackCredits) {
    await buildMasterTrackCredits(c, batchId, opts);
  }
  if (opts.ruleAEnabled && opts.ruleAReleaseCredits) {
    await buildMasterReleaseCredits(c, batchId, opts);
  }
  if (opts.ruleBEnabled) {
    await buildCrossScopeCredits(c, batchId, opts);
  }
  if (opts.groupMembersEnabled) {
    await buildArtistGroupMembers(c, batchId);
  }

  const counts: Record<string, number> = {};
  for (const t of CREDIT_TABLES) {
    if (await tableExists(c, WS, t)) {
      counts[t] = await tableRowCount(c, WS, t);
    }
  }
  return { opts, counts };
}

const CREDIT_TABLES = [
  "scope_master_track_credits",
  "scope_master_release_credits",
  "scope_cross_scope_credits",
  "scope_artist_group_members",
] as const;

// ---------------------------------------------------------------------------
// Counts (used in dry-run + audit row)
// ---------------------------------------------------------------------------
async function collectScopeCounts(c: Kysely<Database>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of ["scope_a", "scope_l", "scope_m", "scope_r"]) {
    try {
      const r = await sql<{ count: number }>`SELECT COUNT(*)::int AS count FROM ${sql.raw(t)}`.execute(c);
      out[t] = r.rows[0]?.count ?? 0;
    } catch (err) {
      if (!streamPool) throw err;
      const r = await streamExec<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM scope_workspace.${t}`,
        { quiet: true },
      );
      out[t] = r.rows[0]?.count ?? 0;
    }
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
  currentOut = out;
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

  // Credit layer (only present when phases 5a-5d ran). Idempotent: dump
  // functions no-op if the workspace tables don't exist.
  await dumpMasterTrackCredits(c, writeLine);
  await dumpMasterReleaseCredits(c, writeLine);
  await dumpCrossScopeCredits(c, writeLine);
  await dumpArtistGroupMembers(c, writeLine);

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
  const q = `
    SELECT
      m.id, m.discogs_id, m.title, m.main_release_discogs_id, m.year, m.data_quality, m.batch_id,
      d.primary_artist_discogs_id, d.primary_artist_name, d.artists_credit_text,
      d.primary_label_discogs_id, d.primary_label_name,
      d.primary_country, d.primary_format,
      d.genres, d.styles, d.scene_weight,
      m.created_at, m.updated_at
    FROM catalog.masters m
    JOIN scope_m_denorm d ON d.discogs_id = m.discogs_id
    WHERE m.batch_id = '${batchId}'::uuid
      AND m.discogs_id IN (SELECT discogs_id FROM scope_m)
  `;
  const n = await streamQueryToInserts(c, q, "catalog.masters", cols, writeLine);
  console.log(`  [dump] catalog.masters: ${n.toLocaleString()} rows`);
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
  const q = `
    SELECT
      a.id, a.discogs_id, a.name, a.real_name, a.profile, a.data_quality, a.batch_id,
      COALESCE(
        (SELECT array_agg(DISTINCT al.alias_name ORDER BY al.alias_name)
         FROM catalog.artist_aliases al
         WHERE al.batch_id = '${batchId}'::uuid
           AND al.artist_discogs_id = a.discogs_id),
        '{}'::text[]
      ) AS aliases_text,
      a.created_at, a.updated_at
    FROM catalog.artists a
    WHERE a.batch_id = '${batchId}'::uuid
      AND a.discogs_id IN (SELECT discogs_id FROM scope_a)
  `;
  const n = await streamQueryToInserts(c, q, "catalog.artists", cols, writeLine);
  console.log(`  [dump] catalog.artists: ${n.toLocaleString()} rows`);
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
  const q = `
    SELECT
      l.id, l.discogs_id, l.name, l.profile, l.contact_info, l.data_quality,
      l.parent_label_discogs_id, l.batch_id,
      '{}'::text[] AS aliases_text,
      l.created_at, l.updated_at
    FROM catalog.labels l
    WHERE l.batch_id = '${batchId}'::uuid
      AND (
        l.discogs_id IN (SELECT discogs_id FROM scope_l)
        OR l.discogs_id IN (
          SELECT parent_label_discogs_id
          FROM catalog.labels
          WHERE batch_id = '${batchId}'::uuid
            AND parent_label_discogs_id IS NOT NULL
            AND discogs_id IN (SELECT discogs_id FROM scope_l)
        )
      )
  `;
  const n = await streamQueryToInserts(c, q, "catalog.labels", cols, writeLine);
  console.log(`  [dump] catalog.labels: ${n.toLocaleString()} rows`);
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
  const q = `
    SELECT
      cr.master_discogs_id,
      COALESCE(t.track_number, t.position::text) AS position,
      t.title,
      t.duration_seconds,
      (SELECT string_agg(DISTINCT tc.artist_name, ', ' ORDER BY tc.artist_name)
       FROM catalog.track_credits tc
       WHERE tc.batch_id = '${batchId}'::uuid
         AND tc.track_id = t.id) AS artists_text,
      cr.release_discogs_id AS source_release_discogs_id
    FROM scope_m_canonical_release cr
    JOIN catalog.tracks t
      ON t.release_discogs_id = cr.release_discogs_id
      AND t.batch_id = '${batchId}'::uuid
    WHERE cr.release_discogs_id IS NOT NULL
      AND t.title IS NOT NULL
    ORDER BY cr.master_discogs_id, t.position
  `;
  const n = await streamQueryToInserts(c, q, "catalog.master_tracks", cols, writeLine);
  console.log(`  [dump] catalog.master_tracks: ${n.toLocaleString()} rows`);
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
  const q = `
    SELECT
      mv.master_discogs_id,
      'master'::text AS source_type,
      NULL::integer AS source_release_discogs_id,
      mv.url,
      mv.title,
      mv.duration_seconds,
      NULL::text AS discogs_release_url
    FROM catalog.master_videos mv
    WHERE mv.batch_id = '${batchId}'::uuid
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
    WHERE rv.batch_id = '${batchId}'::uuid
      AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
      AND r.master_discogs_id IS NOT NULL
      AND r.master_discogs_id > 0
      AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
  `;
  const n = await streamQueryToInserts(c, q, "catalog.master_videos_unified", cols, writeLine);
  console.log(`  [dump] catalog.master_videos_unified: ${n.toLocaleString()} rows`);
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
  const q = `
    SELECT
      r.discogs_id AS release_discogs_id,
      r.master_discogs_id,
      r.title,
      r.release_year,
      r.country,
      (SELECT label_name FROM catalog.release_labels rl
       WHERE rl.batch_id = '${batchId}'::uuid
         AND rl.release_discogs_id = r.discogs_id
       ORDER BY rl.id ASC LIMIT 1) AS label,
      (SELECT name FROM catalog.release_formats rf
       WHERE rf.batch_id = '${batchId}'::uuid
         AND rf.release_discogs_id = r.discogs_id
       ORDER BY rf.position ASC LIMIT 1) AS format,
      COALESCE(r.is_main_release, false) AS is_main_release,
      false AS has_tracklist_delta,
      EXISTS (
        SELECT 1 FROM catalog.release_styles rs
        WHERE rs.batch_id = '${batchId}'::uuid
          AND rs.release_discogs_id = r.discogs_id
          AND rs.style ILIKE '%remix%'
      ) AS has_remix_signal,
      ('https://www.discogs.com/release/' || r.discogs_id::text) AS discogs_url
    FROM catalog.releases r
    WHERE r.batch_id = '${batchId}'::uuid
      AND r.discogs_id IN (SELECT discogs_id FROM scope_r)
      AND r.master_discogs_id IN (SELECT discogs_id FROM scope_m)
  `;
  const n = await streamQueryToInserts(c, q, "catalog.release_shadow", cols, writeLine);
  console.log(`  [dump] catalog.release_shadow: ${n.toLocaleString()} rows`);
}

// ---------------------------------------------------------------------------
// Credit-layer dump functions (added 2026-04). Each dumps from the
// scope_workspace.scope_* table built in runCreditPhases().
// ---------------------------------------------------------------------------
async function dumpMasterTrackCredits(
  c: Kysely<Database>,
  writeLine: (s: string) => Promise<void>,
) {
  if (!(await tableExists(c, WS, "scope_master_track_credits"))) return;
  await writeLine("-- catalog.master_track_credits (Rule A, track-level)");
  const cols = [
    "master_discogs_id", "track_position", "track_title",
    "artist_discogs_id", "artist_name", "anv",
    "role", "role_raw", "source_release_id",
  ];
  console.log(`  [dump] catalog.master_track_credits`);
  const q = `SELECT ${cols.join(", ")} FROM scope_master_track_credits`;
  const n = await streamQueryToInserts(c, q, "catalog.master_track_credits", cols, writeLine);
  console.log(`  [dump] catalog.master_track_credits: ${n.toLocaleString()} rows`);
}

async function dumpMasterReleaseCredits(
  c: Kysely<Database>,
  writeLine: (s: string) => Promise<void>,
) {
  if (!(await tableExists(c, WS, "scope_master_release_credits"))) return;
  await writeLine("-- catalog.master_release_credits (Rule A, release-level)");
  const cols = [
    "master_discogs_id", "source_release_id",
    "artist_discogs_id", "artist_name", "anv",
    "role", "role_raw",
  ];
  console.log(`  [dump] catalog.master_release_credits`);
  const q = `SELECT ${cols.join(", ")} FROM scope_master_release_credits`;
  const n = await streamQueryToInserts(c, q, "catalog.master_release_credits", cols, writeLine);
  console.log(`  [dump] catalog.master_release_credits: ${n.toLocaleString()} rows`);
}

async function dumpCrossScopeCredits(
  c: Kysely<Database>,
  writeLine: (s: string) => Promise<void>,
) {
  if (!(await tableExists(c, WS, "scope_cross_scope_credits"))) return;
  await writeLine("-- catalog.cross_scope_credits (Rule B)");
  const cols = [
    "artist_discogs_id", "artist_name", "anv",
    "role", "role_raw",
    "host_release_id", "host_release_title", "host_release_year",
    "host_primary_artist_name", "host_label_name",
    "track_position", "track_title",
  ];
  console.log(`  [dump] catalog.cross_scope_credits`);
  const q = `SELECT ${cols.join(", ")} FROM scope_cross_scope_credits`;
  const n = await streamQueryToInserts(c, q, "catalog.cross_scope_credits", cols, writeLine);
  console.log(`  [dump] catalog.cross_scope_credits: ${n.toLocaleString()} rows`);
}

async function dumpArtistGroupMembers(
  c: Kysely<Database>,
  writeLine: (s: string) => Promise<void>,
) {
  if (!(await tableExists(c, WS, "scope_artist_group_members"))) return;
  await writeLine("-- catalog.artist_group_members");
  const cols = ["group_artist_id", "member_artist_id"];
  console.log(`  [dump] catalog.artist_group_members`);
  const q = `SELECT ${cols.join(", ")} FROM scope_artist_group_members`;
  const n = await streamQueryToInserts(c, q, "catalog.artist_group_members", cols, writeLine);
  console.log(`  [dump] catalog.artist_group_members: ${n.toLocaleString()} rows`);
}

// ---------------------------------------------------------------------------
// Credit-only dump path: writes a slim SQL file containing ONLY the new
// credit tables (truncate-then-insert). Used to ship credits to a scoped DB
// that already has the rest of the catalogue.
// ---------------------------------------------------------------------------
async function dumpCreditsOnly(
  c: Kysely<Database>,
  args: Args,
  manifest: ScopeManifest | null,
  batchId: string,
): Promise<{ output: string; counts: Record<string, number> }> {
  mkdirSync(dirname(args.output), { recursive: true });
  const out: WriteStream = createWriteStream(args.output, { encoding: "utf8" });
  currentOut = out;
  const writeLine = (line: string) => new Promise<void>((res) => out.write(line + "\n", () => res()));

  await writeLine("-- credit-layer-only build (delta into existing scoped DB)");
  await writeLine(`-- manifest: ${manifest?.id ?? "(none)"} v${manifest?.version ?? "?"}`);
  await writeLine("SET session_replication_role = 'replica';");
  await writeLine("BEGIN;");

  // Truncate first — credits are FULLY REPLACED on each delta build. The
  // tables are derived; we don't merge or upsert.
  await writeLine("TRUNCATE catalog.master_track_credits RESTART IDENTITY;");
  await writeLine("TRUNCATE catalog.master_release_credits RESTART IDENTITY;");
  await writeLine("TRUNCATE catalog.cross_scope_credits RESTART IDENTITY;");
  await writeLine("TRUNCATE catalog.artist_group_members;");

  await dumpMasterTrackCredits(c, writeLine);
  await dumpMasterReleaseCredits(c, writeLine);
  await dumpCrossScopeCredits(c, writeLine);
  await dumpArtistGroupMembers(c, writeLine);

  // Audit row
  const counts: Record<string, number> = {};
  for (const t of CREDIT_TABLES) {
    if (await tableExists(c, WS, t)) {
      counts[t] = await tableRowCount(c, WS, t);
    }
  }
  const auditCounts = {
    track_credits: counts["scope_master_track_credits"] ?? 0,
    release_credits: counts["scope_master_release_credits"] ?? 0,
    cross_scope: counts["scope_cross_scope_credits"] ?? 0,
    group_members: counts["scope_artist_group_members"] ?? 0,
  };
  const opts = resolveCreditOpts(args);
  const roleVocab = {
    rule_a: opts.ruleARoleAllowlist,
    rule_b: opts.ruleBRoleAllowlist,
  };
  await writeLine(
    `INSERT INTO enrich.credit_build_audit ` +
    `(manifest_id, manifest_version, source_batch_id, ` +
    `track_credits_count, release_credits_count, cross_scope_count, group_member_count, ` +
    `role_vocab, notes) VALUES (` +
    `${pgVal(manifest?.id ?? "ad-hoc")}, ${pgVal(manifest?.version ?? null)}, ` +
    `${pgVal(batchId)}::uuid, ` +
    `${auditCounts.track_credits}, ${auditCounts.release_credits}, ` +
    `${auditCounts.cross_scope}, ${auditCounts.group_members}, ` +
    `${pgVal(roleVocab)}, ` +
    `'credits-only delta build via scripts/build-scoped-db.ts');`,
  );

  await writeLine("COMMIT;");
  await writeLine("SET session_replication_role = 'origin';");
  await new Promise<void>((res) => out.end(res));

  return { output: args.output, counts };
}

async function dumpTable(
  c: Kysely<Database>,
  table: string,
  writeLine: (s: string) => Promise<void>,
) {
  const cols = await getColumns(c, table);
  console.log(`  [dump] ${table}`);
  await writeLine(`-- ${table}`);

  // Fast path for enrich.entity_quality: if a pre-materialized slim table
  // exists in scope_workspace, read from it directly. The slim table is
  // created by /tmp/prematerialize-eq.sql as a UNION ALL of 4 joins against
  // scope_a / scope_l / scope_m / scope_r, which is orders of magnitude
  // faster than the naive 4x OR'd IN-subselect path (which stalled at a few
  // rows/sec on 4.6M row source). Slim table has the same column shape, so
  // we stream straight from it.
  if (
    table === "enrich.entity_quality" &&
    (await tableExists(c, WS, "scope_entity_quality_slim"))
  ) {
    console.log(`  [dump] ${table}: using scope_workspace.scope_entity_quality_slim fast path`);
    const q = `SELECT ${cols.join(", ")} FROM scope_workspace.scope_entity_quality_slim`;
    const n = await streamQueryToInserts(c, q, table, cols, writeLine);
    console.log(`  [dump] ${table}: ${n.toLocaleString()} rows`);
    return;
  }

  const where = whereClauseFor(table);
  const q = `SELECT ${cols.join(", ")} FROM ${table} WHERE ${where}`;
  const n = await streamQueryToInserts(c, q, table, cols, writeLine);
  console.log(`  [dump] ${table}: ${n.toLocaleString()} rows`);
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

// Stream a SELECT to INSERT statements using materialized keyset pagination.
// Approach: wrap the user's query in a CTE, materialize it into a TEMP table
// with a synthetic rownum, then page through it with WHERE rownum BETWEEN.
// This avoids server-side cursors (which had hang issues against Kysely/pg)
// and avoids buffering the full result set in JS.
// Stream a SELECT result into the output dump as a COPY FROM stdin block.
// Uses a psql subprocess to execute COPY ... TO STDOUT and pipes its output
// directly into our WriteStream. This bypasses pg-node driver row buffering
// (which was hanging indefinitely on larger batches) and avoids the per-batch
// pagination entirely — psql streams the whole table in one go.
async function streamQueryToInserts(
  _c: Kysely<Database>,
  rawSelect: string,
  destTable: string,
  cols: string[],
  writeLine: (s: string) => Promise<void>,
  _batchSize = 2000,
): Promise<number> {
  const sourceUrl = process.env.SOURCE_DATABASE_URL;
  if (!sourceUrl) throw new Error("SOURCE_DATABASE_URL not set");
  const colList = cols.join(", ");

  const t0 = Date.now();
  console.log(`    [copy] ${destTable}: launching psql COPY TO STDOUT`);
  await writeLine(`-- COPY data for ${destTable}`);
  await writeLine(`COPY ${destTable} (${colList}) FROM stdin;`);

  // COPY (subquery) TO STDOUT: stream text-format output. Tabs separate
  // columns, \N is NULL. psql on import reads the same format natively.
  const copySql = `COPY (${rawSelect}) TO STDOUT WITH (FORMAT text)`;

  return await new Promise<number>((resolve, reject) => {
    let rows = 0;
    let lastLog = Date.now();
    let totalBytes = 0;

    const child = spawn(
      "psql",
      [
        sourceUrl,
        "-v", "ON_ERROR_STOP=1",
        "-X",
        "-q",
        "-c", "SET statement_timeout = 0",
        "-c", "SET idle_in_transaction_session_timeout = 0",
        "-c", "SET search_path TO scope_workspace, public",
        "-c", copySql,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stderr = "";
    if (!currentOut) {
      reject(new Error("currentOut not set"));
      return;
    }
    const writer = currentOut;

    // Backpressure: if writer can't keep up, pause the child's stdout.
    child.stdout.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === 10) rows++;
      }
      const ok = writer.write(chunk);
      if (!ok) {
        child.stdout.pause();
        writer.once("drain", () => child.stdout.resume());
      }
      if (Date.now() - lastLog > 15_000) {
        console.log(
          `    [copy] ${destTable}: ${rows.toLocaleString()} rows, ` +
          `${Math.round(totalBytes / 1024 / 1024)}MB copied`,
        );
        lastLog = Date.now();
      }
    });

    child.stderr.on("data", (b: Buffer) => {
      stderr += b.toString("utf8");
    });

    let stdoutEnded = false;
    let exitCode: number | null = null;
    let settled = false;

    const finalize = async () => {
      if (settled || !stdoutEnded || exitCode === null) return;
      settled = true;
      try {
        if (exitCode !== 0) {
          reject(new Error(`psql COPY exited ${exitCode}: ${stderr.slice(0, 1000)}`));
          return;
        }
        await writeLine(`\\.`);
        await writeLine(``);
        const elapsed = Math.round((Date.now() - t0) / 1000);
        console.log(
          `    [copy] ${destTable}: done ${rows.toLocaleString()} rows ` +
          `${Math.round(totalBytes / 1024 / 1024)}MB in ${elapsed}s`,
        );
        resolve(rows);
      } catch (err) {
        reject(err);
      }
    };

    child.stdout.on("end", () => {
      stdoutEnded = true;
      finalize().catch(reject);
    });

    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      exitCode = code ?? 1;
      finalize().catch(reject);
    });
  });
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

async function analyzeCreditTables(targetUrl: string) {
  console.log("  [target] ANALYZE on credit tables");
  const analyzeSql = `
    SET statement_timeout = '15min';
    VACUUM ANALYZE catalog.master_track_credits;
    VACUUM ANALYZE catalog.master_release_credits;
    VACUUM ANALYZE catalog.cross_scope_credits;
    VACUUM ANALYZE catalog.artist_group_members;
  `;
  const result = spawnSync("psql", [targetUrl, "-v", "ON_ERROR_STOP=1", "-c", analyzeSql], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`analyzeCreditTables failed (exit ${result.status})`);
  }
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
  streamPool = new pg.Pool({
    connectionString: sourceUrl,
    max: 4,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 30_000,
    statement_timeout: 240 * 60 * 1000,
  });
  streamPool.on("error", (err) => {
    console.log(`  [stream-pool] idle client error: ${err.message}`);
  });
  try {
    const batchId = await resolveBatchId(source, args.batchIdOverride);
    if (args.manifest) {
      console.log(
        `[build-scope] manifest=${args.manifest.id} v${args.manifest.version}` +
        (args.manifest.description ? ` (${args.manifest.description})` : ""),
      );
    }
    console.log(
      `[build-scope] source batch_id=${batchId} year=${args.yearMin}-${args.yearMax} ` +
      `quality=${args.qualityActiveOnly} breakbeat-gate=${args.breakbeatYearGate} ` +
      `weight-min=${args.sceneWeightMin} histogram=${args.histogram} ` +
      `credits-only=${args.creditsOnly} skip-credits=${args.skipCredits}`,
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

      // Credits-only path: skip phase 4 (denorms — already in scoped DB),
      // skip the standard dump, run the new credit phases, and emit a slim
      // credits-only SQL file.
      if (args.creditsOnly) {
        console.log("[build-scope] CREDITS-ONLY mode: skipping phases 4 + standard dump");
        console.log("[build-credits] phase 5*: running credit-extraction phases...");
        const { counts: creditCounts } = await runCreditPhases(c, batchId, args);
        console.log("[build-credits] credit counts:", creditCounts);

        if (args.dryRun) {
          console.log("[build-scope] dry-run: not writing credit dump");
          return;
        }

        console.log(`[build-scope] writing credit-only dump to ${args.output}`);
        await dumpCreditsOnly(c, args, args.manifest, batchId);

        if (targetUrl) {
          console.log("[target] piping credit dump into target");
          await pipeIntoTarget(targetUrl, args.output);
          // No backfill needed: credit tables have no search_vector / no derived
          // columns. We do ANALYZE so the planner uses the new rows.
          await analyzeCreditTables(targetUrl);
        }
        console.log("[build-scope] credits-only done");
        return;
      }

      if (args.fromPhase <= 4) {
        console.log("[build-scope] phase 4: master denorms...");
        await buildMasterDenorms(c, batchId);
      } else {
        console.log(`[build-scope] phase 4: SKIPPED (--from-phase ${args.fromPhase})`);
      }

      const counts = await collectScopeCounts(c);
      console.log("[build-scope] scope counts:", counts);

      // Run credit phases unless explicitly disabled. Manifest gates them
      // via credits.enabled (default true).
      const creditsConfigured = args.manifest?.credits?.enabled !== false;
      if (!args.skipCredits && creditsConfigured) {
        console.log("[build-credits] phase 5*: running credit-extraction phases...");
        const { counts: creditCounts } = await runCreditPhases(c, batchId, args);
        console.log("[build-credits] credit counts:", creditCounts);
      } else {
        console.log("[build-credits] SKIPPED (--skip-credits or manifest.credits.enabled=false)");
      }

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
    if (streamPool) {
      try {
        await streamPool.end();
      } catch {
        // ignore
      }
      streamPool = null;
    }
  }
}

main().catch((err) => {
  console.error("[build-scope] fatal:", err);
  process.exit(1);
});
