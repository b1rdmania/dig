import { describe, it, expect } from "vitest";
import {
  hrefForMasterId,
  hrefForReleaseId,
  hrefForTraversalLink,
  hrefForArtistCredit,
  hrefForSearchResult,
} from "./routes";
import type { TraversalLink, SearchResult, ArtistCreditLink, Provenance } from "./types";

const PROVENANCE: Provenance = { source: "test", dump_date: "2024-01-01", discogs_id: 1 };

describe("hrefForMasterId", () => {
  it("routes master to /master/:id", () => {
    expect(hrefForMasterId(21004)).toBe("/master/21004");
    expect(hrefForMasterId("21004")).toBe("/master/21004");
  });
});

describe("hrefForReleaseId", () => {
  it("routes release to /master/:release_id when no master is known (server resolves)", () => {
    expect(hrefForReleaseId(9267745)).toBe("/master/9267745");
    expect(hrefForReleaseId("9267745")).toBe("/master/9267745");
  });

  it("prefers master_discogs_id when provided", () => {
    expect(hrefForReleaseId(9267745, 21004)).toBe("/master/21004");
  });
});

describe("hrefForTraversalLink", () => {
  it("master link → /master/:id", () => {
    const link: TraversalLink = { type: "master", discogs_id: 21004, provenance: PROVENANCE };
    expect(hrefForTraversalLink(link)).toBe("/master/21004");
  });

  it("release link with master_discogs_id → /master/:master_id", () => {
    const link: TraversalLink = {
      type: "release",
      discogs_id: 9267745,
      master_discogs_id: 21004,
      provenance: PROVENANCE,
    };
    expect(hrefForTraversalLink(link)).toBe("/master/21004");
  });

  it("release link without master_discogs_id → /master/:release_id (server resolves)", () => {
    const link: TraversalLink = { type: "release", discogs_id: 9267745, provenance: PROVENANCE };
    expect(hrefForTraversalLink(link)).toBe("/master/9267745");
  });

  it("artist link → /artist/:id", () => {
    const link: TraversalLink = { type: "artist", discogs_id: 3840, provenance: PROVENANCE };
    expect(hrefForTraversalLink(link)).toBe("/artist/3840");
  });

  it("label link → /label/:id", () => {
    const link: TraversalLink = { type: "label", discogs_id: 1000, provenance: PROVENANCE };
    expect(hrefForTraversalLink(link)).toBe("/label/1000");
  });
});

describe("hrefForArtistCredit", () => {
  it("routes credit links through /master/:release_id (resolves to master via shadow)", () => {
    const credit: ArtistCreditLink = {
      release_discogs_id: 9267745,
      title: "Loveless",
      year: 1991,
      country: "UK",
      roles: ["Producer"],
      role_count: 1,
      credit_source: "release",
      role_family: "production",
      provenance: PROVENANCE,
    };
    expect(hrefForArtistCredit(credit)).toBe("/master/9267745");
  });
});

describe("hrefForSearchResult", () => {
  it("master → /master/:id", () => {
    const result: SearchResult = {
      type: "master",
      discogs_id: 21004,
      name: null,
      title: "Loveless",
      year: 1991,
      country: null,
      data_quality: "Correct",
      relevance: 1,
      provenance: PROVENANCE,
    };
    expect(hrefForSearchResult(result)).toBe("/master/21004");
  });

  it("artist → /artist/:id", () => {
    const result: SearchResult = {
      type: "artist",
      discogs_id: 3840,
      name: "Radiohead",
      title: null,
      year: null,
      country: null,
      data_quality: "Correct",
      relevance: 1,
      provenance: PROVENANCE,
    };
    expect(hrefForSearchResult(result)).toBe("/artist/3840");
  });

  it("label → /label/:id", () => {
    const result: SearchResult = {
      type: "label",
      discogs_id: 1234,
      name: "Some Label",
      title: null,
      year: null,
      country: null,
      data_quality: "Correct",
      relevance: 1,
      provenance: PROVENANCE,
    };
    expect(hrefForSearchResult(result)).toBe("/label/1234");
  });
});
