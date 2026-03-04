/**
 * Label linkout verification CLI.
 *
 * Agent-assisted verification queue: checks URL health, domain match,
 * and handle consistency. Auto-applies safe verdicts (dead links, wrong domain).
 * Ambiguous cases go to needs_review for human gate.
 *
 * Usage:
 *   DATABASE_URL=... pnpm --filter @dig/ingest linkout-verify
 *   DATABASE_URL=... pnpm --filter @dig/ingest linkout-verify -- --limit 500 --dry-run
 */

import { createDb, sql } from "@dig/db";

interface LinkoutRow {
  id: number;
  discogs_label_id: number;
  provider: string;
  url: string;
  handle: string | null;
  confidence: number;
}

interface CheckResult {
  id: number;
  check_status: "verified" | "needs_review" | "invalid";
  check_method: string;
  check_evidence: Record<string, unknown>;
  check_score: number;
}

function parseArgs(): { databaseUrl: string; limit: number; dryRun: boolean; delay: number } {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  let limit = 500;
  let dryRun = false;
  let delay = 500; // ms between HTTP checks

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) limit = parseInt(args[++i], 10);
    if (args[i] === "--dry-run") dryRun = true;
    if (args[i] === "--delay" && args[i + 1]) delay = parseInt(args[++i], 10);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  return { databaseUrl, limit, dryRun, delay };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check a single URL: HEAD request, follow redirects, inspect final URL.
 */
async function checkUrl(url: string): Promise<{
  httpStatus: number | null;
  finalUrl: string | null;
  finalDomain: string | null;
  error: string | null;
}> {
  try {
    const resp = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
      headers: {
        "User-Agent": "DigBabyBot/1.0 (https://dig.baby; linkout-verify)",
      },
    });

    const finalUrl = resp.url || url;
    let finalDomain: string | null = null;
    try {
      finalDomain = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, "");
    } catch { /* ignore */ }

    return {
      httpStatus: resp.status,
      finalUrl,
      finalDomain,
      error: null,
    };
  } catch (err) {
    // Some sites block HEAD — try GET with abort
    try {
      const resp = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent": "DigBabyBot/1.0 (https://dig.baby; linkout-verify)",
        },
      });

      // Consume body to avoid memory leak
      await resp.text().catch(() => {});

      const finalUrl = resp.url || url;
      let finalDomain: string | null = null;
      try {
        finalDomain = new URL(finalUrl).hostname.toLowerCase().replace(/^www\./, "");
      } catch { /* ignore */ }

      return {
        httpStatus: resp.status,
        finalUrl,
        finalDomain,
        error: null,
      };
    } catch (e2) {
      return {
        httpStatus: null,
        finalUrl: null,
        finalDomain: null,
        error: e2 instanceof Error ? e2.message : String(e2),
      };
    }
  }
}

/**
 * Check if final domain matches expected provider domain.
 */
function domainMatchesProvider(provider: string, finalDomain: string | null): boolean {
  if (!finalDomain) return false;
  if (provider === "bandcamp") return finalDomain.endsWith("bandcamp.com");
  if (provider === "instagram") return finalDomain === "instagram.com" || finalDomain === "www.instagram.com";
  return false;
}

/**
 * Extract handle from a final URL for consistency check.
 */
