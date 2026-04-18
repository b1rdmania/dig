/**
 * Read-only production/local regression smoke.
 *
 * Usage:
 *   API_URL=https://dig-api.fly.dev WEB_URL=https://app.dig.baby npx tsx scripts/regression-smoke.ts
 *   API_URL=http://localhost:3000 WEB_URL=http://localhost:3002 npx tsx scripts/regression-smoke.ts
 */

type FailureCategory = "QUERY_TIMEOUT" | "EMPTY_SUCCESS_ANOMALY" | "NETWORK_ERROR" | "ASSERTION" | null;

type CheckResult = {
  name: string;
  ok: boolean;
  detail: string;
  blocking: boolean; // false = log only, never fails exit code
  failureCategory?: FailureCategory;
};

function classifyFailure(detail: string): FailureCategory {
  if (/HTTP 504|QUERY_TIMEOUT/.test(detail)) return "QUERY_TIMEOUT";
  if (/Timeout after|AbortError|TimeoutError|ECONNREFUSED|ENOTFOUND/.test(detail)) return "NETWORK_ERROR";
  if (/results=0/.test(detail)) return "EMPTY_SUCCESS_ANOMALY";
  return "ASSERTION";
}

const API_URL = (process.env.API_URL ?? "https://dig-api.fly.dev").replace(/\/$/, "");
const WEB_URL = (process.env.WEB_URL ?? "https://app.dig.baby").replace(/\/$/, "");

const FETCH_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;

async function getJson(path: string): Promise<any> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    try {
      const res = await fetch(path, {
        headers: { "user-agent": "dig-regression-smoke/1.0" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (!res.ok) {
        // Retry on 5xx (transient server errors); fail immediately on 4xx
        if (res.status >= 500 && attempt < MAX_RETRIES) {
          lastErr = new Error(`HTTP ${res.status} ${res.statusText} @ ${path} :: ${typeof body === "string" ? body : JSON.stringify(body)}`);
          continue;
        }
        throw new Error(`HTTP ${res.status} ${res.statusText} @ ${path} :: ${typeof body === "string" ? body : JSON.stringify(body)}`);
      }
      return body;
    } catch (err: any) {
      if (err?.name === "AbortError" || err?.name === "TimeoutError") {
        throw new Error(`Timeout after ${FETCH_TIMEOUT_MS}ms @ ${path}`);
      }
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_RETRIES) throw lastErr;
    }
  }
  throw lastErr!;
}

