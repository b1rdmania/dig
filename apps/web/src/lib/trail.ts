// Client-side breadcrumb trail across entity visits.
// Stored in sessionStorage so it lives for the duration of a tab session
// (no persistence across tabs/visits, no server, no account required).

export type TrailKind = "label" | "artist" | "master" | "scene";

export interface TrailItem {
  kind: TrailKind;
  id: string;
  name: string;
  subtitle?: string;
  ts: number;
}

const STORAGE_KEY = "dig:trail:v1";
const MAX_ITEMS = 8;
const EVENT_NAME = "dig:trail:changed";

export function readTrail(): TrailItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrailItem).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function pushTrail(item: Omit<TrailItem, "ts">): void {
  if (typeof window === "undefined") return;
  const next: TrailItem = { ...item, ts: Date.now() };
  const current = readTrail();

  // Dedupe: drop any prior occurrence of (kind,id) so a revisit moves to the
  // tail rather than creating a duplicate. This keeps the trail readable.
  const filtered = current.filter((x) => !(x.kind === next.kind && x.id === next.id));

  // Skip writing if the most recent entry is already this exact item — avoids
  // thrashing on Next.js navigation re-renders / fast refresh.
  if (current.length > 0) {
    const last = current[current.length - 1];
    if (last.kind === next.kind && last.id === next.id) return;
  }

  const updated = [...filtered, next].slice(-MAX_ITEMS);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    // sessionStorage may be unavailable (privacy mode, quota); ignore silently.
  }
}

export function clearTrail(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  } catch {
    // ignore
  }
}

export function subscribeTrail(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, listener);
  // Cross-tab updates within the same origin still notify via storage event.
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT_NAME, listener);
    window.removeEventListener("storage", listener);
  };
}

export function trailHrefFor(item: TrailItem): string {
  switch (item.kind) {
    case "label":
      return `/label/${item.id}`;
    case "artist":
      return `/artist/${item.id}`;
    case "master":
      return `/master/${item.id}`;
    case "scene":
      return `/scene/${item.id}`;
  }
}

function isTrailItem(x: unknown): x is TrailItem {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.kind === "string" &&
    (o.kind === "label" || o.kind === "artist" || o.kind === "master" || o.kind === "scene") &&
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.ts === "number"
  );
}
