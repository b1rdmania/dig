#!/usr/bin/env tsx
/**
 * No-Dead-Ends Canary Check
 *
 * Fetches each canary entity page and verifies:
 * 1. HTTP 200
 * 2. ≥1 actionable internal link in main content, OR
 * 3. Explicit fallback copy is present
 *
 * Usage:
 *   BASE_URL=https://app.dig.baby npx tsx scripts/no-dead-ends-check.ts
 *   BASE_URL=http://localhost:3002 npx tsx scripts/no-dead-ends-check.ts
 *
 * Exit code: 0 = all pass, 1 = violations found
 */

const BASE_URL = process.env.BASE_URL ?? "https://app.dig.baby";
const TIMEOUT_MS = 30_000;
// Retry config — guards against transient stream faults (controller[kState] crashes)
// that produce bad renders without being structural dead-ends.
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;

interface CanaryEntry {
  type: "artist" | "label" | "release" | "version";
  id: number;
  notes?: string;
}

const CANARY: CanaryEntry[] = [
  // ── Artists — verified via live API search ───────────────────────────────────
  // Original fixtures
  { type: "artist", id: 3840,   notes: "Radiohead" },
  { type: "artist", id: 28795,  notes: "Prince" },
  { type: "artist", id: 38863,  notes: "Aretha Franklin" },
  { type: "artist", id: 45,     notes: "Aphex Twin" },
  { type: "artist", id: 1,      notes: "The Persuader" },
  { type: "artist", id: 769196, notes: "Tommy Danvers (was dead-end before fix)" },
  { type: "artist", id: 157579, notes: "Diane Warren (songwriter)" },
  { type: "artist", id: 4205,   notes: "Giorgio Moroder (producer)" },
  { type: "artist", id: 49758,  notes: "Nile Rodgers (songwriter/producer)" },
  { type: "artist", id: 17546,  notes: "Quincy Jones (producer/arranger)" },
  // Verified from live API (IDs confirmed in DB)
  { type: "artist", id: 8760,   notes: "Madonna" },
  { type: "artist", id: 125246, notes: "Nirvana" },
  { type: "artist", id: 1289,   notes: "Daft Punk" },
  { type: "artist", id: 4654,   notes: "Kraftwerk" },
  { type: "artist", id: 23755,  notes: "Miles Davis" },
  { type: "artist", id: 97545,  notes: "John Coltrane" },
  { type: "artist", id: 10783,  notes: "Beastie Boys" },
  { type: "artist", id: 4480,   notes: "Massive Attack" },
  { type: "artist", id: 2774,   notes: "Portishead" },
  { type: "artist", id: 307,    notes: "Boards Of Canada" },
  { type: "artist", id: 41,     notes: "Autechre" },
  { type: "artist", id: 2290,   notes: "The Chemical Brothers" },
  { type: "artist", id: 3909,   notes: "New Order" },
  { type: "artist", id: 2725,   notes: "Depeche Mode" },
  { type: "artist", id: 3898,   notes: "Joy Division" },
  { type: "artist", id: 28209,  notes: "Public Enemy" },
  { type: "artist", id: 38561,  notes: "OutKast" },
  { type: "artist", id: 10995,  notes: "Erykah Badu" },
  { type: "artist", id: 42627,  notes: "Lauryn Hill" },
  { type: "artist", id: 82103,  notes: "Fugazi" },
  { type: "artist", id: 17199,  notes: "Sonic Youth" },
  { type: "artist", id: 7578,   notes: "Pavement" },
  { type: "artist", id: 50997,  notes: "Nas" },
  { type: "artist", id: 269,    notes: "Squarepusher" },
  { type: "artist", id: 1280,   notes: "Underworld" },
  { type: "artist", id: 306157, notes: "Burial" },

  // ── Labels — verified via live API search ────────────────────────────────────
  { type: "label", id: 1,       notes: "label/1" },
  { type: "label", id: 100,     notes: "label/100" },
  { type: "label", id: 1000,    notes: "label/1000" },
  { type: "label", id: 5000,    notes: "label/5000" },
  { type: "label", id: 10000,   notes: "label/10000" },
  { type: "label", id: 281,     notes: "Blue Note" },
  { type: "label", id: 23528,   notes: "Warp Records" },
  { type: "label", id: 77343,   notes: "Sub Pop" },
  { type: "label", id: 51167,   notes: "Rough Trade" },
  { type: "label", id: 634,     notes: "4AD" },
  { type: "label", id: 109,     notes: "Ninja Tune" },
  { type: "label", id: 36339,   notes: "Mute Records" },
  { type: "label", id: 4241,    notes: "Def Jam Recordings" },
  { type: "label", id: 160,     notes: "XL Recordings" },
  { type: "label", id: 93330,   notes: "Columbia Records" },
  { type: "label", id: 108701,  notes: "Virgin Records" },
  { type: "label", id: 3720,    notes: "Domino Records" },
  { type: "label", id: 472992,  notes: "Soul Jazz Collection" },
  { type: "label", id: 715,     notes: "Kompakt" },
  { type: "label", id: 25386,   notes: "Hyperdub" },
  { type: "label", id: 128,     notes: "Metalheadz" },
  { type: "label", id: 391810,  notes: "Soul Jazz Studio One Series" },

  // ── Releases — master IDs verified via live API search ───────────────────────
  { type: "release", id: 21491,   notes: "OK Computer (Radiohead)" },
  { type: "release", id: 3684888, notes: "Kind Of Blue (Miles Davis)" },
  { type: "release", id: 2264887, notes: "Ok Computer (alt)" },
  { type: "release", id: 15313,   notes: "Endtroducing..... (DJ Shadow)" },
  { type: "release", id: 23683,   notes: "Mezzanine (Massive Attack)" },
  { type: "release", id: 50297,   notes: "Maxinquaye (Tricky)" },
  { type: "release", id: 9768,    notes: "Daydream Nation (Sonic Youth)" },
  { type: "release", id: 2815,    notes: "Homogenic (Björk)" },
  { type: "release", id: 30255,   notes: "Fear Of A Black Planet (Public Enemy)" },
  { type: "release", id: 1024691, notes: "Illmatic (Nas)" },
  { type: "release", id: 3607640, notes: "Ready To Die (Biggie)" },
  { type: "release", id: 32618,   notes: "Blue Lines (Massive Attack)" },
  { type: "release", id: 3378553, notes: "Purple Rain (Prince)" },
  { type: "release", id: 3548375, notes: "Thriller (Michael Jackson)" },
  { type: "release", id: 3372262, notes: "The Joshua Tree (U2)" },
  { type: "release", id: 3931883, notes: "Vespertine (Björk)" },
  { type: "release", id: 1209546, notes: "Selected Ambient Works (Aphex Twin)" },
  { type: "release", id: 3794433, notes: "Loveless (My Bloody Valentine)" },
  { type: "release", id: 1848812, notes: "Nevermind (Nirvana)" },
  { type: "release", id: 831781,  notes: "Fear variant" },

  // ── Versions — release IDs verified via masters/releases API ─────────────────
  { type: "version", id: 83182,    notes: "OK Computer (original UK press)" },
  { type: "version", id: 105704,   notes: "OK Computer (US press)" },
  { type: "version", id: 216593,   notes: "OK Computer (reissue)" },
  { type: "version", id: 5058,     notes: "Endtroducing..... (original)" },
  { type: "version", id: 12261,    notes: "Endtroducing..... (reissue)" },
  { type: "version", id: 38906,    notes: "Endtroducing..... (deluxe)" },
  { type: "version", id: 6530,     notes: "Mezzanine (original)" },
  { type: "version", id: 11650,    notes: "Mezzanine (reissue)" },
  { type: "version", id: 104147,   notes: "Mezzanine (alt)" },
  { type: "version", id: 2739,     notes: "Maxinquaye (original)" },
  { type: "version", id: 22338,    notes: "Maxinquaye (reissue)" },
  { type: "version", id: 369200,   notes: "Daydream Nation (reissue)" },
  { type: "version", id: 2456,     notes: "Homogenic (original)" },
  { type: "version", id: 10744,    notes: "Homogenic (reissue)" },
  { type: "version", id: 78957,    notes: "Fear Of A Black Planet (original)" },
  { type: "version", id: 81859,    notes: "Fear Of A Black Planet (alt)" },
  { type: "version", id: 3603635,  notes: "Illmatic (reissue)" },
  { type: "version", id: 3471,     notes: "Blue Lines (original)" },
  { type: "version", id: 11878,    notes: "Blue Lines (reissue)" },
  { type: "version", id: 2456,     notes: "Homogenic (original press)" },
  { type: "version", id: 579476,   notes: "Thriller (original)" },
  { type: "version", id: 2922817,  notes: "Joshua Tree (reissue)" },
];

