import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { isAllowedPath } from "./lib/maintenance";
import { middleware } from "./middleware";

// Test the gate mechanism in both states rather than pinning the production
// flag value — MAINTENANCE_MODE flips at relaunch/maintenance and tests
// shouldn't fail on an operational toggle.
const maintenanceState = { on: true };
vi.mock("@/lib/maintenance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/maintenance")>();
  return {
    ...actual,
    get MAINTENANCE_MODE() {
      return maintenanceState.on;
    },
  };
});

const ALLOWED = ["/", "/search", "/progress", "/api/foo", "/favicon.ico", "/_next/static/chunk.js"];
const BLOCKED = ["/master/123", "/artist/5", "/about", "/llm-beta", "/admin/usage", "/mcp", "/label/9"];

describe("isAllowedPath", () => {
  it.each(ALLOWED)("allows %s", (path) => {
    expect(isAllowedPath(path)).toBe(true);
  });

  it.each(BLOCKED)("blocks %s", (path) => {
    expect(isAllowedPath(path)).toBe(false);
  });
});

describe("middleware with maintenance mode on", () => {
  const makeRequest = (path: string) =>
    new NextRequest(`https://app.dig.baby${path}`);

  beforeEach(() => {
    maintenanceState.on = true;
  });

  it.each(ALLOWED)("passes %s through", (path) => {
    const res = middleware(makeRequest(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it.each(BLOCKED)("redirects %s to /", (path) => {
    const res = middleware(makeRequest(path));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.dig.baby/");
  });

  it("strips search params on redirect", () => {
    const res = middleware(makeRequest("/master/123?utm_source=x&ref=abc"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.dig.baby/");
  });
});

describe("middleware with maintenance mode off", () => {
  const makeRequest = (path: string) =>
    new NextRequest(`https://app.dig.baby${path}`);

  beforeEach(() => {
    maintenanceState.on = false;
  });

  it.each([...ALLOWED, ...BLOCKED])("passes %s through", (path) => {
    const res = middleware(makeRequest(path));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
