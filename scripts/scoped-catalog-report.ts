/**
 * Estimate the size of a scene-scoped Dig catalog before cutover.
 *
 * Default profile:
 * - years: 1988-2002
 * - genres: House, Techno
 * - styles: common 90s house/techno substyles
 * - include all releases attached to in-scope masters
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm exec tsx scripts/scoped-catalog-report.ts
 *   DATABASE_URL=postgres://... pnpm exec tsx scripts/scoped-catalog-report.ts --year-min 1990 --year-max 1999
 *   DATABASE_URL=postgres://... pnpm exec tsx scripts/scoped-catalog-report.ts --genre House --genre Techno --style "Deep House"
 */

import { createDb, sql } from "@dig/db";
import { getBatchForTable } from "@dig/domain";

const DEFAULT_YEAR_MIN = 1988;
const DEFAULT_YEAR_MAX = 2002;
const DEFAULT_GENRES = ["House", "Techno"];
const DEFAULT_STYLES = [
  "Acid House",
  "Acid Techno",
  "Deep House",
  "Detroit Techno",
  "Dub Techno",
  "Garage House",
  "Hard House",
  "Minimal",
  "Minimal Techno",
  "Progressive House",
  "Tech House",
  "Techno",
  "Tribal House",
];

interface Args {
  yearMin: number;
  yearMax: number;
  genres: string[];
  styles: string[];
  includeMasterVersions: boolean;
}

function printHelp(): void {
  console.log(`
Usage:
  DATABASE_URL=postgres://... pnpm exec tsx scripts/scoped-catalog-report.ts [options]

Options:
  --year-min <n>              Lower release/master year bound. Default: ${DEFAULT_YEAR_MIN}
  --year-max <n>              Upper release/master year bound. Default: ${DEFAULT_YEAR_MAX}
  --genre <value>             Repeatable. Defaults to: ${DEFAULT_GENRES.join(", ")}
  --style <value>             Repeatable. Defaults to: ${DEFAULT_STYLES.join(", ")}
  --no-default-genres         Start with no default genres; only use explicit --genre values
  --no-default-styles         Start with no default styles; only use explicit --style values
  --exclude-master-versions   Keep only directly matched releases, not every version on matched masters
  --help                      Show this help
`);
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2).filter((arg) => arg !== "--");
  let yearMin = DEFAULT_YEAR_MIN;
  let yearMax = DEFAULT_YEAR_MAX;
  const genres: string[] = [];
  const styles: string[] = [];
  let useDefaultGenres = true;
  let useDefaultStyles = true;
  let includeMasterVersions = true;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--year-min" && args[i + 1]) {
      yearMin = parseInt(args[++i], 10);
      continue;
    }
    if (arg === "--year-max" && args[i + 1]) {
      yearMax = parseInt(args[++i], 10);
      continue;
    }
    if (arg === "--genre" && args[i + 1]) {
      genres.push(args[++i]);
      continue;
    }
    if (arg === "--style" && args[i + 1]) {
      styles.push(args[++i]);
      continue;
    }
    if (arg === "--no-default-genres") {
      useDefaultGenres = false;
      continue;
    }
    if (arg === "--no-default-styles") {
      useDefaultStyles = false;
      continue;
    }
    if (arg === "--exclude-master-versions") {
      includeMasterVersions = false;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    printHelp();
    process.exit(1);
  }

  if (Number.isNaN(yearMin) || Number.isNaN(yearMax) || yearMin > yearMax) {
    console.error("Invalid year range. Expected --year-min <= --year-max.");
    process.exit(1);
  }

  const finalGenres = genres.length > 0 ? genres : (useDefaultGenres ? DEFAULT_GENRES : []);
  const finalStyles = styles.length > 0 ? styles : (useDefaultStyles ? DEFAULT_STYLES : []);

  if (finalGenres.length === 0 && finalStyles.length === 0) {
    console.error("At least one genre or style is required.");
    process.exit(1);
  }

  return {
    yearMin,
    yearMax,
    genres: finalGenres,
    styles: finalStyles,
    includeMasterVersions,
  };
}

function textArray(values: string[]) {
  if (values.length === 0) {
    return sql`ARRAY[]::text[]`;
  }
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`))}]::text[]`;
}

async function countTable(db: any, table: string): Promise<number> {
  const result = await sql<{ count: number }>`
    SELECT COUNT(*)::int AS count
    FROM ${sql.table(table)}
  `.execute(db);
  return result.rows[0]?.count ?? 0;
}