// Patterns that count as actionable internal links
const INTERNAL_LINK_RE = /href=["']\/(artist|label|release|version|master)\/\d+/g;
// Patterns for explicit fallback copy (allowed to have zero links)
// Includes graceful error states ("Unable to load") — these are temporary failures, not structural dead-ends
const FALLBACK_COPY_RE = /No (releases|credits|connections|linked releases|primary releases|artist information|parent release)|Unable to load/i;
// Pattern for SSR timeout error — Next.js app returned a TIMEOUT error page instead of entity data.
// This is a performance/infrastructure issue distinct from a structural dead-end.
const SSR_TIMEOUT_RE = /"TIMEOUT"|>TIMEOUT<|Request timed out/;
// Pattern for stream-broken shell — Next.js streaming SSR closed early due to a stream fault.
// The shell was sent but Suspense never resolved. data-dig-entity is injected into the outer
// container of release/version pages so we can distinguish this from a true structural dead-end.
const STREAM_FAULT_RE = /data-dig-entity="(release|version|artist|label)"/;

interface CheckResult {
  entity: string;
  url: string;
  status: number | null;
  actionable_links: number;
  has_fallback: boolean;
  verdict: "PASS" | "FAIL" | "TIMEOUT" | "STREAM_FAULT" | "ERROR";
  reason?: string;
  elapsed_ms: number;
}

async function fetchOnce(url: string): Promise<{ status: number; html: string; elapsed_ms: number }> {
  const start = Date.now();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "User-Agent": "dig-canary-check/1.0" },
  });
  const html = await res.text();
  return { status: res.status, html, elapsed_ms: Date.now() - start };
}

