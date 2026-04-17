/**
 * Concurrent stress test for Dig API.
 *
 * Fires batches of concurrent requests to simulate real-world pressure.
 * Reports latency percentiles, throughput, error rates, and rate-limit hits.
 *
 * Usage:
 *   npx tsx apps/api/src/stress-test.ts [--base-url https://dig-api.fly.dev] [--concurrency 50] [--total 200] [--api-key KEY]
 */

const DEFAULT_BASE_URL = "https://dig-api.fly.dev";
const DEFAULT_CONCURRENCY = 50;
const DEFAULT_TOTAL = 200;

interface Query {
  category: string;
  description: string;
  path: string;
}

// Scene-scoped catalog: master is the canonical entity. Release detail and
// per-release credits were dropped (return 410). Search defaults to type=master.
const QUERY_MIX: Query[] = [
  // Search — heaviest queries
  { category: "search", description: "FTS master", path: "/v1/search?q=dark+side&type=master" },
  { category: "search", description: "FTS artist", path: "/v1/search?q=radiohead&type=artist" },
  { category: "search", description: "Common term", path: "/v1/search?q=Love&type=master" },
  { category: "search", description: "Cross-entity", path: "/v1/search?q=blue" },
  { category: "search", description: "Fuzzy", path: "/v1/search?q=Radiohed&type=artist" },
  { category: "search", description: "Filtered", path: "/v1/search?q=house&type=master&genre=Electronic" },
  { category: "search", description: "Unicode", path: "/v1/search?q=Bjork&type=artist" },
  { category: "search", description: "Multi-word", path: "/v1/search?q=ok+computer&type=master" },

  // Retrieval — fast lookups
  { category: "retrieval", description: "Artist detail", path: "/v1/artists/3840" },
  { category: "retrieval", description: "Label detail", path: "/v1/labels/1" },
  { category: "retrieval", description: "Master detail", path: "/v1/masters/10362" },
  { category: "retrieval", description: "Release shadow", path: "/v1/release_shadow/1" },

  // Traversal — join-heavy
  { category: "traversal", description: "Artist masters", path: "/v1/artists/3840/masters?limit=20" },
  { category: "traversal", description: "Label releases", path: "/v1/labels/1/releases?limit=20" },
  { category: "traversal", description: "Master releases", path: "/v1/masters/10362/releases?limit=20" },
  { category: "traversal", description: "Master videos", path: "/v1/masters/10362/videos?limit=20" },
];

interface Result {
  category: string;
  description: string;
  latencyMs: number;
  status: number;
  error: string | null;
  rateLimited: boolean;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function fireRequest(baseUrl: string, query: Query, apiKey?: string): Promise<Result> {
  const url = `${baseUrl}${query.path}`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["X-API-Key"] = apiKey;

  const start = performance.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    const latencyMs = Math.round(performance.now() - start);
    // Consume body to free connection
    await res.text();
    return {
      category: query.category,
      description: query.description,
      latencyMs,
      status: res.status,
      error: res.status >= 400 && res.status !== 429 ? `HTTP ${res.status}` : null,
      rateLimited: res.status === 429,
    };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      category: query.category,
      description: query.description,
      latencyMs,
      status: 0,
      error: err.message,
      rateLimited: false,
    };
  }
}

async function runBatch(
  baseUrl: string,
  batchSize: number,
  apiKey?: string,
): Promise<Result[]> {
  const promises: Promise<Result>[] = [];
  for (let i = 0; i < batchSize; i++) {
    promises.push(fireRequest(baseUrl, pickRandom(QUERY_MIX), apiKey));
  }
  return Promise.all(promises);
}