function extractHandleFromUrl(provider: string, finalUrl: string): string | null {
  try {
    const u = new URL(finalUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");

    if (provider === "bandcamp" && host.endsWith("bandcamp.com")) {
      const subdomain = host.replace(/\.bandcamp\.com$/, "");
      return subdomain && subdomain !== "bandcamp" ? subdomain.toLowerCase() : null;
    }

    if (provider === "instagram" && (host === "instagram.com" || host === "www.instagram.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      return parts[0]?.toLowerCase() || null;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Evaluate a linkout and assign a verdict.
 */
async function evaluateLinkout(row: LinkoutRow): Promise<CheckResult> {
  const { httpStatus, finalUrl, finalDomain, error } = await checkUrl(row.url);

  const evidence: Record<string, unknown> = {
    http_status: httpStatus,
    final_url: finalUrl,
    final_domain: finalDomain,
    error,
  };

  // Network error — can't determine, mark for review
  if (httpStatus === null) {
    return {
      id: row.id,
      check_status: "needs_review",
      check_method: "url_resolve",
      check_evidence: { ...evidence, notes: "Network error or timeout" },
      check_score: 0.3,
    };
  }

  // Dead link — auto-invalidate
  if (httpStatus === 404 || httpStatus === 410 || httpStatus === 403) {
    return {
      id: row.id,
      check_status: "invalid",
      check_method: "url_resolve",
      check_evidence: { ...evidence, notes: `Dead link (HTTP ${httpStatus})` },
      check_score: 0.95,
    };
  }

  // Domain mismatch — redirect to wrong site
  if (!domainMatchesProvider(row.provider, finalDomain)) {
    return {
      id: row.id,
      check_status: "invalid",
      check_method: "domain_match",
      check_evidence: { ...evidence, notes: `Redirected to wrong domain: ${finalDomain}` },
      check_score: 0.9,
    };
  }

  // Handle consistency check
  const extractedHandle = finalUrl ? extractHandleFromUrl(row.provider, finalUrl) : null;
  if (extractedHandle && row.handle && extractedHandle !== row.handle) {
    // Instagram redirects logged-out users to /accounts/login/ — not a real mismatch
    const isInstagramLoginRedirect = row.provider === "instagram" && extractedHandle === "accounts";
    if (!isInstagramLoginRedirect) {
      evidence.extracted_handle = extractedHandle;
      evidence.stored_handle = row.handle;
      return {
        id: row.id,
        check_status: "needs_review",
        check_method: "handle_consistency",
        check_evidence: { ...evidence, notes: `Handle mismatch: stored=${row.handle}, actual=${extractedHandle}` },
        check_score: 0.5,
      };
    }
    // Login redirect — domain matched, URL is valid, just can't verify handle
    evidence.notes = "Instagram login redirect — URL valid, handle unverifiable without auth";
  }

  // All checks pass — verified
  return {
    id: row.id,
    check_status: "verified",
    check_method: "url_resolve",
    check_evidence: { ...evidence, notes: "All checks passed" },
    check_score: 1.0,
  };
}

/**
 * Create a DB, run a callback, then destroy. Retries on connection error.
 */
async function withDb<T>(databaseUrl: string, fn: (db: ReturnType<typeof createDb>) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const db = createDb(databaseUrl);
    try {
      const result = await fn(db);
      await db.destroy();
      return result;
    } catch (err: unknown) {
      await db.destroy().catch(() => {});
      const isConnErr = err instanceof Error && (err.message.includes("ECONNRESET") || err.message.includes("ECONNREFUSED") || err.message.includes("connection"));
      if (isConnErr && attempt < retries) {
        console.log(`[linkout-verify] DB connection error (attempt ${attempt}/${retries}), retrying in 5s...`);
        await sleep(5000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

async function main() {
  const args = parseArgs();
  const t0 = Date.now();

  // Fetch pending linkouts (low confidence first)
  const rows = await withDb(args.databaseUrl, async (db) => {
    const { rows } = await sql<LinkoutRow>`
      SELECT id, discogs_label_id, provider, url, handle, confidence
      FROM enrich.label_linkouts
      WHERE check_status = 'pending'
      ORDER BY confidence ASC, discogs_label_id ASC
      LIMIT ${args.limit}
    `.execute(db);
    return rows;
  });

  console.log(`[linkout-verify] ${rows.length} pending linkouts to check`);

  if (rows.length === 0) {
    console.log("[linkout-verify] nothing to do");
    return;
  }

  const counts = { verified: 0, needs_review: 0, invalid: 0 };
  let processed = 0;
  let batch: CheckResult[] = [];
  const BATCH_SIZE = 50;

  for (const row of rows) {
    const result = await evaluateLinkout(row);
    counts[result.check_status]++;
    batch.push(result);
    processed++;

    // Flush batch to DB periodically (fresh connection each time)
    if (!args.dryRun && (batch.length >= BATCH_SIZE || processed === rows.length)) {
      const toWrite = [...batch];
      batch = [];
      await withDb(args.databaseUrl, async (db) => {
        for (const r of toWrite) {
          await sql`
            UPDATE enrich.label_linkouts
            SET check_status = ${r.check_status},
                checked_at = now(),
                check_method = ${r.check_method},
                check_evidence = ${JSON.stringify(r.check_evidence)}::jsonb,
                check_score = ${r.check_score}
            WHERE id = ${r.id}
          `.execute(db);
        }
      });
    }

    if (processed % 100 === 0 || processed === rows.length) {
      console.log(`[linkout-verify] [${processed}/${rows.length}] verified=${counts.verified} needs_review=${counts.needs_review} invalid=${counts.invalid}`);
    }

    // Rate-limit HTTP checks
    if (processed < rows.length) await sleep(args.delay);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n[linkout-verify] done in ${elapsed}s (dry-run=${args.dryRun})`);
  console.log(`[linkout-verify] verified=${counts.verified} needs_review=${counts.needs_review} invalid=${counts.invalid}`);
}

main().catch((err) => {
  console.error("[linkout-verify] fatal:", err);
  process.exit(1);
});
