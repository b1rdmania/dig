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

function incrementCategory(category: Category): void {
  const current = byCategory.get(category) ?? 0;
  byCategory.set(category, current + 1);
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
}

export function recordTelemetryEvent(event: string, sessionId: string): void {
  telemetryByEvent.set(event, (telemetryByEvent.get(event) ?? 0) + 1);
  if (uniqueSessions.size < MAX_SESSION_TRACK) uniqueSessions.add(sessionId);
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

export function getUsageSnapshot() {
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
  };
}

export function getUsageSnapshotInternal() {
  return {
    ...getUsageSnapshot(),
    routes: routeSnapshot(),
  };
}
