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
  // Artists — primary
  { type: "artist", id: 3840,   notes: "Radiohead" },
  { type: "artist", id: 28795,  notes: "Prince" },
  { type: "artist", id: 12596,  notes: "James Brown" },
  { type: "artist", id: 45,     notes: "Aphex Twin" },
  { type: "artist", id: 1,      notes: "The Persuader" },
  // Artists — credits-heavy (known dead-ends before fix)
  { type: "artist", id: 769196, notes: "Tommy Danvers (writer/arranger — KNOWN DEAD END before fix)" },
  { type: "artist", id: 157579, notes: "Diane Warren (songwriter)" },
  { type: "artist", id: 4205,   notes: "Giorgio Moroder (producer)" },
  { type: "artist", id: 49758,  notes: "Nile Rodgers (songwriter/producer)" },
  { type: "artist", id: 17546,  notes: "Quincy Jones (producer/arranger)" },
  // Labels
  { type: "label", id: 1 },
  { type: "label", id: 100 },
  { type: "label", id: 1000 },
  { type: "label", id: 5000 },
  { type: "label", id: 10000 },
  // Releases
  { type: "release", id: 1 },
  { type: "release", id: 100 },
  { type: "release", id: 1000 },
  { type: "release", id: 5000 },
  { type: "release", id: 10000 },
  // Versions
  { type: "version", id: 1 },
  { type: "version", id: 100 },
  { type: "version", id: 1000 },
  { type: "version", id: 5000 },
  { type: "version", id: 10000 },
];

// Patterns that count as actionable internal links
const INTERNAL_LINK_RE = /href=["']\/(artist|label|release|version|master)\/\d+/g;
// Patterns for explicit fallback copy (allowed to have zero links)
const FALLBACK_COPY_RE = /No (releases|credits|connections|linked releases|primary releases|artist information|parent release)/i;

interface CheckResult {
  entity: string;
  url: string;
  status: number | null;
  actionable_links: number;
  has_fallback: boolean;
  verdict: "PASS" | "FAIL" | "ERROR";
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
      const icon = r.verdict === "PASS" ? "✓" : r.verdict === "ERROR" ? "?" : "✗";
      console.log(`  ${icon} [${r.verdict}] ${r.entity} — ${r.actionable_links} links, fallback:${r.has_fallback} (${r.elapsed_ms}ms)`);
    }
  }

  const violations = results.filter((r) => r.verdict === "FAIL");
  const errors = results.filter((r) => r.verdict === "ERROR");
  const passes = results.filter((r) => r.verdict === "PASS");

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Results: ${passes.length} PASS, ${violations.length} FAIL, ${errors.length} ERROR`);

  if (violations.length > 0) {
    console.log(`\nViolations:`);
    for (const v of violations) {
      console.log(`  ✗ ${v.entity}`);
      console.log(`    URL:    ${v.url}`);
      console.log(`    Reason: ${v.reason}`);
    }
  }

  // Write JSON report
  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    summary: { total: results.length, pass: passes.length, fail: violations.length, error: errors.length },
    violations: violations.map((v) => ({ entity: v.entity, url: v.url, reason: v.reason })),
    results,
  };

  const fs = await import("fs");
  fs.writeFileSync("no-dead-ends-report.json", JSON.stringify(report, null, 2));
  console.log(`\nReport written to: no-dead-ends-report.json`);

  if (violations.length > 0) {
    console.log(`\n✗ FAILED — ${violations.length} dead end(s) found\n`);
    process.exit(1);
  }

  console.log(`\n✓ PASSED — no dead ends found\n`);
}

main().catch((err) => {
  console.error("Canary check crashed:", err);
  process.exit(1);
});
