/**
 * Search benchmark runner.
 *
 * Runs the 32-query benchmark suite from phase2-search-mitigation.md
 * against a live API server and reports latency statistics.
 *
 * Usage:
 *   npx tsx apps/api/src/benchmark.ts [--base-url http://localhost:3002] [--runs 3]
 */

const DEFAULT_BASE_URL = "http://localhost:3002";
const DEFAULT_RUNS = 3;

interface BenchmarkQuery {
  id: number;
  category: string;
  description: string;
  path: string;
}

const QUERIES: BenchmarkQuery[] = [
  // Category 1: Release FTS (tsvector) — Risk 1 acceptance criteria
  { id: 1, category: "release-fts", description: "Exact title match", path: "/v1/search?q=Stockholm&type=release" },
  { id: 2, category: "release-fts", description: "Partial title match", path: "/v1/search?q=dark+side&type=release" },
  { id: 3, category: "release-fts", description: "Multi-word release", path: "/v1/search?q=ok+computer&type=release" },
  { id: 4, category: "release-fts", description: "Obscure release", path: "/v1/search?q=Svek+deep+house&type=release" },

  // Category 2: Common-term stress — Risk 2 acceptance criteria
  { id: 5, category: "common-term", description: "\"Love\" stress test", path: "/v1/search?q=Love&type=release" },
  { id: 6, category: "common-term", description: "\"The\" stress test", path: "/v1/search?q=The&type=release" },
  { id: 7, category: "common-term", description: "\"DJ\" stress test", path: "/v1/search?q=DJ&type=artist" },
  { id: 8, category: "common-term", description: "\"Remix\" stress test", path: "/v1/search?q=Remix&type=release" },

  // Category 3: Artist/label/master fuzzy — Risk 1 typo tolerance
  { id: 9, category: "fuzzy", description: "Artist typo", path: "/v1/search?q=Radiohed&type=artist" },
  { id: 10, category: "fuzzy", description: "Label typo", path: "/v1/search?q=Planet+Ee&type=label" },
  { id: 11, category: "fuzzy", description: "Master typo", path: "/v1/search?q=Thrilr&type=master" },
  { id: 12, category: "fuzzy", description: "Artist 2-char off", path: "/v1/search?q=Madona&type=artist" },

  // Category 4: Filter combinations — Risk 3 acceptance criteria
  { id: 13, category: "filtered", description: "Genre filter", path: "/v1/search?q=house&type=release&genre=Electronic" },
  { id: 14, category: "filtered", description: "Genre + year", path: "/v1/search?q=house&type=release&genre=Electronic&year=1995" },
  { id: 15, category: "filtered", description: "Country filter", path: "/v1/search?q=punk&type=release&country=US" },
  { id: 16, category: "filtered", description: "Style filter", path: "/v1/search?q=ambient&type=release&style=Ambient" },

  // Category 5: Multi-entity search (no type filter)
  { id: 17, category: "multi-entity", description: "Cross-entity search", path: "/v1/search?q=radiohead" },
  { id: 18, category: "multi-entity", description: "Cross-entity common", path: "/v1/search?q=blue" },
  { id: 19, category: "multi-entity", description: "Cross-entity label", path: "/v1/search?q=warp+records" },
  { id: 20, category: "multi-entity", description: "Cross-entity obscure", path: "/v1/search?q=Kompakt+total" },

  // Category 6: Unicode/diacritic — Risk 5 acceptance criteria
  { id: 21, category: "unicode", description: "Björk → Bjork", path: "/v1/search?q=Bjork&type=artist" },
  { id: 22, category: "unicode", description: "Dahlbäck → Dahlback", path: "/v1/search?q=Dahlback&type=artist" },
  { id: 23, category: "unicode", description: "Café del Mar", path: "/v1/search?q=Cafe+del+Mar&type=release" },
  { id: 24, category: "unicode", description: "Motörhead ASCII", path: "/v1/search?q=Motorhead&type=artist" },

  // Category 7: Entity detail retrieval
  { id: 25, category: "retrieval", description: "Artist detail", path: "/v1/artists/3840" },
  { id: 26, category: "retrieval", description: "Label detail", path: "/v1/labels/1" },
  { id: 27, category: "retrieval", description: "Master detail", path: "/v1/masters/10362" },
  { id: 28, category: "retrieval", description: "Release detail", path: "/v1/releases/1" },

  // Category 8: Traversal links
  { id: 29, category: "traversal", description: "Artist releases", path: "/v1/artists/1/releases?limit=20" },
  { id: 30, category: "traversal", description: "Artist masters", path: "/v1/artists/3840/masters?limit=20" },
  { id: 31, category: "traversal", description: "Label releases", path: "/v1/labels/1/releases?limit=20" },
  { id: 32, category: "traversal", description: "Release credits", path: "/v1/releases/1/credits?limit=20" },
];

interface RunResult {
  queryId: number;
  category: string;
  description: string;
  latencyMs: number;
  statusCode: number;
  resultCount: number | null;
  error: string | null;
}

