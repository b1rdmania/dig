/**
 * Integration tests against the real Fastify app via inject().
 *
 * Requires DATABASE_URL pointing at a migrated Postgres (CI provides one;
 * locally: docker compose up -d + migrate, then
 * DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm test).
 * The whole suite is skipped when DATABASE_URL is not set.
 *
 * No catalog data is assumed — assertions cover envelopes, auth gating, and
 * rate-limit tiers, not query results.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetApiKeysCache } from "../auth.js";

const DATABASE_URL = process.env.DATABASE_URL;

const TEST_KEY = "test-key-integration";

describe.skipIf(!DATABASE_URL)("app integration", () => {
  let app: FastifyInstance;
  let db: { destroy(): Promise<void> };

  beforeAll(async () => {
    process.env.API_KEYS = TEST_KEY;
    resetApiKeysCache();
    const { buildApp } = await import("../app.js");
    // No redis: exercises the in-memory rate-limit fallback.
    const built = await buildApp({ databaseUrl: DATABASE_URL! });
    app = built.app;
    db = built.db;
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  it("GET /v1/health returns a status payload", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect([200, 503]).toContain(res.statusCode);
    const body = res.json();
    expect(body).toHaveProperty("status");
    expect(body).toHaveProperty("timeout_stats");
  });

  it("invalid discogs_id returns the INVALID_REQUEST envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/masters/notanumber" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
    });
  });

  it("out-of-range discogs_id (> int4) returns 400", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/artists/99999999999" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_REQUEST");
  });

  it("GET /v1/releases/:id returns 410 GONE with successor link", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/releases/12345" });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("GONE");
    expect(res.headers.link).toContain("/v1/release_shadow/12345");
  });

  it("GET /v1/usage/internal without a key returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/usage/internal" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("GET /v1/usage/internal with a bogus key returns 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/usage/internal",
      headers: { "x-api-key": "not-a-real-key" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/usage/internal with a valid key returns 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/usage/internal",
      headers: { "x-api-key": TEST_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("routes");
  });

  it("GET /v1/seo/cohort without a key returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/seo/cohort?type=artists" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/ask fails closed (503) when LLM_BETA_KEYS is unset", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/ask",
      payload: { question: "test" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("CONFIG_ERROR");
  });

  it("anonymous requests get the anonymous rate-limit tier", async () => {
    const { RATE_LIMITS } = await import("../app.js");
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.headers["x-ratelimit-limit"]).toBe(String(RATE_LIMITS.anonymous));
  });

  it("unknown API keys are downgraded to the anonymous tier", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-api-key": "totally-bogus" },
    });
    const { RATE_LIMITS } = await import("../app.js");
    expect(res.headers["x-ratelimit-limit"]).toBe(String(RATE_LIMITS.anonymous));
  });

  it("valid API keys get the keyed rate-limit tier", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: { "x-api-key": TEST_KEY },
    });
    expect(res.headers["x-ratelimit-limit"]).toBe("1000");
  });
});