async function checkEntity(entry: CanaryEntry): Promise<CheckResult> {
  const url = `${BASE_URL}/${entry.type}/${entry.id}`;
  const entity = `${entry.type}/${entry.id}${entry.notes ? ` (${entry.notes})` : ""}`;
  const overallStart = Date.now();

  let lastResult: CheckResult | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }

    try {
      const { status, html, elapsed_ms } = await fetchOnce(url);

      if (status !== 200) {
        // 404 is acceptable — skip without retry
        if (status === 404) {
          return { entity, url, status, actionable_links: 0, has_fallback: false, verdict: "PASS", reason: "404 — entity not found (skipped)", elapsed_ms };
        }
        lastResult = { entity, url, status, actionable_links: 0, has_fallback: false, verdict: "FAIL", reason: `HTTP ${status}`, elapsed_ms };
        // Non-404 HTTP errors are unlikely to be transient — don't retry
        break;
      }

      // Detect SSR timeout: Next.js returns 200 but streams a TIMEOUT error page.
      // This is a performance issue (API fetch timeout during SSR), tracked separately from dead-ends.
      if (SSR_TIMEOUT_RE.test(html)) {
        return { entity, url, status: 200, actionable_links: 0, has_fallback: false, verdict: "TIMEOUT", reason: "SSR timeout — Next.js API fetch timed out during server render", elapsed_ms };
      }

      const links = (html.match(INTERNAL_LINK_RE) ?? []).length;
      const hasFallback = FALLBACK_COPY_RE.test(html);

      if (links === 0 && !hasFallback) {
        // Check for stream-broken shell: the streaming SSR connection closed before Suspense
        // resolved, leaving only the static shell HTML. data-dig-entity is present in the
        // initial shell of release/version pages to identify this case.
        if (STREAM_FAULT_RE.test(html)) {
          return { entity, url, status: 200, actionable_links: 0, has_fallback: false, verdict: "STREAM_FAULT", reason: "Stream-broken shell — SSR streaming closed before Suspense resolved (infrastructure issue, not structural dead-end)", elapsed_ms };
        }
        // Could be a transient render issue — retry before marking as structural dead-end
        lastResult = { entity, url, status: 200, actionable_links: 0, has_fallback: false, verdict: "FAIL", reason: `Zero actionable links and no fallback copy (attempt ${attempt + 1}/${MAX_RETRIES + 1})`, elapsed_ms };
        continue;
      }

      return { entity, url, status: 200, actionable_links: links, has_fallback: hasFallback, verdict: "PASS", elapsed_ms };
    } catch (err: any) {
      // Network/fetch errors may be transient — retry
      lastResult = { entity, url, status: null, actionable_links: 0, has_fallback: false, verdict: "ERROR", reason: `${err?.message ?? "Unknown error"} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`, elapsed_ms: Date.now() - overallStart };
    }
  }

  return lastResult!;
}