async function runQuery(baseUrl: string, query: BenchmarkQuery): Promise<RunResult> {
  const url = `${baseUrl}${query.path}`;
  const start = performance.now();

  try {
    const res = await fetch(url);
    const latencyMs = Math.round(performance.now() - start);
    const body = (await res.json()) as Record<string, any>;

    let resultCount: number | null = null;
    if (body.results) resultCount = body.results.length;
    else if (body.links) resultCount = body.links.length;
    else if (body.artist || body.label || body.master || body.release) resultCount = 1;

    return {
      queryId: query.id,
      category: query.category,
      description: query.description,
      latencyMs,
      statusCode: res.status,
      resultCount,
      error: res.status >= 400 ? (body.error?.message ?? JSON.stringify(body.error)) : null,
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      queryId: query.id,
      category: query.category,
      description: query.description,
      latencyMs,
      statusCode: 0,
      resultCount: null,
      error: err.message,
    };
  }
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  const args = process.argv.slice(2);
  let baseUrl = DEFAULT_BASE_URL;
  let runs = DEFAULT_RUNS;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base-url" && args[i + 1]) baseUrl = args[++i];
    if (args[i] === "--runs" && args[i + 1]) runs = parseInt(args[++i], 10);
  }

  console.log(`\n🔍 Dig Search Benchmark`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Queries: ${QUERIES.length}`);
  console.log(`   Runs per query: ${runs}`);
  console.log(`   Total requests: ${QUERIES.length * runs}\n`);

  // Warmup run (not counted)
  console.log("Warming up...");
  for (const q of QUERIES.slice(0, 5)) {
    await runQuery(baseUrl, q);
  }

  const allResults: RunResult[] = [];

  for (let run = 1; run <= runs; run++) {
    console.log(`\nRun ${run}/${runs}:`);
    for (const query of QUERIES) {
      const result = await runQuery(baseUrl, query);
      allResults.push(result);

      const status = result.statusCode === 200 ? "OK" : `${result.statusCode}`;
      const count = result.resultCount !== null ? `${result.resultCount} results` : "";
      console.log(
        `  [${String(query.id).padStart(2)}] ${query.description.padEnd(25)} ${String(result.latencyMs).padStart(6)}ms  ${status}  ${count}`,
      );
    }
  }

  // Aggregate statistics by category
  console.log("\n" + "=".repeat(80));
  console.log("AGGREGATE RESULTS");
  console.log("=".repeat(80));

  const categories = [...new Set(QUERIES.map((q) => q.category))];

  for (const cat of categories) {
    const catResults = allResults.filter((r) => r.category === cat);
    const latencies = catResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    const errors = catResults.filter((r) => r.statusCode !== 200).length;

    console.log(`\n[${cat}]`);
    console.log(`  Queries: ${catResults.length / runs} x ${runs} runs = ${catResults.length} total`);
    console.log(`  Min:  ${Math.min(...latencies)}ms`);
    console.log(`  p50:  ${percentile(latencies, 50)}ms`);
    console.log(`  p95:  ${percentile(latencies, 95)}ms`);
    console.log(`  p99:  ${percentile(latencies, 99)}ms`);
    console.log(`  Max:  ${Math.max(...latencies)}ms`);
    console.log(`  Errors: ${errors}/${catResults.length}`);
  }

  // Overall
  const allLatencies = allResults.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalErrors = allResults.filter((r) => r.statusCode !== 200).length;

  console.log(`\n${"=".repeat(80)}`);
  console.log("OVERALL");
  console.log(`  Total requests: ${allResults.length}`);
  console.log(`  Min:  ${Math.min(...allLatencies)}ms`);
  console.log(`  p50:  ${percentile(allLatencies, 50)}ms`);
  console.log(`  p95:  ${percentile(allLatencies, 95)}ms`);
  console.log(`  p99:  ${percentile(allLatencies, 99)}ms`);
  console.log(`  Max:  ${Math.max(...allLatencies)}ms`);
  console.log(`  Errors: ${totalErrors}/${allResults.length}`);

  // Check acceptance criteria
  console.log(`\n${"=".repeat(80)}`);
  console.log("ACCEPTANCE CRITERIA CHECK");
  console.log("=".repeat(80));

  const checks = [
    {
      name: "Release FTS p95 < 500ms",
      pass: percentile(
        allResults.filter((r) => r.category === "release-fts").map((r) => r.latencyMs).sort((a, b) => a - b),
        95,
      ) < 500,
    },
    {
      name: "Common-term p99 < 1000ms",
      pass: percentile(
        allResults.filter((r) => r.category === "common-term").map((r) => r.latencyMs).sort((a, b) => a - b),
        99,
      ) < 1000,
    },
    {
      name: "Fuzzy p95 < 500ms",
      pass: percentile(
        allResults.filter((r) => r.category === "fuzzy").map((r) => r.latencyMs).sort((a, b) => a - b),
        95,
      ) < 500,
    },
    {
      name: "Filter+search p95 < 300ms",
      pass: percentile(
        allResults.filter((r) => r.category === "filtered").map((r) => r.latencyMs).sort((a, b) => a - b),
        95,
      ) < 300,
    },
    {
      name: "No query exceeds 5000ms",
      pass: Math.max(...allLatencies) < 5000,
    },
    {
      name: "Retrieval p95 < 200ms",
      pass: percentile(
        allResults.filter((r) => r.category === "retrieval").map((r) => r.latencyMs).sort((a, b) => a - b),
        95,
      ) < 200,
    },
    {
      name: "Traversal p95 < 200ms",
      pass: percentile(
        allResults.filter((r) => r.category === "traversal").map((r) => r.latencyMs).sort((a, b) => a - b),
        95,
      ) < 200,
    },
  ];

  let allPass = true;
  for (const check of checks) {
    const icon = check.pass ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${check.name}`);
    if (!check.pass) allPass = false;
  }

  console.log(`\n${allPass ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
