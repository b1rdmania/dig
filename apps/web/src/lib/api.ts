import { isApiError } from "./types";
import { API_URL, apiKeyHeaders } from "./server-env";

// 5s, not 12s. A healthy same-region call returns in well under 1s, so 12s
// only ever bought a longer hang: with one retry it put a 24.25s ceiling on a
// single fetch, and a page that fans out over two stages could sit for ~48s
// before rendering. Fail fast and fall back to the defaults instead.
const TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 250;

/**
 * Ceiling on API calls in flight from this process at any moment.
 *
 * Why this exists: Node's global fetch is undici, and undici's default Agent
 * allows UNLIMITED connections per origin. A render that can't get an idle
 * socket simply opens another one, so socket demand was bounded only by how
 * many requests Fly admitted — 120 concurrent, each fanning out several calls.
 * On 2026-08-07 and again on 08-08 dig-web ran out of outbound sockets:
 *
 *   TypeError: fetch failed
 *     cause: Client network socket disconnected before secure TLS connection
 *            was established (ECONNRESET, localAddress: null)
 *
 * That is a process unable to ESTABLISH sockets, not an API refusing them —
 * dig-api stayed healthy and externally reachable through both outages, and
 * from a freshly restarted machine both the public and .internal paths answer
 * 8/8. Every failure then got retried, doubling the work, until the machine
 * had no event loop left to serve a static /api/health inside its 5s check
 * budget. Fly pulled it from the proxy and the site went dark.
 *
 * Capping in-flight calls caps sockets: undici never needs more connections
 * than we allow concurrent requests. Excess renders queue here instead of
 * exhausting the machine — slower under burst, which is the right trade. The
 * failure mode was never "too slow", it was "wedged and removed from the
 * load balancer".
 *
 * Chosen over configuring an undici Agent directly because importing the
 * `undici` package breaks `next build` (its index pulls in the mock/snapshot
 * agent, which imports `node:fs/promises`; serverExternalPackages does not
 * cover the instrumentation bundle).
 */
const MAX_IN_FLIGHT = 32;

let inFlight = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  // No increment on this path: releaseSlot HANDS OVER its slot rather than
  // freeing it, so the count never dips and no third caller can slip into the
  // gap between the waiter being resolved and the waiter resuming.
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) {
    // Slot transferred, not released — inFlight deliberately unchanged.
    next();
    return;
  }
  inFlight--;
}

export class ApiRequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface FetchOptions {
  revalidate?: number | false;
  cache?: RequestCache;
}

/**
 * Server-side fetch wrapper. Adds API key, timeout, ISR cache, and one
 * automatic retry on transient errors:
 *   - NETWORK_ERROR (undici "fetch failed", ECONNRESET, socket hang up)
 *   - HTTP 502 / 503 / 504 (cold-machine wake, gateway hiccups)
 *   - TIMEOUT (single request hit the 12s ceiling — give it one more try)
 *
 * Real 4xx (NOT_FOUND, INVALID_REQUEST, etc) and non-transient 5xx (500)
 * surface immediately so we don't mask actual bugs.
 */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export async function digFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  try {
    return await digFetchOnce<T>(path, options);
  } catch (err) {
    const retryable =
      err instanceof ApiRequestError &&
      (err.code === "NETWORK_ERROR" ||
        err.code === "TIMEOUT" ||
        RETRYABLE_STATUSES.has(err.status));
    if (retryable) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return await digFetchOnce<T>(path, options);
    }
    throw err;
  }
}

async function digFetchOnce<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const url = `${API_URL}${path}`;

  // Queue for a slot BEFORE starting the timeout clock — time spent waiting
  // for a slot is not time the API is being slow, and charging it against the
  // 5s budget would make a busy machine time out requests that never left it.
  await acquireSlot();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fetchOptions: RequestInit & { next?: { revalidate?: number | false } } = {
      headers: apiKeyHeaders(),
      signal: controller.signal,
    };

    if (options.cache) {
      fetchOptions.cache = options.cache;
    } else if (options.revalidate !== undefined) {
      fetchOptions.next = { revalidate: options.revalidate };
    }

    const res = await fetch(url, fetchOptions);
    const data = await res.json();

    if (!res.ok) {
      if (isApiError(data)) {
        throw new ApiRequestError(data.error.code, data.error.message, res.status);
      }
      throw new ApiRequestError("UNKNOWN", `API returned ${res.status}`, res.status);
    }

    return data as T;
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiRequestError("TIMEOUT", "Request timed out", 408);
    }
    throw new ApiRequestError("NETWORK_ERROR", String(err), 0);
  } finally {
    clearTimeout(timeout);
    releaseSlot();
  }
}

/**
 * Verify API is reachable. Call during dev to catch misconfig early.
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/v1/health`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