async function getStatus(path: string): Promise<number> {
  const res = await fetch(path, {
    headers: { "user-agent": "dig-regression-smoke/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  return res.status;
}

function asResultsCount(payload: any): number {
  if (!payload || !Array.isArray(payload.results)) return -1;
  return payload.results.length;
}

async function run(): Promise<void> {
  const checks: CheckResult[] = [];

  // API health
  try {
    const health = await getJson(`${API_URL}/v1/health`);
    checks.push({
      name: "api-health",
      ok: health?.status === "ok" && health?.postgres === true,
      detail: JSON.stringify({ status: health?.status, postgres: health?.postgres }),
      blocking: true,
    });
  } catch (err: any) {
    checks.push({ name: "api-health", ok: false, detail: String(err?.message ?? err), blocking: true });
  }

  // Search canaries
  const searchCases = [
    { name: "search-artist-aphex-twin", path: "/v1/search?q=aphex+twin&type=artist&limit=5", min: 1 },
    { name: "search-artist-radiohead", path: "/v1/search?q=radiohead&type=artist&limit=5", min: 1 },
    { name: "search-master-radiohead", path: "/v1/search?q=radiohead&type=master&limit=5", min: 1 },
    { name: "search-release-love", path: "/v1/search?q=love&type=release&limit=5", min: 1 },
  ];
  for (const test of searchCases) {
    try {
      const body = await getJson(`${API_URL}${test.path}`);
      const count = asResultsCount(body);
      const ok = count >= test.min;
      const detail = `results=${count}`;
      checks.push({
        name: test.name,
        ok,
        detail,
        blocking: true,
        failureCategory: ok ? null : classifyFailure(detail),
      });
    } catch (err: any) {
      const detail = String(err?.message ?? err);
      checks.push({ name: test.name, ok: false, detail, blocking: true, failureCategory: classifyFailure(detail) });
    }
  }

  // Non-blocking observation: known high-frequency FTS queries that may timeout.
  // Logged for visibility but never fails exit code. Track elapsed_ms for regression detection.
  const heavyQueries = [
    { name: "obs-heavy-madonna", path: "/v1/search?q=madonna&type=artist&limit=5" },
    { name: "obs-heavy-prince", path: "/v1/search?q=prince&type=artist&limit=5" },
  ];
  for (const test of heavyQueries) {
    try {
      const t0 = Date.now();
      const body = await getJson(`${API_URL}${test.path}`);
      const elapsed = Date.now() - t0;
      const count = asResultsCount(body);
      const degraded = body?.meta?.degraded_reason ?? null;
      checks.push({
        name: test.name,
        ok: count > 0 && !degraded,
        detail: `results=${count} elapsed_ms=${elapsed} degraded=${degraded ?? "none"}`,
        blocking: false,
      });
    } catch (err: any) {
      checks.push({ name: test.name, ok: false, detail: String(err?.message ?? err), blocking: false });
    }
  }

  // Retrieval canaries
  const retrievalCases = [
    { name: "entity-artist-3840", path: "/v1/artists/3840", key: "artist" },
    { name: "entity-label-1", path: "/v1/labels/1", key: "label" },
    { name: "entity-master-21004", path: "/v1/masters/21004", key: "master" },
    { name: "entity-release-9", path: "/v1/releases/9", key: "release" },
  ];
  for (const test of retrievalCases) {
    try {
      const body = await getJson(`${API_URL}${test.path}`);
      checks.push({ name: test.name, ok: !!body?.[test.key], detail: `has_${test.key}=${!!body?.[test.key]}`, blocking: true });
    } catch (err: any) {
      checks.push({ name: test.name, ok: false, detail: String(err?.message ?? err), blocking: true });
    }
  }

  // Traversal canaries
  const traversalCases = [
    { name: "traversal-artist-masters-3840", path: "/v1/artists/3840/masters?limit=5", blocking: true },
    { name: "traversal-artist-releases-148", path: "/v1/artists/148/releases?limit=5", blocking: true },
    // credits traversal is load-shed (5-cap semaphore) under external traffic — non-blocking observation
    { name: "obs-traversal-credits-769196", path: "/v1/artists/769196/credits?limit=5", blocking: false },
  ];
  for (const test of traversalCases) {
    try {
      const body = await getJson(`${API_URL}${test.path}`);
      const links = Array.isArray(body?.links) ? body.links.length : -1;
      checks.push({ name: test.name, ok: links >= 0, detail: `links=${links}`, blocking: test.blocking });
    } catch (err: any) {
      checks.push({ name: test.name, ok: false, detail: String(err?.message ?? err), blocking: test.blocking });
    }
  }

  // Web route status checks
  const webCases = [
    { name: "web-home", path: "/" },
    { name: "web-artist-148", path: "/artist/148" },
    { name: "web-release-21004", path: "/release/21004" },
    { name: "web-version-9", path: "/version/9" },
    { name: "web-label-1", path: "/label/1" },
    { name: "web-mcp-page", path: "/mcp" }, // archived notice page; should still 200
  ];
  for (const test of webCases) {
    try {
      const status = await getStatus(`${WEB_URL}${test.path}`);
      checks.push({ name: test.name, ok: status >= 200 && status < 400, detail: `status=${status}`, blocking: true });
    } catch (err: any) {
      checks.push({ name: test.name, ok: false, detail: String(err?.message ?? err), blocking: true });
    }
  }

  // Summary
  const blocking = checks.filter((c) => c.blocking);
  const observations = checks.filter((c) => !c.blocking);
  const failedBlocking = blocking.filter((c) => !c.ok);
  const passedBlocking = blocking.filter((c) => c.ok);

  console.log(`\nRegression smoke results: ${passedBlocking.length}/${blocking.length} passed`);
  for (const check of blocking) {
    const marker = check.ok ? "PASS" : "FAIL";
    console.log(`${marker} ${check.name} :: ${check.detail}`);
  }

  if (observations.length > 0) {
    console.log(`\nObservations (non-blocking):`);
    for (const obs of observations) {
      const marker = obs.ok ? "OK  " : "WARN";
      console.log(`${marker} ${obs.name} :: ${obs.detail}`);
    }
  }

  if (failedBlocking.length > 0) {
    // Emit failure category breakdown for diagnosis
    const categoryCounts: Partial<Record<NonNullable<FailureCategory>, number>> = {};
    for (const c of failedBlocking) {
      const cat = c.failureCategory ?? "ASSERTION";
      categoryCounts[cat] = (categoryCounts[cat] ?? 0) + 1;
    }
    console.log(`\nFailure categories:`);
    for (const [cat, count] of Object.entries(categoryCounts)) {
      console.log(`  ${cat}: ${count}`);
    }
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Regression smoke failed to execute:", err);
  process.exit(1);
});
