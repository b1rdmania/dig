/**
 * Discogs vs Dig head-to-head benchmark.
 *
 * Runs equivalent queries against both APIs and compares latency.
 * Discogs rate limit: 60/min authenticated, 25/min unauthenticated.
 * We pace Discogs requests to stay under limits.
 *
 * Usage:
 *   npx tsx apps/api/src/discogs-benchmark.ts [--discogs-token TOKEN] [--dig-url https://dig-api.fly.dev] [--runs 3]
 */

const DEFAULT_DIG_URL = "https://dig-api.fly.dev";
const DEFAULT_RUNS = 3;

interface QueryPair {
  category: string;
  description: string;
  digPath: string;
  discogsPath: string;
  requiresAuth: boolean;
}

// Scene-scoped catalog: master is the canonical entity. Discogs path mappings
// retained for the master/artist/label endpoints; Dig no longer exposes
// /releases/:id detail or /artists/:id/releases (use /artists/:id/masters).
const QUERY_PAIRS: QueryPair[] = [
  // Search (requires Discogs auth)
  { category: "Search: exact artist", description: "Radiohead", digPath: "/v1/search?q=Radiohead&type=artist", discogsPath: "/database/search?q=Radiohead&type=artist", requiresAuth: true },
  { category: "Search: master title", description: "OK Computer", digPath: "/v1/search?q=ok+computer&type=master", discogsPath: "/database/search?q=ok+computer&type=master", requiresAuth: true },
  { category: "Search: common term", description: "Love", digPath: "/v1/search?q=Love&type=master", discogsPath: "/database/search?q=Love&type=master", requiresAuth: true },
  { category: "Search: cross-entity", description: "blue", digPath: "/v1/search?q=blue", discogsPath: "/database/search?q=blue", requiresAuth: true },
  { category: "Search: label", description: "Warp Records", digPath: "/v1/search?q=warp+records&type=label", discogsPath: "/database/search?q=warp+records&type=label", requiresAuth: true },
  { category: "Search: filtered", description: "house electronic", digPath: "/v1/search?q=house&type=master&genre=Electronic", discogsPath: "/database/search?q=house&type=master&genre=Electronic", requiresAuth: true },

  // Retrieval (no auth needed)
  { category: "Artist detail", description: "Radiohead (#3840)", digPath: "/v1/artists/3840", discogsPath: "/artists/3840", requiresAuth: false },
  { category: "Artist detail", description: "Prince (#28795)", digPath: "/v1/artists/28795", discogsPath: "/artists/28795", requiresAuth: false },
  { category: "Label detail", description: "Planet E (#1)", digPath: "/v1/labels/1", discogsPath: "/labels/1", requiresAuth: false },
  { category: "Master detail", description: "OK Computer (#10362)", digPath: "/v1/masters/10362", discogsPath: "/masters/10362", requiresAuth: false },

  // Traversal
  { category: "Artist masters", description: "Radiohead masters", digPath: "/v1/artists/3840/masters?limit=20", discogsPath: "/artists/3840/releases?page=1&per_page=20", requiresAuth: false },
  { category: "Artist masters", description: "Prince masters", digPath: "/v1/artists/28795/masters?limit=20", discogsPath: "/artists/28795/releases?page=1&per_page=20", requiresAuth: false },
  { category: "Label releases", description: "Planet E releases", digPath: "/v1/labels/1/releases?limit=20", discogsPath: "/labels/1/releases?page=1&per_page=20", requiresAuth: false },
];

interface Result {
  category: string;
  description: string;
  digMs: number;
  discogsMs: number;
  digStatus: number;
  discogsStatus: number;
  digError: string | null;
  discogsError: string | null;
}

const UA = "DigBenchmark/1.0 +https://dig.baby";

