import { describe, it, expect } from "vitest";
import { MemoryCache } from "../memory-cache.js";

describe("MemoryCache", () => {
  it("round-trips within TTL and expires after", async () => {
    let t = 0;
    const c = new MemoryCache(10, () => t);
    await c.set("a", "1", "EX", 60);
    expect(await c.get("a")).toBe("1");
    t = 61_000;
    expect(await c.get("a")).toBeNull();
  });

  it("evicts least-recently-used when full", async () => {
    const c = new MemoryCache(2, () => 0);
    await c.set("a", "1", "EX", 60);
    await c.set("b", "2", "EX", 60);
    await c.get("a"); // a is now most recent
    await c.set("c", "3", "EX", 60);
    expect(await c.get("b")).toBeNull();
    expect(await c.get("a")).toBe("1");
    expect(await c.get("c")).toBe("3");
    expect(c.size).toBe(2);
  });
});
