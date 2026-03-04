import { describe, expect, it } from "vitest";
import { extractLabelLinkout } from "../linkout-matchers";

describe("extractLabelLinkout", () => {
  it("extracts bandcamp subdomain as canonical link", () => {
    const out = extractLabelLinkout("https://PlanetEMusic.bandcamp.com/");
    expect(out).toEqual({
      provider: "bandcamp",
      url: "https://planetemusic.bandcamp.com",
      handle: "planetemusic",
      confidence: 1,
      matchMethod: "discogs_label_url_exact_domain",
    });
  });

  it("extracts instagram handle and normalizes", () => {
    const out = extractLabelLinkout("https://www.instagram.com/NinjaTune/");
    expect(out).toEqual({
      provider: "instagram",
      url: "https://instagram.com/ninjatune",
      handle: "ninjatune",
      confidence: 0.98,
      matchMethod: "discogs_label_url_exact_domain",
    });
  });

  it("rejects non-profile instagram routes", () => {
    const out = extractLabelLinkout("https://instagram.com/explore/tags/house");
    expect(out).toBeNull();
  });

  it("rejects unrelated domains", () => {
    const out = extractLabelLinkout("https://example.com/label");
    expect(out).toBeNull();
  });
});
