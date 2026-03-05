/**
 * Discogs vs Dig search benchmark comparison.
 *
 * Runs equivalent queries against both the Discogs API and the local Dig API,
 * then produces a side-by-side latency comparison.
 *
 * Usage:
 *   npx tsx apps/api/src/benchmark-discogs.ts --token YOUR_DISCOGS_TOKEN [--dig-url http://localhost:3002] [--runs 2]
 *
 * Rate limit: Discogs allows 60 req/min authenticated. We throttle to ~55/min to stay safe.
 */

const DISCOGS_BASE = "https://api.discogs.com";
const THROTTLE_MS = 1100; // ~55 req/min

interface ComparisonQuery {
  id: number;
  category: string;
  description: string;
  digPath: string;
  discogsPath: string;
}

// Map Dig queries to equivalent Discogs API calls.
// Discogs search: GET /database/search?q=...&type=...&genre=...&style=...&country=...&year=...
// Discogs detail: GET /artists/{id}, /labels/{id}, /masters/{id}, /releases/{id}
const QUERIES: ComparisonQuery[] = [
  // Search queries — mapped to equivalent Discogs search params
  { id: 1, category: "release-fts", description: "Exact title match", digPath: "/v1/search?q=Stockholm&type=release", discogsPath: "/database/search?q=Stockholm&type=release&per_page=20" },
  { id: 2, category: "release-fts", description: "Partial title match", digPath: "/v1/search?q=dark+side&type=release", discogsPath: "/database/search?q=dark+side&type=release&per_page=20" },
  { id: 3, category: "release-fts", description: "Multi-word release", digPath: "/v1/search?q=ok+computer&type=release", discogsPath: "/database/search?q=ok+computer&type=release&per_page=20" },
  { id: 4, category: "release-fts", description: "Obscure release", digPath: "/v1/search?q=Svek+deep+house&type=release", discogsPath: "/database/search?q=Svek+deep+house&type=release&per_page=20" },

  { id: 5, category: "common-term", description: "\"Love\" release", digPath: "/v1/search?q=Love&type=release", discogsPath: "/database/search?q=Love&type=release&per_page=20" },
  { id: 6, category: "common-term", description: "\"DJ\" artist", digPath: "/v1/search?q=DJ&type=artist", discogsPath: "/database/search?q=DJ&type=artist&per_page=20" },
  { id: 7, category: "common-term", description: "\"Remix\" release", digPath: "/v1/search?q=Remix&type=release", discogsPath: "/database/search?q=Remix&type=release&per_page=20" },

  { id: 8, category: "fuzzy", description: "Artist typo (Radiohed)", digPath: "/v1/search?q=Radiohed&type=artist", discogsPath: "/database/search?q=Radiohed&type=artist&per_page=20" },
  { id: 9, category: "fuzzy", description: "Label typo (Planet Ee)", digPath: "/v1/search?q=Planet+Ee&type=label", discogsPath: "/database/search?q=Planet+Ee&type=label&per_page=20" },
  { id: 10, category: "fuzzy", description: "Artist 2-char off (Madona)", digPath: "/v1/search?q=Madona&type=artist", discogsPath: "/database/search?q=Madona&type=artist&per_page=20" },

  { id: 11, category: "filtered", description: "Genre filter", digPath: "/v1/search?q=house&type=release&genre=Electronic", discogsPath: "/database/search?q=house&type=release&genre=Electronic&per_page=20" },
  { id: 12, category: "filtered", description: "Genre + year", digPath: "/v1/search?q=house&type=release&genre=Electronic&year=1995", discogsPath: "/database/search?q=house&type=release&genre=Electronic&year=1995&per_page=20" },
  { id: 13, category: "filtered", description: "Country filter", digPath: "/v1/search?q=punk&type=release&country=US", discogsPath: "/database/search?q=punk&type=release&country=US&per_page=20" },
  { id: 14, category: "filtered", description: "Style filter", digPath: "/v1/search?q=ambient&type=release&style=Ambient", discogsPath: "/database/search?q=ambient&type=release&style=Ambient&per_page=20" },

  { id: 15, category: "multi-entity", description: "Cross-entity", digPath: "/v1/search?q=radiohead", discogsPath: "/database/search?q=radiohead&per_page=20" },
  { id: 16, category: "multi-entity", description: "Cross-entity label", digPath: "/v1/search?q=warp+records", discogsPath: "/database/search?q=warp+records&per_page=20" },

  { id: 17, category: "unicode", description: "Björk → Bjork", digPath: "/v1/search?q=Bjork&type=artist", discogsPath: "/database/search?q=Bjork&type=artist&per_page=20" },
  { id: 18, category: "unicode", description: "Café del Mar", digPath: "/v1/search?q=Cafe+del+Mar&type=release", discogsPath: "/database/search?q=Cafe+del+Mar&type=release&per_page=20" },
  { id: 19, category: "unicode", description: "Motörhead ASCII", digPath: "/v1/search?q=Motorhead&type=artist", discogsPath: "/database/search?q=Motorhead&type=artist&per_page=20" },

  // Detail retrieval — same IDs
  { id: 20, category: "retrieval", description: "Artist detail", digPath: "/v1/artists/3840", discogsPath: "/artists/3840" },
  { id: 21, category: "retrieval", description: "Label detail", digPath: "/v1/labels/1", discogsPath: "/labels/1" },
  { id: 22, category: "retrieval", description: "Master detail", digPath: "/v1/masters/10362", discogsPath: "/masters/10362" },
  { id: 23, category: "retrieval", description: "Release detail", digPath: "/v1/releases/1", discogsPath: "/releases/1" },
];