async function countQuery(db: ReturnType<typeof createDb>, query: any): Promise<number> {
  const result = await query.execute(db);
  return (result.rows[0] as { count: number } | undefined)?.count ?? 0;
}

async function main() {
  const args = parseArgs(process.argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = createDb(databaseUrl);

  try {
    const { batchId, dumpDate } = await getBatchForTable(db, "catalog.releases");
    const genreArray = textArray(args.genres);
    const styleArray = textArray(args.styles);

    console.log("[scope] Building 90s house/techno scope report");
    console.log(`[scope] batch_id=${batchId} dump_date=${dumpDate}`);
    console.log(`[scope] years=${args.yearMin}-${args.yearMax}`);
    console.log(`[scope] genres=${args.genres.join(", ")}`);
    console.log(`[scope] styles=${args.styles.join(", ")}`);
    console.log(`[scope] include_master_versions=${args.includeMasterVersions}`);

    await db.connection().execute(async (conn) => {
      await sql`DROP TABLE IF EXISTS tmp_scope_matched_release_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_matched_master_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_seed_release_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_master_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_release_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_track_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_base_artist_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_artist_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_base_label_ids`.execute(conn);
      await sql`DROP TABLE IF EXISTS tmp_scope_label_ids`.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_matched_release_ids (
          discogs_id integer PRIMARY KEY
        )
      `.execute(conn);
      await sql`
        INSERT INTO tmp_scope_matched_release_ids (discogs_id)
        SELECT rg.release_discogs_id
        FROM catalog.release_genres rg
        WHERE rg.batch_id = ${batchId}
          AND rg.genre = ANY(${genreArray})
        ON CONFLICT (discogs_id) DO NOTHING
      `.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_matched_master_ids (
          discogs_id integer PRIMARY KEY
        )
      `.execute(conn);
      await sql`
        INSERT INTO tmp_scope_matched_master_ids (discogs_id)
        SELECT mg.master_discogs_id
        FROM catalog.master_genres mg
        WHERE mg.batch_id = ${batchId}
          AND mg.genre = ANY(${genreArray})
        ON CONFLICT (discogs_id) DO NOTHING
      `.execute(conn);
      for (const style of args.styles) {
        await sql`
          INSERT INTO tmp_scope_matched_release_ids (discogs_id)
          SELECT rs.release_discogs_id
          FROM catalog.release_styles rs
          WHERE rs.batch_id = ${batchId}
            AND rs.style = ${style}
          ON CONFLICT (discogs_id) DO NOTHING
        `.execute(conn);
      }
      for (const style of args.styles) {
        await sql`
          INSERT INTO tmp_scope_matched_master_ids (discogs_id)
          SELECT ms.master_discogs_id
          FROM catalog.master_styles ms
          WHERE ms.batch_id = ${batchId}
            AND ms.style = ${style}
          ON CONFLICT (discogs_id) DO NOTHING
        `.execute(conn);
      }

      await sql`
        CREATE TEMP TABLE tmp_scope_seed_release_ids AS
        SELECT DISTINCT scoped.discogs_id
        FROM (
          SELECT r.discogs_id
          FROM tmp_scope_matched_release_ids mr
          INNER JOIN catalog.releases r
            ON r.discogs_id = mr.discogs_id
           AND r.batch_id = ${batchId}
          LEFT JOIN catalog.masters m
            ON m.discogs_id = r.master_discogs_id
           AND m.batch_id = ${batchId}
          WHERE COALESCE(r.release_year, m.year) BETWEEN ${args.yearMin} AND ${args.yearMax}
          UNION
          SELECT r.discogs_id
          FROM tmp_scope_matched_master_ids mm
          INNER JOIN catalog.releases r
            ON r.master_discogs_id = mm.discogs_id
           AND r.batch_id = ${batchId}
          INNER JOIN catalog.masters m
            ON m.discogs_id = mm.discogs_id
           AND m.batch_id = ${batchId}
          WHERE COALESCE(r.release_year, m.year) BETWEEN ${args.yearMin} AND ${args.yearMax}
        ) scoped
      `.execute(conn);
      await sql`CREATE UNIQUE INDEX ON tmp_scope_seed_release_ids (discogs_id)`.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_master_ids AS
        SELECT DISTINCT master_discogs_id AS discogs_id
        FROM catalog.releases
        WHERE batch_id = ${batchId}
          AND master_discogs_id IS NOT NULL
          AND discogs_id IN (SELECT discogs_id FROM tmp_scope_seed_release_ids)
        UNION
        SELECT DISTINCT m.discogs_id
        FROM catalog.masters m
        INNER JOIN tmp_scope_matched_master_ids mm
          ON mm.discogs_id = m.discogs_id
        WHERE m.batch_id = ${batchId}
          AND m.year BETWEEN ${args.yearMin} AND ${args.yearMax}
      `.execute(conn);
      await sql`CREATE UNIQUE INDEX ON tmp_scope_master_ids (discogs_id)`.execute(conn);

      if (args.includeMasterVersions) {
        await sql`
          CREATE TEMP TABLE tmp_scope_release_ids AS
          SELECT DISTINCT scoped.discogs_id
          FROM (
            SELECT discogs_id
            FROM tmp_scope_seed_release_ids
            UNION
            SELECT r.discogs_id
            FROM tmp_scope_master_ids sm
            INNER JOIN catalog.releases r
              ON r.master_discogs_id = sm.discogs_id
             AND r.batch_id = ${batchId}
          ) scoped
        `.execute(conn);
      } else {
        await sql`
          CREATE TEMP TABLE tmp_scope_release_ids AS
          SELECT discogs_id
          FROM tmp_scope_seed_release_ids
        `.execute(conn);
      }
      await sql`CREATE UNIQUE INDEX ON tmp_scope_release_ids (discogs_id)`.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_track_ids AS
        SELECT DISTINCT t.id
        FROM catalog.tracks t
        WHERE t.batch_id = ${batchId}
          AND t.release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      `.execute(conn);
      await sql`CREATE UNIQUE INDEX ON tmp_scope_track_ids (id)`.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_base_artist_ids AS
        SELECT DISTINCT artist_discogs_id AS discogs_id
        FROM catalog.master_artists
        WHERE batch_id = ${batchId}
          AND master_discogs_id IN (SELECT discogs_id FROM tmp_scope_master_ids)
        UNION
        SELECT DISTINCT artist_discogs_id AS discogs_id
        FROM catalog.release_artists
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
        UNION
        SELECT DISTINCT artist_discogs_id AS discogs_id
        FROM catalog.release_credits
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
        UNION
        SELECT DISTINCT tc.artist_discogs_id AS discogs_id
        FROM catalog.track_credits tc
        INNER JOIN tmp_scope_track_ids st
          ON st.id = tc.track_id
        WHERE tc.batch_id = ${batchId}
      `.execute(conn);
      await sql`CREATE UNIQUE INDEX ON tmp_scope_base_artist_ids (discogs_id)`.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_artist_ids AS
        SELECT discogs_id
        FROM tmp_scope_base_artist_ids
        UNION
        SELECT DISTINCT alias_discogs_id AS discogs_id
        FROM catalog.artist_aliases
        WHERE batch_id = ${batchId}
          AND artist_discogs_id IN (SELECT discogs_id FROM tmp_scope_base_artist_ids)
          AND alias_discogs_id IS NOT NULL
        UNION
        SELECT DISTINCT member_discogs_id AS discogs_id
        FROM catalog.artist_members
        WHERE batch_id = ${batchId}
          AND artist_discogs_id IN (SELECT discogs_id FROM tmp_scope_base_artist_ids)
          AND member_discogs_id IS NOT NULL
        UNION
        SELECT DISTINCT group_discogs_id AS discogs_id
        FROM catalog.artist_groups
        WHERE batch_id = ${batchId}
          AND artist_discogs_id IN (SELECT discogs_id FROM tmp_scope_base_artist_ids)
          AND group_discogs_id IS NOT NULL
      `.execute(conn);
      await sql`CREATE UNIQUE INDEX ON tmp_scope_artist_ids (discogs_id)`.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_base_label_ids AS
        SELECT DISTINCT label_discogs_id AS discogs_id
        FROM catalog.release_labels
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
        UNION
        SELECT DISTINCT company_discogs_id AS discogs_id
        FROM catalog.release_companies
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
          AND company_discogs_id IS NOT NULL
      `.execute(conn);
      await sql`CREATE UNIQUE INDEX ON tmp_scope_base_label_ids (discogs_id)`.execute(conn);

      await sql`
        CREATE TEMP TABLE tmp_scope_label_ids AS
        SELECT discogs_id
        FROM tmp_scope_base_label_ids
        UNION
        SELECT DISTINCT parent_label_discogs_id AS discogs_id
        FROM catalog.labels
        WHERE batch_id = ${batchId}
          AND discogs_id IN (SELECT discogs_id FROM tmp_scope_base_label_ids)
          AND parent_label_discogs_id IS NOT NULL
      `.execute(conn);
      await sql`CREATE UNIQUE INDEX ON tmp_scope_label_ids (discogs_id)`.execute(conn);

      const entityQualityCounts = await Promise.all([
        countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM enrich.entity_quality
        WHERE entity_type = 'artist'
          AND discogs_id IN (SELECT discogs_id FROM tmp_scope_artist_ids)
      `),
        countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM enrich.entity_quality
        WHERE entity_type = 'label'
          AND discogs_id IN (SELECT discogs_id FROM tmp_scope_label_ids)
      `),
        countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM enrich.entity_quality
        WHERE entity_type = 'master'
          AND discogs_id IN (SELECT discogs_id FROM tmp_scope_master_ids)
      `),
        countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM enrich.entity_quality
        WHERE entity_type = 'release'
          AND discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      `),
      ]);

      const counts = {
        seed_releases: await countTable(conn, "tmp_scope_seed_release_ids"),
        masters: await countTable(conn, "tmp_scope_master_ids"),
        releases: await countTable(conn, "tmp_scope_release_ids"),
        tracks: await countTable(conn, "tmp_scope_track_ids"),
        artists: await countTable(conn, "tmp_scope_artist_ids"),
        labels: await countTable(conn, "tmp_scope_label_ids"),
        release_artists: await countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM catalog.release_artists
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      `),
        release_credits: await countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM catalog.release_credits
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      `),
        release_labels: await countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM catalog.release_labels
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      `),
        release_formats: await countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM catalog.release_formats
        WHERE batch_id = ${batchId}
          AND release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      `),
        track_credits: await countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM catalog.track_credits
        WHERE batch_id = ${batchId}
          AND track_id IN (SELECT id FROM tmp_scope_track_ids)
      `),
        entity_quality: entityQualityCounts.reduce((sum, value) => sum + value, 0),
        label_linkouts: await countQuery(conn, sql<{ count: number }>`
        SELECT COUNT(*)::int AS count
        FROM enrich.label_linkouts
        WHERE discogs_label_id IN (SELECT discogs_id FROM tmp_scope_label_ids)
      `),
      };

      const topLabels = await sql<{ label_name: string; releases: number }>`
      SELECT rl.label_name, COUNT(*)::int AS releases
      FROM catalog.release_labels rl
      WHERE rl.batch_id = ${batchId}
        AND rl.release_discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      GROUP BY rl.label_name
      ORDER BY releases DESC, rl.label_name ASC
      LIMIT 10
    `.execute(conn);

      const yearSpread = await sql<{ release_year: number | null; releases: number }>`
      SELECT r.release_year, COUNT(*)::int AS releases
      FROM catalog.releases r
      WHERE r.batch_id = ${batchId}
        AND r.discogs_id IN (SELECT discogs_id FROM tmp_scope_release_ids)
      GROUP BY r.release_year
      ORDER BY r.release_year ASC NULLS LAST
    `.execute(conn);

      console.log("\n[scope] Core entity counts");
      for (const [label, value] of Object.entries(counts).slice(0, 6)) {
        console.log(`  ${label}: ${value.toLocaleString()}`);
      }

      console.log("\n[scope] Supporting row counts");
      for (const [label, value] of Object.entries(counts).slice(6)) {
        console.log(`  ${label}: ${value.toLocaleString()}`);
      }

      console.log("\n[scope] Top labels by included releases");
      for (const row of topLabels.rows) {
        console.log(`  ${row.label_name}: ${row.releases.toLocaleString()}`);
      }

      const nonNullYears = yearSpread.rows.filter((row) => row.release_year !== null);
      if (nonNullYears.length > 0) {
        const first = nonNullYears[0];
        const last = nonNullYears[nonNullYears.length - 1];
        console.log("\n[scope] Included release-year spread");
        console.log(`  first_year=${first.release_year} releases=${first.releases.toLocaleString()}`);
        console.log(`  last_year=${last.release_year} releases=${last.releases.toLocaleString()}`);
      }

      console.log("\n[scope] Notes");
      console.log("  - Artists and labels become Dig-scoped, not full Discogs-complete.");
      console.log("  - When include_master_versions=true, reissues tied to in-scope masters are kept for master/version completeness.");
      console.log("  - This report is non-destructive: it only creates temp tables in the current session.");
    });
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error("[scope] Fatal error:", error);
  process.exit(1);
});
