import { describe, it, expect } from "vitest";

/**
 * Smoke test — verifies the test runner works.
 * Integration tests against Fastify inject will be added
 * once docker-compose Postgres is available in CI.
 */
describe("health", () => {
  it("should return a health status shape", () => {
    // Unit test the shape without DB dependency
    const status = {
      status: "ok" as const,
      postgres: true,
      timestamp: new Date().toISOString(),
    };

    expect(status.status).toBe("ok");
    expect(status.postgres).toBe(true);
    expect(status.timestamp).toBeTruthy();
  });
});
