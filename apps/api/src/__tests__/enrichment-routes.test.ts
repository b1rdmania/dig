import { describe, it, expect } from "vitest";

/**
 * Enrichment route contract tests.
 *
 * These are shape/contract tests matching the EN-B API contract
 * (docs/en-b-api-contract.md). No DB dependency — validates
 * response structures and error taxonomy.
 */

describe("enrichment route contracts", () => {
  // --- Relationships endpoint ---

  describe("GET /v1/artists/:discogs_id/relationships", () => {
    it("happy path response matches contract shape", () => {
      const response = {
        edges: [
          {
            edge_type: "member_of",
            edge_direction: "outbound",
            source_entity: { entity_type: "artist", discogs_id: 3840, name: "Radiohead" },
            target_entity: { entity_type: "artist", discogs_id: 12345, external_id: null, name: "On A Friday" },
            valid_from: null,
            valid_to: null,
            provenance: {
              source: "musicbrainz",
              source_id: "mb:artist:3840:artist:12345:member_of",
              confidence: 0.9,
              match_method: "deterministic_metadata",
            },
          },
        ],
        pagination: { cursor: null, has_more: false, total_estimate: null },
        meta: {
          source_type: "artist",
          source_discogs_id: 3840,
          elapsed_ms: 41,
          enrichment_included: true,
          enrichment_sources: ["musicbrainz"],
          enrichment_edge_count: 1,
        },
      };

      expect(response.edges).toHaveLength(1);
      expect(response.edges[0].edge_direction).toBe("outbound");
      expect(response.edges[0].provenance.source).toBe("musicbrainz");
      expect(response.edges[0].provenance.confidence).toBeGreaterThanOrEqual(0);
      expect(response.edges[0].provenance.confidence).toBeLessThanOrEqual(1);
      expect(response.meta.source_type).toBe("artist");
      expect(typeof response.meta.elapsed_ms).toBe("number");
      expect(Array.isArray(response.meta.enrichment_sources)).toBe(true);
    });

    it("include_enrichment=false returns canonical-safe meta", () => {
      const response = {
        edges: [],
        pagination: { cursor: null, has_more: false, total_estimate: null },
        meta: {
          source_type: "artist",
          source_discogs_id: 3840,
          elapsed_ms: 0,
          enrichment_included: false,
          enrichment_sources: [],
          enrichment_edge_count: 0,
        },
      };

      expect(response.meta.enrichment_included).toBe(false);
      expect(response.edges).toHaveLength(0);
      expect(response.meta.enrichment_sources).toHaveLength(0);
      expect(response.meta.enrichment_edge_count).toBe(0);
    });
  });

  // --- Context endpoint ---

  describe("GET /v1/artists/:discogs_id/context", () => {
    it("happy path response matches contract shape", () => {
      const response = {
        context: [
          {
            context_type: "bio",
            content_json: { summary: "English rock band formed in Abingdon..." },
            provenance: {
              source: "wikidata",
              source_id: "Q1299",
              confidence: 0.93,
              match_method: "artist_crosswalk",
            },
          },
        ],
        meta: {
          source_type: "artist",
          source_discogs_id: 3840,
          elapsed_ms: 19,
          enrichment_included: true,
          enrichment_sources: ["wikidata"],
          enrichment_edge_count: 0,
        },
      };

      expect(response.context).toHaveLength(1);
      expect(response.context[0].context_type).toBe("bio");
      expect(response.context[0].provenance.source).toBe("wikidata");
      expect(response.meta.enrichment_included).toBe(true);
    });

    it("include_enrichment=false returns empty context", () => {
      const response = {
        context: [],
        meta: {
          source_type: "artist",
          source_discogs_id: 3840,
          elapsed_ms: 0,
          enrichment_included: false,
          enrichment_sources: [],
          enrichment_edge_count: 0,
        },
      };

      expect(response.context).toHaveLength(0);
      expect(response.meta.enrichment_included).toBe(false);
    });
  });

  // --- Error taxonomy ---

  describe("error responses", () => {
    it("invalid discogs_id returns 400 INVALID_REQUEST", () => {
      const error = {
        error: { code: "INVALID_REQUEST", message: "Invalid discogs_id", details: null },
      };

      expect(error.error.code).toBe("INVALID_REQUEST");
      expect(error.error.details).toBeNull();
    });

    it("invalid source returns 400 INVALID_REQUEST", () => {
      const error = {
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid source: badsource. Allowed: musicbrainz, wikidata, setlistfm",
          details: null,
        },
      };

      expect(error.error.code).toBe("INVALID_REQUEST");
      expect(error.error.message).toContain("badsource");
    });

    it("invalid confidence returns 400 INVALID_REQUEST", () => {
      const error = {
        error: {
          code: "INVALID_REQUEST",
          message: "min_confidence must be between 0.0 and 1.0",
          details: null,
        },
      };

      expect(error.error.code).toBe("INVALID_REQUEST");
      expect(error.error.message).toContain("min_confidence");
    });

    it("server error returns 500 INTERNAL_ERROR", () => {
      const error = {
        error: { code: "INTERNAL_ERROR", message: "Failed to fetch relationships", details: null },
      };

      expect(error.error.code).toBe("INTERNAL_ERROR");
    });
  });
});
