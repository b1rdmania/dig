#!/usr/bin/env tsx
/**
 * Route 404 Sweep — daily sampled check for dead entity URLs.
 *
 * Fetches sampled IDs from the SEO cohort endpoint, requests corresponding
 * web routes, and reports 404 rates per entity class.
 *
 * Usage:
 *   API_URL=https://dig-api.fly.dev WEB_URL=https://app.dig.baby npx tsx scripts/route-404-sweep.ts
 *
 * Exit code: 0 = within thresholds, 1 = threshold exceeded
 */

const API_URL = process.env.API_URL ?? "https://dig-api.fly.dev";
const WEB_URL = process.env.WEB_URL ?? "https://app.dig.baby";
const SAMPLE_N = { artists: 300, releases: 300, labels: 300, versions: 100 };
const CONCURRENCY = 10;
const REQUEST_TIMEOUT_MS = 15_000;

// Hard-fail thresholds (per spec §5)
const THRESHOLD_PER_CLASS = 0.02;  // 2% per route class
const THRESHOLD_COMBINED = 0.01;   // 1% combined

interface RouteResult {
  url: string;
  status: number | null;
  verdict: "ok" | "not_found" | "other";
  elapsed_ms: number;
}

interface ClassSummary {
  route_class: string;
  total: number;
  ok: number;
  not_found: number;
  other: number;
  not_found_rate: number;
  other_rate: number;
  sample_failures: string[];
}

async function fetchCohortIds(type: string, limit: number): Promise<number[]> {
  const url = `${API_URL}/v1/seo/cohort?type=${type}&limit=${limit}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`  Cohort fetch failed for ${type}: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json() as { ids?: number[] };
    return data.ids ?? [];
  } catch (err: any) {
    console.warn(`  Cohort fetch error for ${type}: ${err?.message}`);
    return [];
  }
}

async function checkUrl(url: string): Promise<RouteResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": "dig-404-sweep/1.0" },
      redirect: "follow",
    });
    const elapsed_ms = Date.now() - start;
    const verdict = res.status === 200 ? "ok" : res.status === 404 ? "not_found" : "other";
    return { url, status: res.status, verdict, elapsed_ms };
  } catch {
    return { url, status: null, verdict: "other", elapsed_ms: Date.now() - start };
  }
}

async function runBatched(urls: string[]): Promise<RouteResult[]> {
  const results: RouteResult[] = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(batch.map(checkUrl));
    results.push(...batchResults);
    process.stdout.write(`\r  ${results.length}/${urls.length}`);
  }
  process.stdout.write("\n");
  return results;
}

function summarise(route_class: string, results: RouteResult[]): ClassSummary {
  const ok = results.filter((r) => r.verdict === "ok").length;
  const not_found = results.filter((r) => r.verdict === "not_found").length;
  const other = results.filter((r) => r.verdict === "other").length;
  const total = results.length;
  const sample_failures = results
    .filter((r) => r.verdict === "not_found")
    .slice(0, 20)
    .map((r) => r.url);
  return {
    route_class,
    total,
    ok,
    not_found,
    other,
    not_found_rate: total > 0 ? not_found / total : 0,
    other_rate: total > 0 ? other / total : 0,
    sample_failures,
  };
}

