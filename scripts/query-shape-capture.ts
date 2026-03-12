#!/usr/bin/env tsx
/**
 * Query shape capture — slow query analysis from Fly logs.
 *
 * Reads structured JSON log lines from stdin (fly logs -a dig-api | tsx scripts/query-shape-capture.ts)
 * and produces a top-20 slow query shape report.
 *
 * Usage:
 *   fly logs -a dig-api --no-tail | npx tsx scripts/query-shape-capture.ts
 *   fly logs -a dig-api --no-tail | npx tsx scripts/query-shape-capture.ts --top 20 --min-ms 500
 *   fly logs -a dig-api --no-tail | npx tsx scripts/query-shape-capture.ts --output docs/perf-top20-query-shapes.md
 */

import * as readline from "node:readline";
import * as fs from "node:fs";

const args = process.argv.slice(2);
let topN = 20;
let minMs = 0;
let outputFile: string | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--top" && args[i + 1]) topN = parseInt(args[++i], 10);
  if (args[i] === "--min-ms" && args[i + 1]) minMs = parseInt(args[++i], 10);
  if (args[i] === "--output" && args[i + 1]) outputFile = args[++i];
}

interface QueryShape {
  route: string;
  method: string;
  statusCode: number;
  samples: number[];
  errors: number;
}

const shapes = new Map<string, QueryShape>();

function normalizeUrl(url: string): string {
  // Strip query string — we group by route pattern
  const base = url.split("?")[0];
  // Replace numeric IDs with :id
  return base.replace(/\/\d+/g, "/:id");
}

function record(route: string, method: string, status: number, ms: number): void {
  const key = `${method} ${route}`;
  let shape = shapes.get(key);
  if (!shape) {
    shape = { route, method, statusCode: status, samples: [], errors: 0 };
    shapes.set(key, shape);
  }
  shape.samples.push(ms);
  if (status >= 400) shape.errors++;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

  let parsed = 0;
  let skipped = 0;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      skipped++;
      continue;
    }
    try {
      const log = JSON.parse(trimmed);
      // Fastify request log format: { req: { method, url }, res: { statusCode }, responseTime }
      // Also check for nested fly log wrapper: { message: "{...}" }
      let entry = log;
      if (typeof log.message === "string" && log.message.startsWith("{")) {
        try { entry = JSON.parse(log.message); } catch { /* ignore */ }
      }

      const method: string = entry.req?.method ?? entry.method;
      const url: string = entry.req?.url ?? entry.url ?? entry.reqUrl;
      const status: number = entry.res?.statusCode ?? entry.statusCode ?? entry.status;
      const ms: number = entry.responseTime ?? entry.elapsed_ms ?? entry.duration;

      if (!method || !url || typeof ms !== "number") {
        skipped++;
        continue;
      }
      if (ms < minMs) { parsed++; continue; }

      const route = normalizeUrl(url);
      record(route, method, status, Math.round(ms));
      parsed++;
    } catch {
      skipped++;
    }
  }

  // Sort shapes by p95 desc
  const sorted = [...shapes.entries()].map(([key, shape]) => {
    const s = shape.samples.sort((a, b) => a - b);
    return {
      key,
      route: shape.route,
      method: shape.method,
      count: s.length,
      errors: shape.errors,
      p50: percentile(s, 50),
      p95: percentile(s, 95),
      p99: percentile(s, 99),
      max: Math.max(...s),
      // Impact score: p95 * sqrt(count) — balances latency vs frequency
      impact: Math.round(percentile(s, 95) * Math.sqrt(s.length)),
    };
  }).sort((a, b) => b.impact - a.impact);

  const top = sorted.slice(0, topN);

  // Text report
  const lines: string[] = [
    `# Slow Query Shape Report`,
    `Generated: ${new Date().toISOString()}`,
    `Parsed: ${parsed} log lines, skipped: ${skipped}`,
    `Threshold: p95 >= ${minMs}ms`,
    ``,
    `| Rank | Route | Count | p50 | p95 | p99 | Max | Errors | Impact |`,
    `|------|-------|-------|-----|-----|-----|-----|--------|--------|`,
  ];

  top.forEach((s, i) => {
    lines.push(
      `| ${i + 1} | \`${s.method} ${s.route}\` | ${s.count} | ${s.p50}ms | ${s.p95}ms | ${s.p99}ms | ${s.max}ms | ${s.errors} | ${s.impact} |`,
    );
  });

  lines.push("", "## Raw samples by shape");
  top.slice(0, 10).forEach((s) => {
    const samples = shapes.get(s.key)!.samples.sort((a, b) => a - b);
    const preview = samples.slice(-5).join(", ") + (samples.length > 5 ? " ..." : "");
    lines.push(`- \`${s.key}\`: last 5 samples: [${preview}]`);
  });

  const output = lines.join("\n") + "\n";

  if (outputFile) {
    fs.writeFileSync(outputFile, output, "utf8");
    console.log(`Written to ${outputFile}`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((err) => {
  console.error("query-shape-capture failed:", err);
  process.exit(1);
});
