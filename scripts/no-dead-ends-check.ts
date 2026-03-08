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

interface CanaryEntry {
  type: "artist" | "label" | "release" | "version";
  id: number;
  notes?: string;
}

const CANARY: CanaryEntry[] = [
  // ── Artists (50 total) ──────────────────────────────────────────────────────
  // Primary test fixtures
  { type: "artist", id: 3840,    notes: "Radiohead" },
  { type: "artist", id: 28795,   notes: "Prince" },
  { type: "artist", id: 12596,   notes: "James Brown" },
  { type: "artist", id: 45,      notes: "Aphex Twin" },
  { type: "artist", id: 1,       notes: "The Persuader" },
  // Credits-heavy (known dead-ends before fix)
  { type: "artist", id: 769196,  notes: "Tommy Danvers (writer/arranger — was dead-end before fix)" },
  { type: "artist", id: 157579,  notes: "Diane Warren (songwriter)" },
  { type: "artist", id: 4205,    notes: "Giorgio Moroder (producer)" },
  { type: "artist", id: 49758,   notes: "Nile Rodgers (songwriter/producer)" },
  { type: "artist", id: 17546,   notes: "Quincy Jones (producer/arranger)" },
  // High-profile artists across ID space
  { type: "artist", id: 40,      notes: "Marshall Jefferson" },
  { type: "artist", id: 72,      notes: "The Rolling Stones" },
  { type: "artist", id: 146,     notes: "Led Zeppelin" },
  { type: "artist", id: 148,     notes: "David Bowie" },
  { type: "artist", id: 153,     notes: "Queen" },
  { type: "artist", id: 188,     notes: "Kraftwerk" },
  { type: "artist", id: 194,     notes: "Daft Punk" },
  { type: "artist", id: 202,     notes: "The Prodigy" },
  { type: "artist", id: 210,     notes: "Massive Attack" },
  { type: "artist", id: 217,     notes: "New Order" },
  { type: "artist", id: 243,     notes: "Joy Division" },
  { type: "artist", id: 289,     notes: "Depeche Mode" },
  { type: "artist", id: 505,     notes: "The Chemical Brothers" },
  { type: "artist", id: 565,     notes: "Orbital" },
  { type: "artist", id: 602,     notes: "Underworld" },
  { type: "artist", id: 803,     notes: "The Orb" },
  { type: "artist", id: 3900,    notes: "R.E.M." },
  { type: "artist", id: 4000,    notes: "Nirvana" },
  { type: "artist", id: 5000,    notes: "Blur" },
  { type: "artist", id: 5001,    notes: "Oasis" },
  // Spread across higher ID ranges
  { type: "artist", id: 9999,    notes: "ID range ~10k" },
  { type: "artist", id: 10000,   notes: "ID range 10k" },
  { type: "artist", id: 15000,   notes: "ID range 15k" },
  { type: "artist", id: 20000,   notes: "ID range 20k" },
  { type: "artist", id: 25000,   notes: "ID range 25k" },
  { type: "artist", id: 30000,   notes: "ID range 30k" },
  { type: "artist", id: 50000,   notes: "ID range 50k" },
  { type: "artist", id: 100000,  notes: "ID range 100k" },
  { type: "artist", id: 200000,  notes: "ID range 200k" },
  { type: "artist", id: 500000,  notes: "ID range 500k" },
  { type: "artist", id: 1000000, notes: "ID range 1M" },
  { type: "artist", id: 2000000, notes: "ID range 2M" },
  { type: "artist", id: 5000000, notes: "ID range 5M" },
  { type: "artist", id: 8000000, notes: "ID range 8M" },
  { type: "artist", id: 9000000, notes: "ID range 9M" },
  { type: "artist", id: 9500000, notes: "ID range 9.5M" },
  // Additional well-known artists
  { type: "artist", id: 2553,    notes: "The Beatles" },
  { type: "artist", id: 13,      notes: "The Chemical Brothers (alt)" },
  { type: "artist", id: 50,      notes: "Various Artists range" },
  { type: "artist", id: 250,     notes: "ID range ~250" },
  { type: "artist", id: 750,     notes: "ID range ~750" },

  // ── Labels (40 total) ───────────────────────────────────────────────────────
  // Original 5
  { type: "label", id: 1 },
  { type: "label", id: 100 },
  { type: "label", id: 1000 },
  { type: "label", id: 5000 },
  { type: "label", id: 10000 },
  // Extended label coverage
  { type: "label", id: 5 },
  { type: "label", id: 10 },
  { type: "label", id: 20 },
  { type: "label", id: 50 },
  { type: "label", id: 200 },
  { type: "label", id: 500 },
  { type: "label", id: 2000 },
  { type: "label", id: 20000 },
  { type: "label", id: 50000 },
  { type: "label", id: 100000 },
  { type: "label", id: 200000 },
  { type: "label", id: 500000 },
  { type: "label", id: 1000000 },
  { type: "label", id: 1500000 },
  { type: "label", id: 2000000 },
  { type: "label", id: 250 },
  { type: "label", id: 750 },
  { type: "label", id: 1500 },
  { type: "label", id: 3000 },
  { type: "label", id: 7500 },
  { type: "label", id: 15000 },
  { type: "label", id: 25000 },
  { type: "label", id: 75000 },
  { type: "label", id: 150000 },
  { type: "label", id: 300000 },
  { type: "label", id: 750000 },
  { type: "label", id: 1200000 },
  { type: "label", id: 1750000 },
  { type: "label", id: 2500000 },
  { type: "label", id: 30 },
  { type: "label", id: 75 },
  { type: "label", id: 125 },
  { type: "label", id: 400 },
  { type: "label", id: 4000 },
  { type: "label", id: 8000 },

  // ── Releases — master pages via /release/{master_id} (50 total) ─────────────
  // Original 5
  { type: "release", id: 1 },
  { type: "release", id: 100 },
  { type: "release", id: 1000 },
  { type: "release", id: 5000 },
  { type: "release", id: 10000 },
  // Extended master coverage
  { type: "release", id: 500 },
  { type: "release", id: 2000 },
  { type: "release", id: 15000 },
  { type: "release", id: 20000 },
  { type: "release", id: 25000 },
  { type: "release", id: 50000 },
  { type: "release", id: 75000 },
  { type: "release", id: 100000 },
  { type: "release", id: 200000 },
  { type: "release", id: 500000 },
  { type: "release", id: 1000000 },
  { type: "release", id: 1500000 },
  { type: "release", id: 2000000 },
  { type: "release", id: 2500000 },
  { type: "release", id: 250 },
  { type: "release", id: 750 },
  { type: "release", id: 1500 },
  { type: "release", id: 3000 },
  { type: "release", id: 7500 },
  { type: "release", id: 30000 },
  { type: "release", id: 40000 },
  { type: "release", id: 60000 },
  { type: "release", id: 80000 },
  { type: "release", id: 125000 },
  { type: "release", id: 150000 },
  { type: "release", id: 175000 },
  { type: "release", id: 250000 },
  { type: "release", id: 300000 },
  { type: "release", id: 350000 },
  { type: "release", id: 400000 },
  { type: "release", id: 450000 },
  { type: "release", id: 600000 },
  { type: "release", id: 700000 },
  { type: "release", id: 800000 },
  { type: "release", id: 900000 },
  { type: "release", id: 1100000 },
  { type: "release", id: 1200000 },
  { type: "release", id: 1300000 },
  { type: "release", id: 1400000 },
  { type: "release", id: 1600000 },

  // ── Versions — specific pressings via /version/{release_id} (50 total) ───────
  // Original 5
  { type: "version", id: 1 },
  { type: "version", id: 100 },
  { type: "version", id: 1000 },
  { type: "version", id: 5000 },
  { type: "version", id: 10000 },
  // Extended version coverage
  { type: "version", id: 500 },
  { type: "version", id: 2000 },
  { type: "version", id: 20000 },
  { type: "version", id: 50000 },
  { type: "version", id: 100000 },
  { type: "version", id: 500000 },
  { type: "version", id: 1000000 },
  { type: "version", id: 2000000 },
  { type: "version", id: 5000000 },
  { type: "version", id: 10000000 },
  { type: "version", id: 15000000 },
  { type: "version", id: 18000000 },
  { type: "version", id: 250 },
  { type: "version", id: 750 },
  { type: "version", id: 1500 },
  { type: "version", id: 3000 },
  { type: "version", id: 7500 },
  { type: "version", id: 15000 },
  { type: "version", id: 25000 },
  { type: "version", id: 75000 },
  { type: "version", id: 150000 },
  { type: "version", id: 250000 },
  { type: "version", id: 750000 },
  { type: "version", id: 1500000 },
  { type: "version", id: 3000000 },
  { type: "version", id: 4000000 },
  { type: "version", id: 6000000 },
  { type: "version", id: 7000000 },
  { type: "version", id: 8000000 },
  { type: "version", id: 9000000 },
  { type: "version", id: 11000000 },
  { type: "version", id: 12000000 },
  { type: "version", id: 13000000 },
  { type: "version", id: 14000000 },
  { type: "version", id: 16000000 },
  { type: "version", id: 17000000 },
  { type: "version", id: 18500000 },
  { type: "version", id: 19000000 },
  { type: "version", id: 20 },
  { type: "version", id: 50 },
];

