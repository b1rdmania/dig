/**
 * API key validation.
 *
 * Keys are configured via the API_KEYS env var (comma-separated). A request's
 * X-API-Key header only grants the keyed rate-limit tier when it matches a
 * configured key; unknown or absent keys are treated as anonymous (rate-limited
 * by IP). Silent downgrade is deliberate — alpha clients with stale keys keep
 * working at the anonymous tier instead of breaking with 401s.
 *
 * Internal/ops endpoints (usage internal, seo cohort) require a valid key
 * outright via validApiKey() and return 401 otherwise.
 */
import type { FastifyRequest } from "fastify";

function parseKeys(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

let cachedKeys: Set<string> | null = null;

function configuredKeys(): Set<string> {
  if (cachedKeys === null) {
    cachedKeys = parseKeys(process.env.API_KEYS);
  }
  return cachedKeys;
}

/** Test hook: re-read API_KEYS from the environment. */
export function resetApiKeysCache(): void {
  cachedKeys = null;
}

export function hasConfiguredKeys(): boolean {
  return configuredKeys().size > 0;
}

/** The raw X-API-Key header value, validated or not (for logging only). */
export function rawApiKey(req: FastifyRequest): string | undefined {
  const header = req.headers["x-api-key"];
  return typeof header === "string" && header.length > 0 ? header : undefined;
}

/** Returns the key only if it matches a configured key; undefined otherwise. */
export function validApiKey(req: FastifyRequest): string | undefined {
  const key = rawApiKey(req);
  return key && configuredKeys().has(key) ? key : undefined;
}

/**
 * Keys exempt from the rate limiter entirely (no Redis INCR per request).
 *
 * RATE_LIMIT_EXEMPT_KEYS is comma-separated; "*" means every *valid* key.
 * Motivation (2026-08-16): dig-web's SSR fan-out (~8 API calls per entity
 * page) was paying two Upstash commands per request under a crawl, projecting
 * $150/mo of Redis for traffic that only ever originates from our own app.
 * Throttling that traffic belongs at the web edge, not here.
 */
let cachedExempt: Set<string> | null = null;

function exemptKeys(): Set<string> {
  if (cachedExempt === null) {
    cachedExempt = parseKeys(process.env.RATE_LIMIT_EXEMPT_KEYS);
  }
  return cachedExempt;
}

/** Test hook: re-read RATE_LIMIT_EXEMPT_KEYS from the environment. */
export function resetExemptKeysCache(): void {
  cachedExempt = null;
}

/** True when the request carries a valid key that is exempt from rate limiting. */
export function isRateLimitExempt(req: FastifyRequest): boolean {
  const key = validApiKey(req);
  if (!key) return false;
  const exempt = exemptKeys();
  return exempt.has("*") || exempt.has(key);
}

export const unauthorizedBody = {
  error: {
    code: "UNAUTHORIZED",
    message: "A valid API key is required for this endpoint",
    details: null,
  },
} as const;
