import { describe, it, expect, beforeEach } from "vitest";
import { hit, isThrottledPath, resetThrottle, LIMIT_PER_WINDOW, WINDOW_MS } from "./throttle";

describe("entity-page throttle", () => {
  beforeEach(() => resetThrottle());

  it("only covers entity and search paths", () => {
    expect(isThrottledPath("/artist/123")).toBe(true);
    expect(isThrottledPath("/master/1")).toBe(true);
    expect(isThrottledPath("/search?q=x")).toBe(true);
    expect(isThrottledPath("/")).toBe(false);
    expect(isThrottledPath("/about")).toBe(false);
    expect(isThrottledPath("/_next/static/x.js")).toBe(false);
  });

  it("allows LIMIT_PER_WINDOW hits then 429s until the window resets", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMIT_PER_WINDOW; i++) expect(hit("1.1.1.1", t0).allowed).toBe(true);
    const blocked = hit("1.1.1.1", t0 + 1000);
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(hit("1.1.1.1", t0 + WINDOW_MS).allowed).toBe(true);
  });

  it("buckets are per IP", () => {
    for (let i = 0; i <= LIMIT_PER_WINDOW; i++) hit("2.2.2.2", 0);
    expect(hit("2.2.2.2", 0).allowed).toBe(false);
    expect(hit("3.3.3.3", 0).allowed).toBe(true);
  });
});
