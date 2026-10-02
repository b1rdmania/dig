import { describe, it, expect } from "vitest";
import { routeHost } from "./hosts";

describe("winebore.app host routing", () => {
  it("renders Wine Bore at the root", () => {
    expect(routeHost("winebore.app", "/")).toEqual({ kind: "rewrite", pathname: "/winebore" });
  });

  it("passes assets and api through", () => {
    expect(routeHost("winebore.app", "/_next/static/x.js")).toEqual({ kind: "next" });
    expect(routeHost("winebore.app", "/api/og")).toEqual({ kind: "next" });
    expect(routeHost("winebore.app", "/winebore-face.png")).toEqual({ kind: "next" });
  });

  it("sends catalog paths back to app.dig.baby", () => {
    expect(routeHost("winebore.app", "/artist/1", "?x=1")).toEqual({
      kind: "redirect",
      url: "https://app.dig.baby/artist/1?x=1",
    });
  });

  it("folds www and /winebore onto the bare root", () => {
    expect(routeHost("www.winebore.app", "/")).toEqual({ kind: "redirect", url: "https://winebore.app/" });
    expect(routeHost("winebore.app", "/winebore")).toEqual({ kind: "redirect", url: "https://winebore.app/" });
  });

  it("moves app.dig.baby/winebore to the new domain and leaves the rest", () => {
    expect(routeHost("app.dig.baby", "/winebore")).toEqual({ kind: "redirect", url: "https://winebore.app/" });
    expect(routeHost("app.dig.baby", "/recordbore")).toEqual({ kind: "next" });
    expect(routeHost("localhost:3002", "/winebore")).toEqual({ kind: "next" });
  });
});
