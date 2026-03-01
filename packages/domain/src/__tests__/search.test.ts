import { describe, it, expect } from "vitest";
import { validateSearchParams, isBroadQuery, type SearchParams, type SearchResponse } from "../search.js";

describe("validateSearchParams", () => {
  it("rejects empty params (no query, no filters)", () => {
    const err = validateSearchParams({ q: "" });
    expect(err).not.toBeNull();
    expect(err!.code).toBe("INVALID_REQUEST");
  });

  it("rejects query shorter than 2 characters", () => {
    const err = validateSearchParams({ q: "a" });
    expect(err).not.toBeNull();
    expect(err!.message).toContain("at least 2 characters");
  });

  it("rejects query longer than 200 characters", () => {
    const err = validateSearchParams({ q: "x".repeat(201) });
    expect(err).not.toBeNull();
    expect(err!.message).toContain("too long");
  });

  it("accepts valid query", () => {
    const err = validateSearchParams({ q: "radiohead" });
    expect(err).toBeNull();
  });

  it("accepts filter-only params (no query)", () => {
    const err = validateSearchParams({ q: "", genre: "Electronic" });
    expect(err).toBeNull();
  });

  it("accepts query of exactly 2 characters", () => {
    const err = validateSearchParams({ q: "ab" });
    expect(err).toBeNull();
  });

  it("accepts query of exactly 200 characters", () => {
    const err = validateSearchParams({ q: "x".repeat(200) });
    expect(err).toBeNull();
  });

  it("accepts style-only filter (no query)", () => {
    const err = validateSearchParams({ q: "", style: "Deep House" });
    expect(err).toBeNull();
  });

  it("accepts year-only filter (no query)", () => {
    const err = validateSearchParams({ q: "", year: 1995 });
    expect(err).toBeNull();
  });

  it("accepts country-only filter (no query)", () => {
    const err = validateSearchParams({ q: "", country: "US" });
    expect(err).toBeNull();
  });

  it("accepts yearMin-only filter (no query)", () => {
    const err = validateSearchParams({ q: "", yearMin: 1990 });
    expect(err).toBeNull();
  });

  it("accepts query with all filters combined", () => {
    const err = validateSearchParams({
      q: "house",
      type: "release",
      genre: "Electronic",
      style: "Deep House",
      year: 1995,
      country: "US",
      limit: 50,
    });
    expect(err).toBeNull();
  });
});

describe("isBroadQuery", () => {
  it("detects single short tokens as broad", () => {
    expect(isBroadQuery({ q: "Love" })).toBe(true);
    expect(isBroadQuery({ q: "DJ" })).toBe(true);
    expect(isBroadQuery({ q: "ab" })).toBe(true);
  });

  it("detects known high-frequency terms as broad", () => {
    expect(isBroadQuery({ q: "remix" })).toBe(true);
    expect(isBroadQuery({ q: "HOUSE" })).toBe(true);
    expect(isBroadQuery({ q: "dance" })).toBe(true);
  });

  it("does not flag multi-word queries as broad", () => {
    expect(isBroadQuery({ q: "love song" })).toBe(false);
    expect(isBroadQuery({ q: "dark side of the moon" })).toBe(false);
  });

  it("does not flag longer specific terms as broad", () => {
    expect(isBroadQuery({ q: "radiohead" })).toBe(false);
    expect(isBroadQuery({ q: "thriller" })).toBe(false);
  });

  it("does not flag broad terms when filters are applied", () => {
    expect(isBroadQuery({ q: "Love", genre: "Electronic" })).toBe(false);
    expect(isBroadQuery({ q: "DJ", year: 1995 })).toBe(false);
    expect(isBroadQuery({ q: "remix", country: "US" })).toBe(false);
  });

  it("does not flag empty query as broad", () => {
    expect(isBroadQuery({ q: "" })).toBe(false);
  });
});

describe("SearchResponse shape", () => {
  it("matches the response contract", () => {
    const response: SearchResponse = {
      results: [
        {
          type: "artist",
          discogs_id: 3840,
          master_discogs_id: null,
          name: "Radiohead",
          title: null,
          year: null,
          country: null,
          data_quality: "Correct",
          relevance: 0.95,
          provenance: {
            source: "discogs",
            dump_date: "2026-02-01",
            discogs_id: 3840,
          },
        },
      ],
      pagination: {
        cursor: "eyJkaXNjb2dzX2lkIjozODQwfQ==",
        has_more: true,
        total_estimate: 42,
      },
      meta: {
        query: "radiohead",
        type: "artist",
        filters_applied: {},
        elapsed_ms: 96,
        hint: null,
        degraded: false,
        degraded_reason: null,
      },
    };

    expect(response.results).toHaveLength(1);
    expect(response.results[0].type).toBe("artist");
    expect(response.results[0].name).toBe("Radiohead");
    expect(response.results[0].title).toBeNull();
    expect(response.results[0].provenance.source).toBe("discogs");
    expect(response.pagination.has_more).toBe(true);
    expect(response.meta.query).toBe("radiohead");
    expect(response.meta.hint).toBeNull();
    expect(response.meta.degraded).toBe(false);
  });

  it("supports degraded response", () => {
    const response: SearchResponse = {
      results: [
        {
          type: "release",
          discogs_id: 12345,
          master_discogs_id: 54321,
          name: null,
          title: "Love Song",
          year: 2020,
          country: "US",
          data_quality: "Correct",
          relevance: 0,
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 12345 },
        },
      ],
      pagination: { cursor: "abc", has_more: true, total_estimate: null },
      meta: {
        query: "love",
        type: "release",
        filters_applied: {},
        elapsed_ms: 45,
        hint: "Broad query — showing recent matches. Add filters or more search terms for ranked results.",
        degraded: true,
        degraded_reason: "broad_query",
      },
    };

    expect(response.meta.degraded).toBe(true);
    expect(response.meta.hint).toContain("Broad query");
    expect(response.results[0].relevance).toBe(0);
  });

  it("supports empty results", () => {
    const response: SearchResponse = {
      results: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: { query: "nonexistent", type: null, filters_applied: {}, elapsed_ms: 5, hint: "Try a different spelling", degraded: false, degraded_reason: null },
    };

    expect(response.results).toHaveLength(0);
    expect(response.pagination.cursor).toBeNull();
    expect(response.meta.hint).toBe("Try a different spelling");
  });
});