async function fetchTimed(url: string, headers: Record<string, string>): Promise<{ ms: number; status: number; error: string | null }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const ms = Math.round(performance.now() - start);
    await res.text(); // consume body
    return { ms, status: res.status, error: res.status >= 400 ? `HTTP ${res.status}` : null };
  } catch (err: any) {
    return { ms: Math.round(performance.now() - start), status: 0, error: err.message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  const args = process.argv.slice(2);
  let digUrl = DEFAULT_DIG_URL;
  let runs = DEFAULT_RUNS;
  let discogsToken: string | undefined;
  let digApiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dig-url" && args[i + 1]) digUrl = args[++i];
    if (args[i] === "--runs" && args[i + 1]) runs = parseInt(args[++i], 10);
    if (args[i] === "--discogs-token" && args[i + 1]) discogsToken = args[++i];
    if (args[i] === "--dig-api-key" && args[i + 1]) digApiKey = args[++i];
  }

  const queries = discogsToken
    ? QUERY_PAIRS
    : QUERY_PAIRS.filter((q) => !q.requiresAuth);

  console.log(`\n🔬 Dig vs Discogs API Benchmark`);
  console.log(`   Dig target: ${digUrl}`);
  console.log(`   Discogs target: https://api.discogs.com`);
  console.log(`   Discogs auth: ${discogsToken ? "yes (60/min)" : "no (25/min) — search skipped"}`);
  console.log(`   Queries: ${queries.length}`);
  console.log(`   Runs: ${runs}`);
  console.log(`   Total requests: ${queries.length * runs * 2} (${queries.length * runs} per API)`);
  console.log();

  // Warmup
  console.log("Warming up both APIs...");
  const digHeaders: Record<string, string> = { "User-Agent": UA };
  if (digApiKey) digHeaders["X-API-Key"] = digApiKey;
  const discogsHeaders: Record<string, string> = { "User-Agent": UA };
  if (discogsToken) discogsHeaders["Authorization"] = `Discogs token=${discogsToken}`;

  await fetchTimed(`${digUrl}/v1/artists/3840`, digHeaders);
  await fetchTimed("https://api.discogs.com/artists/3840", discogsHeaders);
  await sleep(1200); // respect Discogs rate limit

  const allResults: Result[] = [];

  for (let run = 1; run <= runs; run++) {
    console.log(`\nRun ${run}/${runs}:`);
    for (const q of queries) {
      // Fire Dig request
      const dig = await fetchTimed(`${digUrl}${q.digPath}`, digHeaders);

      // Pace for Discogs rate limit (1.1s between requests for safety at 60/min)
      await sleep(1100);

      // Fire Discogs request
      const discogs = await fetchTimed(`https://api.discogs.com${q.discogsPath}`, discogsHeaders);

      const result: Result = {
        category: q.category,
        description: q.description,
        digMs: dig.ms,
        discogsMs: discogs.ms,
        digStatus: dig.status,
        discogsStatus: discogs.status,
        digError: dig.error,
        discogsError: discogs.error,
      };
      allResults.push(result);

      const ratio = dig.ms < discogs.ms
        ? `Dig ${(discogs.ms / dig.ms).toFixed(1)}x`
        : `Discogs ${(dig.ms / discogs.ms).toFixed(1)}x`;

      console.log(
        `  ${q.category.padEnd(25)} Dig: ${String(dig.ms).padStart(5)}ms  Discogs: ${String(discogs.ms).padStart(5)}ms  → ${ratio}`,
      );

      // Extra pace between requests
      await sleep(300);
    }
  }

  // Aggregate
  console.log(`\n${"=".repeat(75)}`);
  console.log("AGGREGATE RESULTS");
  console.log("=".repeat(75));

  // By category (group similar)
  const categoryGroups = new Map<string, Result[]>();
  for (const r of allResults) {
    const key = r.category.split(":")[0].trim(); // group "Search: exact artist" → "Search"
    if (!categoryGroups.has(key)) categoryGroups.set(key, []);
    categoryGroups.get(key)!.push(r);
  }

  const summaryRows: Array<{ label: string; digP50: number; discogsP50: number; digWins: boolean; ratio: string }> = [];

  for (const [cat, results] of categoryGroups) {
    const digLatencies = results.map((r) => r.digMs).sort((a, b) => a - b);
    const discogsLatencies = results.map((r) => r.discogsMs).sort((a, b) => a - b);
    const digP50 = percentile(digLatencies, 50);
    const discogsP50 = percentile(discogsLatencies, 50);
    const digErrors = results.filter((r) => r.digError).length;
    const discogsErrors = results.filter((r) => r.discogsError).length;
    const digWins = digP50 < discogsP50;
    const ratio = digWins
      ? `Dig ${(discogsP50 / digP50).toFixed(1)}x`
      : discogsP50 < digP50
        ? `Discogs ${(digP50 / discogsP50).toFixed(1)}x`
        : "Even";

    summaryRows.push({ label: cat, digP50, discogsP50, digWins, ratio });

    console.log(`\n  [${cat}] (${results.length} requests)`);
    console.log(`    Dig     p50=${digP50}ms  p95=${percentile(digLatencies, 95)}ms  errors=${digErrors}`);
    console.log(`    Discogs p50=${discogsP50}ms  p95=${percentile(discogsLatencies, 95)}ms  errors=${discogsErrors}`);
    console.log(`    Winner: ${ratio}`);
  }

  // Overall
  const allDig = allResults.map((r) => r.digMs).sort((a, b) => a - b);
  const allDiscogs = allResults.map((r) => r.discogsMs).sort((a, b) => a - b);
  const overallDigP50 = percentile(allDig, 50);
  const overallDiscogsP50 = percentile(allDiscogs, 50);
  const digWinsCount = summaryRows.filter((r) => r.digWins).length;

  console.log(`\n${"=".repeat(75)}`);
  console.log("OVERALL");
  console.log("=".repeat(75));
  console.log(`  Dig p50:       ${overallDigP50}ms`);
  console.log(`  Discogs p50:   ${overallDiscogsP50}ms`);
  console.log(`  Dig wins:      ${digWinsCount}/${summaryRows.length} categories`);
  console.log(`  Dig errors:    ${allResults.filter((r) => r.digError).length}/${allResults.length}`);
  console.log(`  Discogs errors: ${allResults.filter((r) => r.discogsError).length}/${allResults.length}`);

  // Summary table for progress page
  console.log(`\n${"=".repeat(75)}`);
  console.log("PROGRESS PAGE DATA (copy-paste)");
  console.log("=".repeat(75));
  console.log("const comparisonRows = [");
  for (const r of summaryRows) {
    console.log(`  { label: "${r.label}", dig: ${r.digP50}, discogs: ${r.discogsP50}, winner: "${r.ratio}", digWins: ${r.digWins} },`);
  }
  console.log("];");
  console.log(`\nOverall: Dig p50=${overallDigP50}ms, Discogs p50=${overallDiscogsP50}ms, Dig wins ${digWinsCount}/${summaryRows.length}`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});

export {};
