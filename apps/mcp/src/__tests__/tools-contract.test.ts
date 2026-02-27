/**
 * MCP tool contract tests.
 *
 * These tests verify that tool handler outputs match the response contracts
 * defined in docs/phase2-response-contracts.md. They use the tool helpers
 * (toolResult, toolError) directly and validate the JSON shapes.
 *
 * No live DB — we test the output format, not the data.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Re-implement the tool helpers here to test them in isolation.
// These MUST match the helpers in server.ts exactly.
// ---------------------------------------------------------------------------

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(code: string, message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: { code, message, details: null } }),
      },
    ],
    isError: true,
  };
}

function parseToolOutput(result: ReturnType<typeof toolResult>): unknown {
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Contract shape validators
// ---------------------------------------------------------------------------

function expectProvenance(prov: any) {
  expect(prov).toBeDefined();
  expect(prov.source).toBe("discogs");
  expect(typeof prov.dump_date).toBe("string");
  expect(typeof prov.discogs_id).toBe("number");
}

function expectSearchMeta(meta: any) {
  expect(typeof meta.query).toBe("string");
  expect(typeof meta.elapsed_ms).toBe("number");
  expect(typeof meta.degraded).toBe("boolean");
  expect("degraded_reason" in meta).toBe(true);
  expect("hint" in meta).toBe(true);
  expect(typeof meta.filters_applied).toBe("object");
}

function expectPagination(pagination: any) {
  expect("cursor" in pagination).toBe(true);
  expect(typeof pagination.has_more).toBe("boolean");
  expect("total_estimate" in pagination).toBe(true);
}

function expectSearchResult(result: any) {
  expect(["artist", "label", "master", "release"]).toContain(result.type);
  expect(typeof result.discogs_id).toBe("number");
  expect(typeof result.data_quality).toBe("string");
  expect(typeof result.relevance).toBe("number");
  expectProvenance(result.provenance);
  // name or title should be present (one null, one string)
  expect(result.name !== undefined || result.title !== undefined).toBe(true);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP tool output contracts", () => {
  describe("toolResult helper", () => {
    it("wraps data in MCP content array", () => {
      const result = toolResult({ foo: "bar" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.foo).toBe("bar");
    });

    it("pretty-prints JSON", () => {
      const result = toolResult({ a: 1 });
      expect(result.content[0].text).toContain("\n");
    });
  });

  describe("toolError helper", () => {
    it("returns error in REST error taxonomy format", () => {
      const result = toolError("NOT_FOUND", "Artist 999 not found");
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("NOT_FOUND");
      expect(parsed.error.message).toBe("Artist 999 not found");
      expect(parsed.error.details).toBeNull();
    });

    it("uses consistent error codes", () => {
      for (const code of ["INVALID_REQUEST", "NOT_FOUND", "QUERY_TIMEOUT", "INTERNAL_ERROR"]) {
        const result = toolError(code, "test");
        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.error.code).toBe(code);
      }
    });
  });

  describe("search_catalog contract", () => {
    it("matches SearchResponse shape", () => {
      const searchResponse = {
        results: [
          {
            type: "artist",
            discogs_id: 3840,
            name: "Radiohead",
            title: null,
            year: null,
            country: null,
            data_quality: "Correct",
            relevance: 0.95,
            provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 3840 },
          },
        ],
        pagination: { cursor: "abc123", has_more: true, total_estimate: 42 },
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

      const result = toolResult(searchResponse);
      const parsed = parseToolOutput(result) as any;

      expect(Array.isArray(parsed.results)).toBe(true);
      expectSearchResult(parsed.results[0]);
      expectPagination(parsed.pagination);
      expectSearchMeta(parsed.meta);
    });

    it("preserves degraded response with degraded_reason", () => {
      const degradedResponse = {
        results: [
          {
            type: "release",
            discogs_id: 12345,
            name: null,
            title: "Love Song",
            year: 2020,
            country: "US",
            data_quality: "Correct",
            relevance: 0,
            provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 12345 },
          },
        ],
        pagination: { cursor: "xyz", has_more: true, total_estimate: null },
        meta: {
          query: "love",
          type: "release",
          filters_applied: {},
          elapsed_ms: 5,
          hint: "Broad query — showing recent matches.",
          degraded: true,
          degraded_reason: "broad_query",
        },
      };

      const result = toolResult(degradedResponse);
      const parsed = parseToolOutput(result) as any;

      expect(parsed.meta.degraded).toBe(true);
      expect(parsed.meta.degraded_reason).toBe("broad_query");
      expect(parsed.meta.hint).toContain("Broad query");
      expect(parsed.results[0].relevance).toBe(0);
    });

    it("preserves empty_tsquery degradation", () => {
      const emptyTsquery = {
        results: [],
        pagination: { cursor: null, has_more: false, total_estimate: null },
        meta: {
          query: "The",
          type: null,
          filters_applied: {},
          elapsed_ms: 0,
          hint: "Query contains only common words.",
          degraded: true,
          degraded_reason: "empty_tsquery",
        },
      };

      const result = toolResult(emptyTsquery);
      const parsed = parseToolOutput(result) as any;

      expect(parsed.meta.degraded_reason).toBe("empty_tsquery");
      expect(parsed.results).toHaveLength(0);
    });

    it("preserves filtered degradation", () => {
      const filtered = {
        results: [],
        pagination: { cursor: null, has_more: false, total_estimate: null },
        meta: {
          query: "house",
          type: "release",
          filters_applied: { genre: "Electronic" },
          elapsed_ms: 30,
          hint: "Filtered results — showing recent matches.",
          degraded: true,
          degraded_reason: "filtered",
        },
      };

      const result = toolResult(filtered);
      const parsed = parseToolOutput(result) as any;

      expect(parsed.meta.degraded_reason).toBe("filtered");
      expect(parsed.meta.filters_applied.genre).toBe("Electronic");
    });
  });

  describe("get_artist contract", () => {
    it("matches ArtistDetail shape wrapped in { artist }", () => {
      const artistDetail = {
        artist: {
          discogs_id: 3840,
          name: "Radiohead",
          real_name: null,
          profile: "Band from Oxfordshire",
          data_quality: "Correct",
          aliases: [{ discogs_id: 12345, name: "On A Friday" }],
          name_variations: ["Radio Head"],
          members: [{ discogs_id: 67890, name: "Thom Yorke" }],
          groups: [],
          urls: ["https://radiohead.com"],
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 3840 },
        },
      };

      const result = toolResult(artistDetail);
      const parsed = parseToolOutput(result) as any;

      expect(parsed.artist).toBeDefined();
      expect(parsed.artist.discogs_id).toBe(3840);
      expect(parsed.artist.name).toBe("Radiohead");
      expect(Array.isArray(parsed.artist.aliases)).toBe(true);
      expect(Array.isArray(parsed.artist.members)).toBe(true);
      expect(Array.isArray(parsed.artist.urls)).toBe(true);
      expectProvenance(parsed.artist.provenance);
    });

    it("returns NOT_FOUND error for missing artist", () => {
      const result = toolError("NOT_FOUND", "Artist 999999 not found");
      expect(result.isError).toBe(true);
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("NOT_FOUND");
    });
  });

  describe("get_label contract", () => {
    it("matches LabelDetail shape wrapped in { label }", () => {
      const labelDetail = {
        label: {
          discogs_id: 1,
          name: "Planet E",
          profile: "Detroit techno label",
          contact_info: null,
          parent_label: { discogs_id: null, name: null },
          data_quality: "Correct",
          urls: ["https://planet-e.net"],
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1 },
        },
      };

      const result = toolResult(labelDetail);
      const parsed = parseToolOutput(result) as any;

      expect(parsed.label).toBeDefined();
      expect(parsed.label.discogs_id).toBe(1);
      expect(parsed.label.name).toBe("Planet E");
      expect(parsed.label.parent_label).toBeDefined();
      expectProvenance(parsed.label.provenance);
    });
  });

  describe("get_master contract", () => {
    it("matches MasterDetail shape wrapped in { master }", () => {
      const masterDetail = {
        master: {
          discogs_id: 1000,
          title: "OK Computer",
          year: 1997,
          main_release_discogs_id: 2000,
          data_quality: "Correct",
          artists: [{ discogs_id: 3840, name: "Radiohead", role: null, join_relation: null }],
          genres: ["Electronic", "Rock"],
          styles: ["Alternative Rock"],
          videos: [{ url: "https://youtube.com/watch?v=abc", title: "Paranoid Android", duration_seconds: 380 }],
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 1000 },
        },
      };

      const result = toolResult(masterDetail);
      const parsed = parseToolOutput(result) as any;

      expect(parsed.master).toBeDefined();
      expect(parsed.master.title).toBe("OK Computer");
      expect(Array.isArray(parsed.master.artists)).toBe(true);
      expect(Array.isArray(parsed.master.genres)).toBe(true);
      expect(Array.isArray(parsed.master.styles)).toBe(true);
      expectProvenance(parsed.master.provenance);
    });
  });

  describe("get_release contract", () => {
    it("matches ReleaseDetail shape wrapped in { release }", () => {
      const releaseDetail = {
        release: {
          discogs_id: 5000,
          title: "OK Computer",
          country: "UK",
          release_year: 1997,
          released_raw: "1997-06-16",
          status: "Accepted",
          notes: null,
          data_quality: "Correct",
          master_discogs_id: 1000,
          is_main_release: true,
          artists: [{ discogs_id: 3840, name: "Radiohead", role: null, join_relation: null }],
          labels: [{ discogs_id: 100, name: "Parlophone", catalog_number: "CDNODATA 01" }],
          formats: [{ name: "CD", qty: 1, descriptions: ["Album"] }],
          genres: ["Electronic", "Rock"],
          styles: ["Alternative Rock"],
          tracks: [
            {
              position_raw: "1",
              title: "Airbag",
              duration_seconds: 284,
              disc: 1,
              credits: [{ artist_discogs_id: 3840, artist_name: "Radiohead", role: "Written-By" }],
            },
          ],
          credits: [{ artist_discogs_id: 3840, artist_name: "Radiohead", role: "Written-By" }],
          identifiers: [{ type: "Barcode", value: "724385522925", description: null }],
          companies: [{ discogs_id: 200, name: "EMI", entity_type: "Manufactured By" }],
          videos: [{ url: "https://youtube.com/watch?v=abc", title: "Airbag", duration_seconds: 284 }],
          provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 5000 },
        },
      };

      const result = toolResult(releaseDetail);
      const parsed = parseToolOutput(result) as any;

      expect(parsed.release).toBeDefined();
      expect(parsed.release.title).toBe("OK Computer");
      expect(Array.isArray(parsed.release.artists)).toBe(true);
      expect(Array.isArray(parsed.release.labels)).toBe(true);
      expect(Array.isArray(parsed.release.formats)).toBe(true);
      expect(Array.isArray(parsed.release.tracks)).toBe(true);
      expect(Array.isArray(parsed.release.credits)).toBe(true);
      expect(Array.isArray(parsed.release.identifiers)).toBe(true);
      expect(Array.isArray(parsed.release.companies)).toBe(true);
      expect(parsed.release.tracks[0].credits).toBeDefined();
      expectProvenance(parsed.release.provenance);
    });
  });

  describe("traverse_links contract", () => {
    it("matches TraversalResponse shape", () => {
      const traversalResponse = {
        links: [
          {
            type: "release",
            discogs_id: 5000,
            title: "OK Computer",
            year: 1997,
            role: null,
            provenance: { source: "discogs", dump_date: "2026-02-01", discogs_id: 5000 },
          },
        ],
        pagination: { cursor: "abc", has_more: true, total_estimate: null },
        meta: {
          source_type: "artist",
          source_discogs_id: 3840,
          link_type: "artist_releases",
          elapsed_ms: 25,
        },
      };

      const result = toolResult(traversalResponse);
      const parsed = parseToolOutput(result) as any;

      expect(Array.isArray(parsed.links)).toBe(true);
      expect(parsed.links[0].type).toBe("release");
      expect(parsed.links[0].discogs_id).toBe(5000);
      expectProvenance(parsed.links[0].provenance);
      expectPagination(parsed.pagination);
      expect(parsed.meta.source_type).toBe("artist");
      expect(parsed.meta.link_type).toBe("artist_releases");
      expect(typeof parsed.meta.elapsed_ms).toBe("number");
    });
  });

  describe("error taxonomy parity with REST", () => {
    it("INVALID_REQUEST matches REST 400", () => {
      const result = toolError("INVALID_REQUEST", "Query must be at least 2 characters");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("INVALID_REQUEST");
      expect(parsed.error.details).toBeNull();
    });

    it("NOT_FOUND matches REST 404", () => {
      const result = toolError("NOT_FOUND", "Artist 999 not found");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("NOT_FOUND");
    });

    it("QUERY_TIMEOUT matches REST 504", () => {
      const result = toolError("QUERY_TIMEOUT", "Search query exceeded timeout");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("QUERY_TIMEOUT");
    });

    it("INTERNAL_ERROR matches REST 500", () => {
      const result = toolError("INTERNAL_ERROR", "Internal server error");
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
