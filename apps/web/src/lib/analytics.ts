"use client";

/**
 * Lightweight client-side analytics for alpha instrumentation.
 *
 * Events are batched and sent via navigator.sendBeacon (or fetch fallback)
 * to the API's /v1/events endpoint. No PII is collected.
 *
 * Session ID is a random UUID stored in sessionStorage (cleared on tab close).
 */

const API_URL = "https://dig-api.fly.dev";
const BATCH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 25;

interface AnalyticsEvent {
  event: string;
  timestamp: string;
  session_id: string;
  route: string;
  properties: Record<string, string | number | boolean | null>;
}

const queue: AnalyticsEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = sessionStorage.getItem("dig_sid");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("dig_sid", id);
  }
  return id;
}

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH_SIZE);
  const payload = JSON.stringify({ events: batch });

  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(`${API_URL}/v1/events`, new Blob([payload], { type: "application/json" }));
  } else {
    fetch(`${API_URL}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, BATCH_INTERVAL_MS);
}

function track(
  event: string,
  properties: Record<string, string | number | boolean | null> = {},
): void {
  if (typeof window === "undefined") return;

  queue.push({
    event,
    timestamp: new Date().toISOString(),
    session_id: getSessionId(),
    route: window.location.pathname,
    properties,
  });

  if (queue.length >= MAX_BATCH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

// Flush on page unload
if (typeof window !== "undefined") {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

// --- Public API ---

export function trackSearchSubmitted(query: string, resultCount: number, elapsedMs: number, degraded: boolean): void {
  track("search_submitted", {
    query,
    result_count: resultCount,
    elapsed_ms: elapsedMs,
    degraded,
  });
}

export function trackSearchResultClicked(
  query: string,
  entityType: string,
  entityId: number,
  position: number,
): void {
  track("search_result_clicked", {
    query,
    entity_type: entityType,
    entity_id: entityId,
    position,
  });
}

export function trackReleasePageViewed(entityId: number, title: string): void {
  track("release_page_viewed", {
    entity_type: "master",
    entity_id: entityId,
    title,
  });
}

export function trackVersionPageViewed(entityId: number, title: string): void {
  track("version_page_viewed", {
    entity_type: "release",
    entity_id: entityId,
    title,
  });
}

export function trackOutboundDiscogsClicked(entityType: string, entityId: number): void {
  track("outbound_discogs_clicked", {
    entity_type: entityType,
    entity_id: entityId,
  });
}

export function trackMediaPlayClicked(youtubeId: string, position: number): void {
  track("media_play_clicked", {
    youtube_id: youtubeId,
    position,
  });
}

export function trackMediaShowMoreClicked(remainingCount: number): void {
  track("media_show_more_clicked", {
    remaining_count: remainingCount,
  });
}

export function trackShareClicked(entityType: string | null, entityId: number | null, channel: string): void {
  track("share_clicked", {
    entity_type: entityType,
    entity_id: entityId,
    channel,
  });
}

export function trackIncrementalSearch(
  event: "started" | "completed" | "aborted" | "error",
  properties: {
    query_length: number;
    elapsed_ms?: number;
    result_count?: number;
    timeout?: boolean;
  },
): void {
  track(`search_incremental_${event}`, properties);
}