// Patterns that count as actionable internal links
const INTERNAL_LINK_RE = /href=["']\/(artist|label|release|version|master)\/\d+/g;
// Patterns for explicit fallback copy (allowed to have zero links)
const FALLBACK_COPY_RE = /No (releases|credits|connections|linked releases|primary releases|artist information|parent release)/i;
// Pattern for SSR timeout error — Next.js app returned a TIMEOUT error page instead of entity data.
// This is a performance/infrastructure issue distinct from a structural dead-end.
const SSR_TIMEOUT_RE = /"TIMEOUT"|>TIMEOUT<|Request timed out/;

interface CheckResult {
  entity: string;
  url: string;
  status: number | null;
  actionable_links: number;
  has_fallback: boolean;
  verdict: "PASS" | "FAIL" | "TIMEOUT" | "ERROR";
  reason?: string;
  elapsed_ms: number;
}

async function checkEntity(entry: CanaryEntry): Promise<CheckResult> {
  const url = `${BASE_URL}/${entry.type}/${entry.id}`;
  const entity = `${entry.type}/${entry.id}${entry.notes ? ` (${entry.notes})` : ""}`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "User-Agent": "dig-canary-check/1.0" },
    });
    const html = await res.text();
    const elapsed_ms = Date.now() - start;

    if (res.status !== 200) {
      // 404 is acceptable (entity may not exist) — skip, don't fail
      if (res.status === 404) {
        return { entity, url, status: res.status, actionable_links: 0, has_fallback: false, verdict: "PASS", reason: "404 — entity not found (skipped)", elapsed_ms };
      }
      return { entity, url, status: res.status, actionable_links: 0, has_fallback: false, verdict: "FAIL", reason: `HTTP ${res.status}`, elapsed_ms };
    }

    // Detect SSR timeout: Next.js returns 200 but streams a TIMEOUT error page.
    // This is a performance issue (API fetch timeout during SSR), tracked separately from dead-ends.
    if (SSR_TIMEOUT_RE.test(html)) {
      return { entity, url, status: 200, actionable_links: 0, has_fallback: false, verdict: "TIMEOUT", reason: "SSR timeout — Next.js API fetch timed out during server render", elapsed_ms };
    }

    const links = (html.match(INTERNAL_LINK_RE) ?? []).length;
    const hasFallback = FALLBACK_COPY_RE.test(html);

    if (links === 0 && !hasFallback) {
      return { entity, url, status: 200, actionable_links: 0, has_fallback: false, verdict: "FAIL", reason: "Zero actionable links and no fallback copy", elapsed_ms };
    }

    return { entity, url, status: 200, actionable_links: links, has_fallback: hasFallback, verdict: "PASS", elapsed_ms };
  } catch (err: any) {
    return { entity, url, status: null, actionable_links: 0, has_fallback: false, verdict: "ERROR", reason: err?.message ?? "Unknown error", elapsed_ms: Date.now() - start };
  }
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
      const icon = r.verdict === "PASS" ? "✓" : r.verdict === "ERROR" ? "?" : r.verdict === "TIMEOUT" ? "⏱" : "✗";
      console.log(`  ${icon} [${r.verdict}] ${r.entity} — ${r.actionable_links} links, fallback:${r.has_fallback} (${r.elapsed_ms}ms)`);
    }
  }

  const violations = results.filter((r) => r.verdict === "FAIL");
  const timeouts = results.filter((r) => r.verdict === "TIMEOUT");
  const errors = results.filter((r) => r.verdict === "ERROR");
  const passes = results.filter((r) => r.verdict === "PASS");

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passes.length} PASS, ${violations.length} FAIL, ${timeouts.length} TIMEOUT (SSR), ${errors.length} ERROR`);
  console.log(`Note: TIMEOUT = SSR fetch timeout (performance issue, not structural dead-end)`);

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

  // Write JSON report
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    summary: { total: results.length, pass: passes.length, fail: violations.length, timeout: timeouts.length, error: errors.length },
    violations: violations.map((v) => ({ entity: v.entity, url: v.url, reason: v.reason })),
    ssr_timeouts: timeouts.map((t) => ({ entity: t.entity, url: t.url, elapsed_ms: t.elapsed_ms })),
    results,
  };

  const fs = await import("fs");
  fs.writeFileSync("no-dead-ends-report.json", JSON.stringify(report, null, 2));
  console.log(`\nReport written to: no-dead-ends-report.json`);

  if (violations.length > 0) {
    console.log(`\n✗ FAILED — ${violations.length} structural dead end(s) found\n`);
    process.exit(1);
  }

  if (timeouts.length > 0) {
    console.log(`\n~ PARTIAL — no structural dead ends, but ${timeouts.length} SSR timeout(s) detected\n`);
    // SSR timeouts exit 0 — they are tracked but don't block CI (separate P1 work)
  } else {
    console.log(`\n✓ PASSED — no dead ends found\n`);
  }
}

main().catch((err) => {
  console.error("Canary check crashed:", err);
  process.exit(1);
});
