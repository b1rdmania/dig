import { describe, it, expect } from "vitest";
import type { TraversalResponse, TraversalLink } from "../traversal.js";

describe("TraversalResponse shape", () => {
  it("matches response contract for release links", () => {
    const response: TraversalResponse = {
      links: [
        {
          type: "release",
          discogs_id: 964223,
          title: "Thriller",
          year: 1982,
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 964223 },
        },
      ],
      pagination: {
        cursor: "eyJkaXNjb2dzX2lkIjo5NjQyMjN9",
        has_more: true,
        total_estimate: 150,
      },
      meta: {
        source_type: "artist",
        source_discogs_id: 45467,
        link_type: "releases",
        elapsed_ms: 12,
      },
    };

    expect(response.links).toHaveLength(1);
    expect(response.links[0].type).toBe("release");
    expect(response.links[0].discogs_id).toBe(964223);
    expect(response.pagination.has_more).toBe(true);
    expect(response.meta.link_type).toBe("releases");
  });

  it("matches response contract for credit links", () => {
    const response: TraversalResponse = {
      links: [
        {
          type: "artist",
          discogs_id: 1,
          name: "The Persuader",
          role: "Written-By",
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1 },
        },
      ],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        source_type: "release",
        source_discogs_id: 1,
        link_type: "credits",
        elapsed_ms: 5,
      },
    };

    expect(response.links[0].role).toBe("Written-By");
    expect(response.pagination.cursor).toBeNull();
  });

  it("supports empty links", () => {
    const response: TraversalResponse = {
      links: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        source_type: "artist",
        source_discogs_id: 999999,
        link_type: "releases",
        elapsed_ms: 3,
      },
    };

    expect(response.links).toHaveLength(0);
  });

  it("matches response contract for master links", () => {
    const response: TraversalResponse = {
      links: [
        {
          type: "master",
          discogs_id: 10362,
          title: "The Dark Side Of The Moon",
          year: 1973,
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 10362 },
        },
      ],
      pagination: {
        cursor: "eyJkaXNjb2dzX2lkIjoxMDM2Mn0",
        has_more: true,
        total_estimate: null,
      },
      meta: {
        source_type: "artist",
        source_discogs_id: 45467,
        link_type: "masters",
        elapsed_ms: 8,
      },
    };

    expect(response.links[0].type).toBe("master");
    expect(response.links[0].title).toBe("The Dark Side Of The Moon");
    expect(response.links[0].year).toBe(1973);
    expect(response.meta.link_type).toBe("masters");
  });

  it("matches response contract for label release links", () => {
    const response: TraversalResponse = {
      links: [
        {
          type: "release",
          discogs_id: 1,
          title: "Stockholm",
          year: 1999,
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1 },
        },
      ],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        source_type: "label",
        source_discogs_id: 5,
        link_type: "releases",
        elapsed_ms: 6,
      },
    };

    expect(response.links[0].type).toBe("release");
    expect(response.meta.source_type).toBe("label");
  });
});
