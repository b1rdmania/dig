import { isApiError } from "./types";
import { API_URL, apiKeyHeaders } from "./server-env";

const TIMEOUT_MS = 12000;
const RETRY_DELAY_MS = 250;

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

