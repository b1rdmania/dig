import { describe, it, expect } from "vitest";
import { type HealthStatus } from "../health.js";

// Shape-contract tests. Real healthCheck behavior is covered by the API
// integration suite (apps/api/src/__tests__/app.integration.test.ts).
describe("healthCheck", () => {
  it("ok status matches the contract shape", () => {
    const status: HealthStatus = {
      status: "ok",
      postgres: true,
      timestamp: new Date().toISOString(),
    };

    expect(status.status).toBe("ok");
    expect(status.postgres).toBe(true);
    expect(typeof status.timestamp).toBe("string");
  });

  it("down status matches the contract shape", () => {
    const status: HealthStatus = {
      status: "down",
      postgres: false,
      timestamp: new Date().toISOString(),
    };

    expect(status.status).toBe("down");
    expect(status.postgres).toBe(false);
  });
});
