import { describe, it, expect } from "vitest";
import { clientIp } from "../client-ip.js";

const req = (headers: Record<string, string>) => ({ headers, ip: "10.0.0.1" });

describe("clientIp", () => {
  it("prefers fly-client-ip over the proxy address", () => {
    expect(clientIp(req({ "fly-client-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })))
      .toBe("203.0.113.7");
  });

  it("falls back to the first x-forwarded-for hop", () => {
    expect(clientIp(req({ "x-forwarded-for": " 198.51.100.1, 10.0.0.2" }))).toBe("198.51.100.1");
  });

  it("falls back to the socket address with no proxy headers", () => {
    expect(clientIp(req({}))).toBe("10.0.0.1");
    expect(clientIp(req({ "fly-client-ip": " ", "x-forwarded-for": "" }))).toBe("10.0.0.1");
  });
});
