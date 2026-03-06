import { isApiError } from "./types";
import type { McpUsageSnapshot } from "./types";

const API_URL = process.env.DIG_API_URL || "https://dig-api.fly.dev";
const API_KEY = process.env.DIG_API_KEY || "";
const MCP_URL = process.env.DIG_MCP_URL || "https://dig-mcp.fly.dev";
const TIMEOUT_MS = 10000;

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
 * Server-side fetch wrapper. Adds API key, timeout, and ISR cache control.
 * Base URL does not include /v1 — pass full path like "/v1/search".
 */
export async function digFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const url = `${API_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const fetchOptions: RequestInit & { next?: { revalidate?: number | false } } = {
      headers: {
        ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
      },
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

export async function fetchMcpUsage(): Promise<McpUsageSnapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${MCP_URL}/usage`, {
      signal: controller.signal,
      cache: "no-store",
      headers: API_KEY ? { "X-API-Key": API_KEY } : {},
    });
    if (!res.ok) return null;
    return (await res.json()) as McpUsageSnapshot;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
