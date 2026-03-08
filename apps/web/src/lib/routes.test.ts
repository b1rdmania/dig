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
  it("routes master to /release/:id", () => {
    expect(hrefForMasterId(21004)).toBe("/release/21004");
    expect(hrefForMasterId("21004")).toBe("/release/21004");
  });
});

describe("hrefForReleaseId", () => {
  it("routes pressing to /version/:id", () => {
    expect(hrefForReleaseId(9267745)).toBe("/version/9267745");
    expect(hrefForReleaseId("9267745")).toBe("/version/9267745");
  });
});

describe("hrefForTraversalLink", () => {
  it("master link → /release/:id", () => {
    const link: TraversalLink = { type: "master", discogs_id: 21004, provenance: PROVENANCE };
    expect(hrefForTraversalLink(link)).toBe("/release/21004");
  });

  it("release link → /version/:id", () => {
    const link: TraversalLink = { type: "release", discogs_id: 9267745, provenance: PROVENANCE };
    expect(hrefForTraversalLink(link)).toBe("/version/9267745");
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
  it("always routes to /version/:id (pressing IDs)", () => {
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
    expect(hrefForArtistCredit(credit)).toBe("/version/9267745");
  });
});

describe("hrefForSearchResult", () => {
  it("release with master_discogs_id → canonical /release/:master_id", () => {
    const result: SearchResult = {
      type: "release",
      discogs_id: 9267745,
      master_discogs_id: 21004,
      name: null,
      title: "Loveless",
      year: 1991,
      country: "UK",
      data_quality: "Correct",
      relevance: 1,
      provenance: PROVENANCE,
    };
    expect(hrefForSearchResult(result)).toBe("/release/21004");
  });

  it("release without master_discogs_id → /version/:id", () => {
    const result: SearchResult = {
      type: "release",
      discogs_id: 9267745,
      master_discogs_id: null,
      name: null,
      title: "Standalone pressing",
      year: 1991,
      country: "UK",
      data_quality: "Correct",
      relevance: 1,
      provenance: PROVENANCE,
    };
    expect(hrefForSearchResult(result)).toBe("/version/9267745");
  });

  it("master → /release/:id", () => {
    const result: SearchResult = {
      type: "master",
      discogs_id: 21004,
      master_discogs_id: null,
      name: null,
      title: "Loveless",
      year: 1991,
      country: null,
      data_quality: "Correct",
      relevance: 1,
      provenance: PROVENANCE,
    };
    expect(hrefForSearchResult(result)).toBe("/release/21004");
  });

  it("artist → /artist/:id", () => {
    const result: SearchResult = {
      type: "artist",
      discogs_id: 3840,
      master_discogs_id: null,
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
      master_discogs_id: null,
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
