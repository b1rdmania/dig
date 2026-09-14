import { describe, it, expect } from "vitest";
import { unlinkAll, looksLikeUncheckedBottle } from "../routes/v1/ask/wine-bore.js";

/**
 * Wine Bore grounds by evidence, not links: no URL leaves the shop, and a
 * bottle or grower named with no lookup this turn goes back to the cellar
 * book once. Counter chat passes straight through.
 */
describe("unlinkAll", () => {
  it("strips markdown links but keeps the text", () => {
    expect(unlinkAll("Try [Huet](https://app.dig.baby/producer/1) or [this](http://x.y/z).")).toBe("Try Huet or this.");
  });
  it("removes bare URLs", () => {
    expect(unlinkAll("See https://www.wine-searcher.com/find/huet for it.")).toBe("See  for it.");
  });
  it("leaves plain prose alone", () => {
    expect(unlinkAll("Chardonnay. That's the whole answer.")).toBe("Chardonnay. That's the whole answer.");
  });
});

describe("looksLikeUncheckedBottle", () => {
  it("flags a vintage named with no lookup", () => {
    expect(looksLikeUncheckedBottle("The 2010 is the one to find.", 0)).toBe(true);
  });
  it("flags a grower honorific with no lookup", () => {
    expect(looksLikeUncheckedBottle("Domaine Tempier does it properly.", 0)).toBe(true);
  });
  it("passes the same text after a lookup", () => {
    expect(looksLikeUncheckedBottle("Domaine Tempier does it properly.", 2)).toBe(false);
  });
  it("passes counter chat", () => {
    expect(looksLikeUncheckedBottle("Fair. Say what you mean by dry and I'll re-aim.", 0)).toBe(false);
  });
});
