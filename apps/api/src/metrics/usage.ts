import type { Kysely } from "@dig/db";
import { sql } from "@dig/db";
import type { Database } from "@dig/db";

type Category = "search" | "retrieval" | "traversal" | "telemetry" | "health" | "other";

type RouteCounter = {
  count: number;
  errors: number;
  elapsedTotalMs: number;
};

const startedAt = Date.now();
let totalRequests = 0;
let totalErrors = 0;
const byCategory = new Map<Category, number>();
const byRoute = new Map<string, RouteCounter>();
const telemetryByEvent = new Map<string, number>();
const uniqueSessions = new Set<string>();
const MAX_SESSION_TRACK = 100_000;
const FLUSH_INTERVAL_MS = 10_000;

let dbRef: Kysely<Database> | null = null;
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;
const pendingCounters = new Map<string, number>();

function incrementCategory(category: Category): void {
  const current = byCategory.get(category) ?? 0;
  byCategory.set(category, current + 1);
}

function queuePersistentCounter(counterKey: string, delta: number): void {
  pendingCounters.set(counterKey, (pendingCounters.get(counterKey) ?? 0) + delta);
}

export function recordApiRequest(params: {
  category: Category;
  route: string;
  status: number;
  elapsedMs: number;
}): void {
  totalRequests += 1;
  if (params.status >= 500) totalErrors += 1;

  incrementCategory(params.category);

  const existing = byRoute.get(params.route) ?? { count: 0, errors: 0, elapsedTotalMs: 0 };
  existing.count += 1;
  if (params.status >= 400) existing.errors += 1;
  existing.elapsedTotalMs += params.elapsedMs;
  byRoute.set(params.route, existing);

  queuePersistentCounter("requests_total", 1);
  if (params.status >= 500) queuePersistentCounter("errors_total", 1);
  queuePersistentCounter(`category:${params.category}`, 1);
  queuePersistentCounter(`route_count:${params.route}`, 1);
  if (params.status >= 400) queuePersistentCounter(`route_errors:${params.route}`, 1);
  queuePersistentCounter(`route_elapsed_ms:${params.route}`, params.elapsedMs);
}

export function recordTelemetryEvent(event: string, sessionId: string): void {
  telemetryByEvent.set(event, (telemetryByEvent.get(event) ?? 0) + 1);
  if (uniqueSessions.size < MAX_SESSION_TRACK) uniqueSessions.add(sessionId);
  queuePersistentCounter("telemetry_events_total", 1);
  queuePersistentCounter(`event:${event}`, 1);
}

function mapToObject<T extends string>(map: Map<T, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return out;
}

function routeSnapshot(): Array<{ route: string; count: number; errors: number; avg_ms: number }> {
  return [...byRoute.entries()]
    .map(([route, c]) => ({
      route,
      count: c.count,
      errors: c.errors,
      avg_ms: c.count > 0 ? Math.round(c.elapsedTotalMs / c.count) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
}

function parseLifetimeCounterRows(rows: Array<{ counter_key: string; counter_value: string | number }>) {
  let requestsTotal = 0;
  let errorsTotal = 0;
  let telemetryEventsTotal = 0;
  const requestsByCategory: Record<string, number> = {};
  const telemetryByEventTotals: Record<string, number> = {};
  const routeCounts = new Map<string, number>();
  const routeErrors = new Map<string, number>();
  const routeElapsed = new Map<string, number>();

  for (const row of rows) {
    const key = row.counter_key;
    const rawValue = row.counter_value;
    const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(value)) continue;

    if (key === "requests_total") requestsTotal = value;
    else if (key === "errors_total") errorsTotal = value;
    else if (key === "telemetry_events_total") telemetryEventsTotal = value;
    else if (key.startsWith("category:")) requestsByCategory[key.slice("category:".length)] = value;
    else if (key.startsWith("event:")) telemetryByEventTotals[key.slice("event:".length)] = value;
    else if (key.startsWith("route_count:")) routeCounts.set(key.slice("route_count:".length), value);
    else if (key.startsWith("route_errors:")) routeErrors.set(key.slice("route_errors:".length), value);
    else if (key.startsWith("route_elapsed_ms:")) routeElapsed.set(key.slice("route_elapsed_ms:".length), value);
  }

  const routes = [...routeCounts.entries()]
    .map(([route, count]) => {
      const errors = routeErrors.get(route) ?? 0;
      const elapsedTotalMs = routeElapsed.get(route) ?? 0;
      return {
        route,
        count,
        errors,
        avg_ms: count > 0 ? Math.round(elapsedTotalMs / count) : 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  return {
    as_of: new Date().toISOString(),
    requests_total: requestsTotal,
    errors_total: errorsTotal,
    requests_by_category: requestsByCategory,
    telemetry_events_total: telemetryEventsTotal,
    telemetry_by_event: telemetryByEventTotals,
    routes,
  };
}

async function getLifetimeSnapshot() {
  if (!dbRef) return null;
  try {
    const result = await sql<{ counter_key: string; counter_value: string | number }>`
      SELECT counter_key, counter_value
      FROM enrich.usage_counters
    `.execute(dbRef);
    return parseLifetimeCounterRows(result.rows);
  } catch {
    // Fail-open if migration is not applied yet.
    return null;
  }
}

async function flushPendingCounters(): Promise<void> {
  if (!dbRef || flushing || pendingCounters.size === 0) return;
  flushing = true;
  const batch = new Map(pendingCounters);
  pendingCounters.clear();
  try {
    await dbRef.transaction().execute(async (trx) => {
      for (const [counterKey, delta] of batch.entries()) {
        await sql`
          INSERT INTO enrich.usage_counters (counter_key, counter_value)
          VALUES (${counterKey}, ${delta})
          ON CONFLICT (counter_key)
          DO UPDATE SET
            counter_value = enrich.usage_counters.counter_value + EXCLUDED.counter_value,
            updated_at = now()
        `.execute(trx);
      }
    });
  } catch {
    for (const [counterKey, delta] of batch.entries()) {
      pendingCounters.set(counterKey, (pendingCounters.get(counterKey) ?? 0) + delta);
    }
  } finally {
    flushing = false;
  }
}

export function initUsagePersistence(db: Kysely<Database>): void {
  dbRef = db;
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushPendingCounters();
  }, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

export async function shutdownUsagePersistence(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushPendingCounters();
}

export async function getUsageSnapshot() {
  return {
    service: "dig-api",
    window: "since_process_start",
    started_at: new Date(startedAt).toISOString(),
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    requests_total: totalRequests,
    errors_total: totalErrors,
    requests_by_category: mapToObject(byCategory),
    telemetry_events_total: [...telemetryByEvent.values()].reduce((a, b) => a + b, 0),
    telemetry_by_event: mapToObject(telemetryByEvent),
    unique_sessions_estimate: uniqueSessions.size,
    lifetime: await getLifetimeSnapshot(),
  };
}

export async function getUsageSnapshotInternal() {
  return {
    ...(await getUsageSnapshot()),
    routes: routeSnapshot(),
  };
}
