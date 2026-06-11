import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isAllowedPath, MAINTENANCE_MODE } from "./lib/maintenance";
import { middleware } from "./middleware";

const ALLOWED = ["/", "/search", "/progress", "/api/foo", "/favicon.ico", "/_next/static/chunk.js"];
const BLOCKED = ["/master/123", "/artist/5", "/about", "/llm-beta", "/admin/usage", "/mcp", "/label/9"];

describe("maintenance mode", () => {
  it("is enabled", () => {
    expect(MAINTENANCE_MODE).toBe(true);
  });
});

describe("isAllowedPath", () => {
  it.each(ALLOWED)("allows %s", (path) => {
    expect(isAllowedPath(path)).toBe(true);
  });

  it.each(BLOCKED)("blocks %s", (path) => {
    expect(isAllowedPath(path)).toBe(false);
  });
});

describe("middleware", () => {
  const makeRequest = (path: string) =>
    new NextRequest(`https://app.dig.baby${path}`);

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