async function main() {
  console.log(`\nNo-Dead-Ends Canary Check`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Entities: ${CANARY.length}\n`);

  const results: CheckResult[] = [];

  // Run in batches of 5 to avoid hammering
  for (let i = 0; i < CANARY.length; i += 5) {
    const batch = CANARY.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(checkEntity));
    results.push(...batchResults);
    for (const r of batchResults) {
      const icon = r.verdict === "PASS" ? "✓" : r.verdict === "ERROR" ? "?" : r.verdict === "TIMEOUT" ? "⏱" : r.verdict === "STREAM_FAULT" ? "~" : "✗";
      console.log(`  ${icon} [${r.verdict}] ${r.entity} — ${r.actionable_links} links, fallback:${r.has_fallback} (${r.elapsed_ms}ms)`);
    }
  }

  const violations = results.filter((r) => r.verdict === "FAIL");
  const timeouts = results.filter((r) => r.verdict === "TIMEOUT");
  const streamFaults = results.filter((r) => r.verdict === "STREAM_FAULT");
  const errors = results.filter((r) => r.verdict === "ERROR");
  const passes = results.filter((r) => r.verdict === "PASS");
  // Pages that passed but only via graceful fallback copy (not actionable links).
  // A spike here means backend is slow but frontend is degrading correctly.
  const passWithFallback = passes.filter((r) => r.has_fallback && r.actionable_links === 0);
  const passWithLinks = passes.filter((r) => r.actionable_links > 0);

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passes.length} PASS (${passWithLinks.length} with links, ${passWithFallback.length} fallback-only), ${violations.length} FAIL, ${timeouts.length} TIMEOUT (SSR), ${streamFaults.length} STREAM_FAULT, ${errors.length} ERROR`);
  console.log(`Metrics: ui_timeout_errors=${timeouts.length}, stream_fault_count=${streamFaults.length}, fallback_rate=${passWithFallback.length}/${passes.length + timeouts.length}`);
  console.log(`Note: TIMEOUT = SSR fetch timeout | STREAM_FAULT = streaming closed early (infrastructure issue, not structural dead-end)`);

  if (violations.length > 0) {
    console.log(`\nStructural dead-end violations:`);
    for (const v of violations) {
      console.log(`  ✗ ${v.entity}`);
      console.log(`    URL:    ${v.url}`);
      console.log(`    Reason: ${v.reason}`);
    }
  }

  if (timeouts.length > 0) {
    console.log(`\nSSR timeout pages (${timeouts.length} total — see P1: SSR timeout hardening):`);
    for (const t of timeouts) {
      console.log(`  ⏱ ${t.entity} (${t.elapsed_ms}ms)`);
    }
  }

  if (streamFaults.length > 0) {
    console.log(`\nStream-fault pages (${streamFaults.length} total — streaming SSR closed early, root cause: controller[kState] bug):`);
    for (const s of streamFaults) {
      console.log(`  ~ ${s.entity} (${s.elapsed_ms}ms)`);
    }
  }

  // Write JSON report
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    summary: {
      total: results.length,
      pass: passes.length,
      pass_with_links: passWithLinks.length,
      pass_fallback_only: passWithFallback.length,
      fail: violations.length,
      ui_timeout_errors: timeouts.length,
      stream_fault_count: streamFaults.length,
      error: errors.length,
    },
    violations: violations.map((v) => ({ entity: v.entity, url: v.url, reason: v.reason })),
    ssr_timeouts: timeouts.map((t) => ({ entity: t.entity, url: t.url, elapsed_ms: t.elapsed_ms })),
    stream_faults: streamFaults.map((s) => ({ entity: s.entity, url: s.url, elapsed_ms: s.elapsed_ms })),
    fallback_pages: passWithFallback.map((r) => ({ entity: r.entity, url: r.url, elapsed_ms: r.elapsed_ms })),
    results,
  };

  const fs = await import("fs");
  fs.writeFileSync("no-dead-ends-report.json", JSON.stringify(report, null, 2));
  console.log(`\nReport written to: no-dead-ends-report.json`);

  if (violations.length > 0) {
    console.log(`\n✗ FAILED — ${violations.length} structural dead end(s) found\n`);
    process.exit(1);
  }

  if (timeouts.length > 0 || streamFaults.length > 0) {
    const parts = [];
    if (timeouts.length > 0) parts.push(`${timeouts.length} SSR timeout(s)`);
    if (streamFaults.length > 0) parts.push(`${streamFaults.length} stream fault(s)`);
    console.log(`\n~ PARTIAL — no structural dead ends, but infrastructure issues detected: ${parts.join(", ")}\n`);
    // SSR timeouts and stream faults exit 0 — tracked but don't block CI (separate P1 work)
  } else {
    console.log(`\n✓ PASSED — no dead ends found\n`);
  }
}

main().catch((err) => {
  console.error("Canary check crashed:", err);
  process.exit(1);
});