async function main() {
  console.log(`\nRoute 404 Sweep`);
  console.log(`API:  ${API_URL}`);
  console.log(`Web:  ${WEB_URL}\n`);

  const summaries: ClassSummary[] = [];

  // Artists
  console.log(`Fetching artist cohort (N=${SAMPLE_N.artists})...`);
  const artistIds = await fetchCohortIds("artists", SAMPLE_N.artists);
  console.log(`  ${artistIds.length} IDs — checking web routes...`);
  const artistUrls = artistIds.map((id) => `${WEB_URL}/artist/${id}`);
  const artistResults = await runBatched(artistUrls);
  summaries.push(summarise("artist", artistResults));

  // Releases
  console.log(`Fetching release cohort (N=${SAMPLE_N.releases})...`);
  const releaseIds = await fetchCohortIds("releases", SAMPLE_N.releases);
  console.log(`  ${releaseIds.length} IDs — checking web routes...`);
  const releaseUrls = releaseIds.map((id) => `${WEB_URL}/release/${id}`);
  const releaseResults = await runBatched(releaseUrls);
  summaries.push(summarise("release", releaseResults));

  // Labels
  console.log(`Fetching label cohort (N=${SAMPLE_N.labels})...`);
  const labelIds = await fetchCohortIds("labels", SAMPLE_N.labels);
  console.log(`  ${labelIds.length} IDs — checking web routes...`);
  const labelUrls = labelIds.map((id) => `${WEB_URL}/label/${id}`);
  const labelResults = await runBatched(labelUrls);
  summaries.push(summarise("label", labelResults));

  // Versions — sample from releases cohort, request /version/:id
  console.log(`Sampling versions (N=${SAMPLE_N.versions})...`);
  const versionIds = releaseIds.slice(0, SAMPLE_N.versions);
  console.log(`  ${versionIds.length} IDs — checking web routes...`);
  const versionUrls = versionIds.map((id) => `${WEB_URL}/version/${id}`);
  const versionResults = await runBatched(versionUrls);
  summaries.push(summarise("version", versionResults));

  // Print report
  const totalChecked = summaries.reduce((s, c) => s + c.total, 0);
  const totalNotFound = summaries.reduce((s, c) => s + c.not_found, 0);
  const combinedRate = totalChecked > 0 ? totalNotFound / totalChecked : 0;

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Route 404 Sweep Results\n`);
  for (const s of summaries) {
    const pct = (s.not_found_rate * 100).toFixed(2);
    const flag = s.not_found_rate > THRESHOLD_PER_CLASS ? " ✗ EXCEEDS THRESHOLD" : "";
    console.log(`  ${s.route_class.padEnd(10)} ${s.ok}/${s.total} ok  ${s.not_found} not_found (${pct}%)  ${s.other} other${flag}`);
    if (s.sample_failures.length > 0) {
      for (const f of s.sample_failures.slice(0, 5)) {
        console.log(`    404: ${f}`);
      }
      if (s.sample_failures.length > 5) {
        console.log(`    ... and ${s.sample_failures.length - 5} more (see report)`);
      }
    }
  }
  console.log(`\n  Combined 404 rate: ${(combinedRate * 100).toFixed(2)}% (threshold: ${THRESHOLD_COMBINED * 100}%)`);

  // Write JSON report
  const report = {
    generated_at: new Date().toISOString(),
    api_url: API_URL,
    web_url: WEB_URL,
    summary: {
      total_checked: totalChecked,
      total_not_found: totalNotFound,
      combined_not_found_rate: combinedRate,
    },
    classes: summaries,
  };

  const fs = await import("fs");
  fs.writeFileSync("route-404-report.json", JSON.stringify(report, null, 2));
  console.log(`\nReport written to: route-404-report.json`);

  // Gate
  const perClassFail = summaries.some((s) => s.not_found_rate > THRESHOLD_PER_CLASS);
  const combinedFail = combinedRate > THRESHOLD_COMBINED;

  if (perClassFail || combinedFail) {
    if (perClassFail) {
      const failed = summaries.filter((s) => s.not_found_rate > THRESHOLD_PER_CLASS);
      console.log(`\n✗ FAILED — per-class threshold exceeded: ${failed.map((s) => s.route_class).join(", ")}\n`);
    }
    if (combinedFail) {
      console.log(`\n✗ FAILED — combined 404 rate ${(combinedRate * 100).toFixed(2)}% exceeds ${THRESHOLD_COMBINED * 100}%\n`);
    }
    process.exit(1);
  }

  console.log(`\n✓ PASSED — 404 rates within thresholds\n`);
}

main().catch((err) => {
  console.error("Sweep crashed:", err);
  process.exit(1);
});
