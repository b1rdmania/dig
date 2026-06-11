#!/usr/bin/env npx tsx
/**
 * Search quality report — the telemetry feedback loop for ranking work.
 *
 * Reads enrich.search_quality_daily (fed by /v1/events → metrics/usage.ts)
 * and prints:
 *   - overall zero-result rate and click-through rate for the window
 *   - top zero-result queries (what users want that we don't serve)
 *   - top queries by volume with per-query CTR and average click position
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx scripts/search-quality-report.ts [--days 7]
 *
 * Against production:
 *   fly proxy 15432:5432 -a dig-db-scene &
 *   DATABASE_URL=postgresql://postgres:<pass>@localhost:15432/dig \
 *     npx tsx scripts/search-quality-report.ts --days 7
 *
 * Use the output to re-tune the ranking constants in
 * packages/domain/src/search.ts (typeWeight, exact/prefix bonuses) against
 * what people actually click, instead of hand-tuned guesses.
 */
import pg from "pg";

const DAYS = (() => {
  const idx = process.argv.indexOf("--days");
  const n = idx >= 0 ? parseInt(process.argv[idx + 1], 10) : 7;
  return Number.isFinite(n) && n > 0 ? n : 7;
})();

const TOP_N = 25;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();

  try {
    const totals = await client.query(`
      SELECT
        COALESCE(SUM(submits), 0)::int            AS submits,
        COALESCE(SUM(zero_results), 0)::int       AS zero_results,
        COALESCE(SUM(clicks), 0)::int             AS clicks,
        COUNT(DISTINCT query)::int                AS distinct_queries
      FROM enrich.search_quality_daily
      WHERE day >= CURRENT_DATE - $1::int
    `, [DAYS - 1]);

    const t = totals.rows[0];
    const zeroRate = t.submits > 0 ? (t.zero_results / t.submits) * 100 : 0;
    const ctr = t.submits > 0 ? (t.clicks / t.submits) * 100 : 0;

    console.log(`\nSearch quality — last ${DAYS} day(s)`);
    console.log("=".repeat(48));
    console.log(`Submits:          ${t.submits}`);
    console.log(`Distinct queries: ${t.distinct_queries}`);
    console.log(`Zero-result rate: ${zeroRate.toFixed(1)}%  (${t.zero_results} submits)`);
    console.log(`Click-through:    ${ctr.toFixed(1)}%  (${t.clicks} clicks)`);

    if (t.submits === 0) {
      console.log("\nNo search telemetry in window — nothing to report.");
      return;
    }

    const zero = await client.query(`
      SELECT query, SUM(submits)::int AS submits, SUM(zero_results)::int AS zero_results
      FROM enrich.search_quality_daily
      WHERE day >= CURRENT_DATE - $1::int
      GROUP BY query
      HAVING SUM(zero_results) > 0
      ORDER BY SUM(zero_results) DESC, SUM(submits) DESC
      LIMIT $2
    `, [DAYS - 1, TOP_N]);

    console.log(`\nTop zero-result queries (max ${TOP_N})`);
    console.log("-".repeat(48));
    if (zero.rows.length === 0) {
      console.log("(none — every query in window returned results)");
    }
    for (const r of zero.rows) {
      console.log(`${String(r.zero_results).padStart(5)}/${String(r.submits).padEnd(5)} ${r.query}`);
    }

    const top = await client.query(`
      SELECT
        query,
        SUM(submits)::int AS submits,
        SUM(clicks)::int  AS clicks,
        CASE WHEN SUM(clicks) > 0
             THEN ROUND(SUM(click_position_sum)::numeric / SUM(clicks), 1)
             ELSE NULL END AS avg_click_pos
      FROM enrich.search_quality_daily
      WHERE day >= CURRENT_DATE - $1::int
      GROUP BY query
      ORDER BY SUM(submits) DESC
      LIMIT $2
    `, [DAYS - 1, TOP_N]);

    console.log(`\nTop queries by volume (max ${TOP_N})`);
    console.log("-".repeat(48));
    console.log("submits  ctr%   avg_pos  query");
    for (const r of top.rows) {
      const qCtr = r.submits > 0 ? ((r.clicks / r.submits) * 100).toFixed(0) : "0";
      console.log(
        `${String(r.submits).padStart(7)}  ${String(qCtr).padStart(4)}   ${String(r.avg_click_pos ?? "-").padStart(7)}  ${r.query}`,
      );
    }
    console.log();
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
