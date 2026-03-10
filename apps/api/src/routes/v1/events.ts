/**
 * Product instrumentation endpoint.
 * Accepts client-side telemetry events and logs them as structured JSON.
 * Events are logged to stdout (same as request logs) and queryable via
 * Fly log drain or `fly logs`.
 *
 * Privacy: no PII collected. Session IDs are random UUIDs generated client-side.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { recordTelemetryEvent } from "../../metrics/usage.js";

// Tighter per-IP rate limit for the write path (separate from global read limit).
// 30 batches/min × 25 events/batch = 750 events/min max per IP.
const EVENTS_RATE_LIMIT = 30;
const EVENTS_WINDOW_MS = 60_000;
const ipCounts = new Map<string, { count: number; resetAt: number }>();

function checkEventsRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + EVENTS_WINDOW_MS });
    return true;
  }
  if (entry.count >= EVENTS_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipCounts) {
    if (now > entry.resetAt) ipCounts.delete(ip);
  }
}, 300_000).unref();

const VALID_EVENT_NAMES = new Set([
  "search_submitted",
  "search_result_clicked",
  "release_page_viewed",
  "version_page_viewed",
  "outbound_discogs_clicked",
  "media_play_clicked",
  "media_show_more_clicked",
  "release_nav_clicked",
  "market_snapshot_viewed",
  "market_discogs_clicked",
  "web_404_viewed",
]);

interface EventPayload {
  event: string;
  timestamp: string;
  session_id: string;
  route: string;
  properties: Record<string, unknown>;
}

interface EventsBody {
  events: EventPayload[];
}

export function registerEventRoutes(app: FastifyInstance): void {
  app.post("/v1/events", async (req: FastifyRequest<{ Body: EventsBody }>, reply) => {
    if (!checkEventsRateLimit(req.ip)) {
      return reply.status(429).send({
        error: { code: "RATE_LIMITED", message: "Too many event submissions", details: null },
      });
    }

    const body = req.body;

    if (!body || !Array.isArray(body.events)) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Body must contain an events array", details: null },
      });
    }

    if (body.events.length > 25) {
      return reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: "Maximum 25 events per batch", details: null },
      });
    }

    const requestId = (req as any).requestId ?? "-";
    let accepted = 0;

    for (const evt of body.events) {
      if (!evt.event || !VALID_EVENT_NAMES.has(evt.event)) continue;
      if (!evt.session_id || typeof evt.session_id !== "string") continue;

      console.log(JSON.stringify({
        ts: evt.timestamp || new Date().toISOString(),
        category: "telemetry",
        event: evt.event,
        session_id: evt.session_id.slice(0, 36),
        route: evt.route || null,
        req_id: requestId,
        ip: req.ip,
        ...flattenProperties(evt.properties),
      }));

      recordTelemetryEvent(evt.event, evt.session_id);
      accepted++;
    }

    return reply.status(202).send({ accepted });
  });
}

/** Flatten properties into top-level keys with p_ prefix to avoid collision */
function flattenProperties(props: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!props || typeof props !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    // Only allow primitive values (string, number, boolean, null)
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[`p_${key}`] = value;
    }
  }
  return out;
}