interface RunResult {
  queryId: number;
  category: string;
  description: string;
  digMs: number;
  discogsMs: number;
  digResults: number | null;
  discogsResults: number | null;
  digStatus: number;
  discogsStatus: number;
}

async function fetchTimed(url: string, headers: Record<string, string> = {}): Promise<{ ms: number; status: number; body: any }> {
  const start = performance.now();
  try {
    const res = await fetch(url, { headers });
    const ms = Math.round(performance.now() - start);
    const body = await res.json();
    return { ms, status: res.status, body };
  } catch (err: any) {
    const ms = Math.round(performance.now() - start);
    return { ms, status: 0, body: { error: err.message } };
  }
}

function extractResultCount(body: any, source: "dig" | "discogs"): number | null {
  if (source === "dig") {
    if (body.results) return body.results.length;
    if (body.links) return body.links.length;
    if (body.artist || body.label || body.master || body.release) return 1;
    return null;
  }
  // Discogs
  if (body.results) return body.results.length;
  if (body.id) return 1; // detail endpoint
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function buildOAuthHeader(consumerKey: string, consumerSecret: string): string {
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  return `OAuth oauth_consumer_key="${consumerKey}", oauth_nonce="${nonce}", oauth_signature="${consumerSecret}%26", oauth_signature_method="PLAINTEXT", oauth_timestamp="${timestamp}", oauth_version="1.0"`;
}

async function main() {
  const args = process.argv.slice(2);
  let token = "";
  let consumerKey = "";
  let consumerSecret = "";
  let digUrl = "http://localhost:3002";
  let runs = 2;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--token" && args[i + 1]) token = args[++i];
    if (args[i] === "--consumer-key" && args[i + 1]) consumerKey = args[++i];
    if (args[i] === "--consumer-secret" && args[i + 1]) consumerSecret = args[++i];
    if (args[i] === "--dig-url" && args[i + 1]) digUrl = args[++i];
    if (args[i] === "--runs" && args[i + 1]) runs = parseInt(args[++i], 10);
  }

  if (!token && !(consumerKey && consumerSecret)) {
    console.error("Usage: npx tsx apps/api/src/benchmark-discogs.ts --token TOKEN  OR  --consumer-key KEY --consumer-secret SECRET");
    process.exit(1);
  }

  const discogsHeaders: Record<string, string> = {
    "Authorization": consumerKey
      ? buildOAuthHeader(consumerKey, consumerSecret)
      : `Discogs token=${token}`,
    "User-Agent": "DigBenchmark/1.0 +https://dig.baby",
  };

  console.log(`\n🔍 Dig vs Discogs Search Benchmark`);
  console.log(`   Dig URL: ${digUrl}`);
  console.log(`   Discogs: ${DISCOGS_BASE}`);
  console.log(`   Queries: ${QUERIES.length}`);
  console.log(`   Runs: ${runs}`);
  console.log(`   Throttle: ${THROTTLE_MS}ms between Discogs requests`);
  console.log(`   Estimated time: ~${Math.ceil((QUERIES.length * runs * THROTTLE_MS) / 60000)} min\n`);

  // Warmup Dig (Discogs doesn't need warmup — CDN handles it)
  console.log("Warming up Dig...");
  for (const q of QUERIES.slice(0, 3)) {
    await fetchTimed(`${digUrl}${q.digPath}`);
  }

  const allResults: RunResult[] = [];

  for (let run = 1; run <= runs; run++) {
    console.log(`\nRun ${run}/${runs}:`);
    console.log(`  ${"#".padStart(3)} ${"Query".padEnd(28)} ${"Dig".padStart(8)} ${"Discogs".padStart(8)}  ${"Dig#".padStart(5)} ${"Disc#".padStart(5)}`);
    console.log(`  ${"-".repeat(70)}`);

    for (const q of QUERIES) {
      // Run Dig first (instant)
      const dig = await fetchTimed(`${digUrl}${q.digPath}`);

      // Throttle before Discogs
      await sleep(THROTTLE_MS);

      // Rebuild OAuth header per-request (fresh nonce + timestamp required)
      if (consumerKey) {
        discogsHeaders["Authorization"] = buildOAuthHeader(consumerKey, consumerSecret);
      }

      // Run Discogs
      const discogs = await fetchTimed(`${DISCOGS_BASE}${q.discogsPath}`, discogsHeaders);

      const digCount = extractResultCount(dig.body, "dig");
      const discogsCount = extractResultCount(discogs.body, "discogs");

      allResults.push({
        queryId: q.id,
        category: q.category,
        description: q.description,
        digMs: dig.ms,
        discogsMs: discogs.ms,
        digResults: digCount,
        discogsResults: discogsCount,
        digStatus: dig.status,
        discogsStatus: discogs.status,
      });

      const digTag = dig.status === 200 ? `${dig.ms}ms` : `ERR${dig.status}`;
      const discTag = discogs.status === 200 ? `${discogs.ms}ms` : `ERR${discogs.status}`;
      const faster = dig.ms < discogs.ms ? " ←" : discogs.ms < dig.ms ? "  →" : "";

      console.log(
        `  ${String(q.id).padStart(3)} ${q.description.padEnd(28)} ${digTag.padStart(8)} ${discTag.padStart(8)}  ${String(digCount ?? "-").padStart(5)} ${String(discogsCount ?? "-").padStart(5)}${faster}`,
      );
    }
  }

  // Aggregate by category
  console.log("\n" + "=".repeat(80));
  console.log("CATEGORY COMPARISON (p50)");
  console.log("=".repeat(80));
  console.log(`  ${"Category".padEnd(20)} ${"Dig p50".padStart(10)} ${"Discogs p50".padStart(12)} ${"Winner".padStart(10)}`);
  console.log(`  ${"-".repeat(55)}`);

  const categories = [...new Set(QUERIES.map((q) => q.category))];
  for (const cat of categories) {
    const catResults = allResults.filter((r) => r.category === cat);
    const digLatencies = catResults.map((r) => r.digMs).sort((a, b) => a - b);
    const discogsLatencies = catResults.map((r) => r.discogsMs).sort((a, b) => a - b);
    const digP50 = percentile(digLatencies, 50);
    const discogsP50 = percentile(discogsLatencies, 50);
    const winner = digP50 < discogsP50 ? "Dig" : discogsP50 < digP50 ? "Discogs" : "Tie";

    console.log(`  ${cat.padEnd(20)} ${(digP50 + "ms").padStart(10)} ${(discogsP50 + "ms").padStart(12)} ${winner.padStart(10)}`);
  }

  // Overall
  console.log("\n" + "=".repeat(80));
  console.log("OVERALL");
  console.log("=".repeat(80));

  const allDig = allResults.map((r) => r.digMs).sort((a, b) => a - b);
  const allDiscogs = allResults.map((r) => r.discogsMs).sort((a, b) => a - b);

  console.log(`  ${"".padEnd(20)} ${"Dig".padStart(10)} ${"Discogs".padStart(12)}`);
  console.log(`  ${"Min".padEnd(20)} ${(Math.min(...allDig) + "ms").padStart(10)} ${(Math.min(...allDiscogs) + "ms").padStart(12)}`);
  console.log(`  ${"p50".padEnd(20)} ${(percentile(allDig, 50) + "ms").padStart(10)} ${(percentile(allDiscogs, 50) + "ms").padStart(12)}`);
  console.log(`  ${"p95".padEnd(20)} ${(percentile(allDig, 95) + "ms").padStart(10)} ${(percentile(allDiscogs, 95) + "ms").padStart(12)}`);
  console.log(`  ${"Max".padEnd(20)} ${(Math.max(...allDig) + "ms").padStart(10)} ${(Math.max(...allDiscogs) + "ms").padStart(12)}`);

  const digWins = allResults.filter((r) => r.digMs < r.discogsMs).length;
  const discogsWins = allResults.filter((r) => r.discogsMs < r.digMs).length;
  const ties = allResults.length - digWins - discogsWins;

  console.log(`\n  Dig faster: ${digWins}/${allResults.length} queries`);
  console.log(`  Discogs faster: ${discogsWins}/${allResults.length} queries`);
  if (ties) console.log(`  Ties: ${ties}`);

  // Result quality comparison
  console.log("\n" + "=".repeat(80));
  console.log("RESULT QUALITY");
  console.log("=".repeat(80));

  for (const r of allResults.filter((_, i) => i < QUERIES.length)) {
    const digR = r.digResults ?? 0;
    const discR = r.discogsResults ?? 0;
    const match = digR > 0 && discR > 0 ? "both" : digR > 0 ? "dig-only" : discR > 0 ? "discogs-only" : "neither";
    if (match !== "both") {
      console.log(`  [${match.padEnd(12)}] ${r.description}: Dig=${digR}, Discogs=${discR}`);
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
