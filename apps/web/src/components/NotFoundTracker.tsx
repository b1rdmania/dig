"use client";

import { useEffect } from "react";

const API_URL = process.env.NEXT_PUBLIC_DIG_API_URL ?? "https://dig-api.fly.dev";
const SESSION_KEY_PREFIX = "dig_404_";

function routeTypeFromPath(pathname: string): string {
  if (/^\/artist\/\d+/.test(pathname)) return "artist";
  if (/^\/release\/\d+/.test(pathname)) return "release";
  if (/^\/version\/\d+/.test(pathname)) return "version";
  if (/^\/label\/\d+/.test(pathname)) return "label";
  return "other";
}

export function NotFoundTracker() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const pathname = window.location.pathname;
    const dedupKey = `${SESSION_KEY_PREFIX}${pathname}`;

    // Debounce: only send once per path per session
    if (sessionStorage.getItem(dedupKey)) return;
    sessionStorage.setItem(dedupKey, "1");

    const sessionId = sessionStorage.getItem("dig_sid") ?? "anonymous";
    const payload = JSON.stringify({
      events: [{
        event: "web_404_viewed",
        timestamp: new Date().toISOString(),
        session_id: sessionId,
        route: pathname,
        properties: {
          pathname,
          referrer: document.referrer || null,
          route_type: routeTypeFromPath(pathname),
        },
      }],
    });

    // sendBeacon always attaches cookies, which trips the credentialed-CORS
    // preflight against the API origin. keepalive fetch with credentials
    // omitted is the same fire-and-forget without the baggage.
    fetch(`${API_URL}/v1/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      credentials: "omit",
      keepalive: true,
    }).catch(() => {});
  }, []);

  return null;
}