async function main() {
  const args = process.argv.slice(2);
  let baseUrl = DEFAULT_BASE_URL;
  let concurrency = DEFAULT_CONCURRENCY;
  let total = DEFAULT_TOTAL;
  let apiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--base-url" && args[i + 1]) baseUrl = args[++i];
    if (args[i] === "--concurrency" && args[i + 1]) concurrency = parseInt(args[++i], 10);
    if (args[i] === "--total" && args[i + 1]) total = parseInt(args[++i], 10);
    if (args[i] === "--api-key" && args[i + 1]) apiKey = args[++i];
  }

  const batches = Math.ceil(total / concurrency);

  console.log(`\n⚡ Dig API Stress Test`);
  console.log(`   Target: ${baseUrl}`);
  console.log(`   Total requests: ${total}`);
  console.log(`   Concurrency: ${concurrency}`);
  console.log(`   Batches: ${batches}`);
  console.log(`   Query mix: ${QUERY_MIX.length} query types`);
  console.log(`   API key: ${apiKey ? "yes (300/min tier)" : "no (60/min tier)"}`);
  console.log();

  // Warmup
  console.log("Warming up (5 sequential requests)...");
  for (let i = 0; i < 5; i++) {
    await fireRequest(baseUrl, QUERY_MIX[i % QUERY_MIX.length], apiKey);
  }

  const allResults: Result[] = [];
  const testStart = performance.now();

  for (let b = 0; b < batches; b++) {
    const batchSize = Math.min(concurrency, total - b * concurrency);
    const batchStart = performance.now();
    const results = await runBatch(baseUrl, batchSize, apiKey);
    const batchMs = Math.round(performance.now() - batchStart);

    allResults.push(...results);

    const errors = results.filter((r) => r.error).length;
    const rateLimited = results.filter((r) => r.rateLimited).length;
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

    console.log(
      `  Batch ${b + 1}/${batches}: ${batchSize} reqs in ${batchMs}ms | ` +
        `p50=${percentile(latencies, 50)}ms p99=${percentile(latencies, 99)}ms | ` +
        `errors=${errors} rate_limited=${rateLimited}`,
    );
  }

  const totalMs = Math.round(performance.now() - testStart);
  const throughput = ((allResults.length / totalMs) * 1000).toFixed(1);

  // Overall stats
  console.log(`\n${"=".repeat(70)}`);
  console.log("RESULTS");
  console.log("=".repeat(70));

  const allLatencies = allResults.map((r) => r.latencyMs).sort((a, b) => a - b);
  const totalErrors = allResults.filter((r) => r.error).length;
  const totalRateLimited = allResults.filter((r) => r.rateLimited).length;
  const totalSuccess = allResults.filter((r) => r.status === 200).length;

  console.log(`\nOverall:`);
  console.log(`  Total requests:  ${allResults.length}`);
  console.log(`  Successful:      ${totalSuccess} (${((totalSuccess / allResults.length) * 100).toFixed(1)}%)`);
  console.log(`  Rate limited:    ${totalRateLimited}`);
  console.log(`  Errors:          ${totalErrors}`);
  console.log(`  Wall time:       ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`  Throughput:      ${throughput} req/s`);
  console.log(`  Min latency:     ${Math.min(...allLatencies)}ms`);
  console.log(`  p50 latency:     ${percentile(allLatencies, 50)}ms`);
  console.log(`  p95 latency:     ${percentile(allLatencies, 95)}ms`);
  console.log(`  p99 latency:     ${percentile(allLatencies, 99)}ms`);
  console.log(`  Max latency:     ${Math.max(...allLatencies)}ms`);

  // Per-category breakdown
  const categories = [...new Set(allResults.map((r) => r.category))];
  for (const cat of categories) {
    const catResults = allResults.filter((r) => r.category === cat);
    const latencies = catResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    const errors = catResults.filter((r) => r.error).length;
    const rl = catResults.filter((r) => r.rateLimited).length;

    console.log(`\n  [${cat}] (${catResults.length} requests)`);
    console.log(`    p50=${percentile(latencies, 50)}ms  p95=${percentile(latencies, 95)}ms  p99=${percentile(latencies, 99)}ms  max=${Math.max(...latencies)}ms`);
    console.log(`    errors=${errors}  rate_limited=${rl}`);
  }

  // Slowest requests
  console.log(`\n${"=".repeat(70)}`);
  console.log("10 SLOWEST REQUESTS");
  console.log("=".repeat(70));
  const slowest = [...allResults].sort((a, b) => b.latencyMs - a.latencyMs).slice(0, 10);
  for (const r of slowest) {
    console.log(`  ${String(r.latencyMs).padStart(6)}ms  [${r.category}] ${r.description}  ${r.rateLimited ? "RATE_LIMITED" : r.error || "OK"}`);
  }

  console.log();
}

main().catch((err) => {
  console.error("Stress test failed:", err);
  process.exit(1);
});

export {};
