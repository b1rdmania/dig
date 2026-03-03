import { describe, it, expect } from "vitest";
import {
  parseEnrichmentParams,
  validateEnrichmentParams,
  type RelationshipEdge,
  type RelationshipsResponse,
  type ContextBlock,
  type ContextResponse,
  type EnrichmentParams,
} from "../enrichment.js";

// --- Type shape tests ---

describe("RelationshipEdge shape", () => {
  it("matches response contract", () => {
    const edge: RelationshipEdge = {
      edge_type: "member_of",
      source_entity: {
        entity_type: "artist",
        discogs_id: 3840,
        name: "Radiohead",
      },
      target_entity: {
        entity_type: "artist",
        discogs_id: 12345,
        external_id: null,
        name: "On A Friday",
      },
      valid_from: null,
      valid_to: null,
      provenance: {
        source: "musicbrainz",
        source_id: "mb:artist:3840:artist:12345:member_of",
        confidence: 0.9,
        match_method: "deterministic_metadata",
      },
    };

    expect(edge.edge_type).toBe("member_of");
    expect(edge.source_entity.entity_type).toBe("artist");
    expect(edge.source_entity.discogs_id).toBe(3840);
    expect(edge.target_entity.discogs_id).toBe(12345);
    expect(edge.target_entity.external_id).toBeNull();
    expect(edge.provenance.source).toBe("musicbrainz");
    expect(edge.provenance.confidence).toBe(0.9);
  });

  it("supports external_id without discogs_id", () => {
    const edge: RelationshipEdge = {
      edge_type: "wikidata_link",
      source_entity: { entity_type: "artist", discogs_id: 45, name: "Aphex Twin" },
      target_entity: {
        entity_type: "artist",
        discogs_id: null,
        external_id: "Q207304",
        name: null,
      },
      valid_from: "1991",
      valid_to: null,
      provenance: {
        source: "wikidata",
        source_id: "Q207304",
        confidence: 0.95,
        match_method: "artist_crosswalk",
      },
    };

    expect(edge.target_entity.discogs_id).toBeNull();
    expect(edge.target_entity.external_id).toBe("Q207304");
    expect(edge.valid_from).toBe("1991");
  });
});

describe("RelationshipsResponse shape", () => {
  it("matches contract with edges", () => {
    const resp: RelationshipsResponse = {
      edges: [
        {
          edge_type: "member_of",
          source_entity: { entity_type: "artist", discogs_id: 3840, name: "Radiohead" },
          target_entity: { entity_type: "artist", discogs_id: 12345, external_id: null, name: "On A Friday" },
          valid_from: null,
          valid_to: null,
          provenance: { source: "musicbrainz", source_id: "rel:1", confidence: 0.9, match_method: "deterministic_metadata" },
        },
      ],
      pagination: { cursor: "abc123", has_more: true, total_estimate: null },
      meta: {
        source_type: "artist",
        source_discogs_id: 3840,
        elapsed_ms: 41,
        enrichment_included: true,
        enrichment_sources: ["musicbrainz"],
        enrichment_edge_count: 1,
      },
    };

    expect(resp.edges).toHaveLength(1);
    expect(resp.pagination.has_more).toBe(true);
    expect(resp.meta.enrichment_included).toBe(true);
    expect(resp.meta.enrichment_sources).toContain("musicbrainz");
    expect(resp.meta.enrichment_edge_count).toBe(1);
  });

  it("matches contract with empty edges (unmapped artist)", () => {
    const resp: RelationshipsResponse = {
      edges: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        source_type: "artist",
        source_discogs_id: 999999,
        elapsed_ms: 2,
        enrichment_included: true,
        enrichment_sources: [],
        enrichment_edge_count: 0,
      },
    };

    expect(resp.edges).toHaveLength(0);
    expect(resp.pagination.cursor).toBeNull();
    expect(resp.meta.enrichment_edge_count).toBe(0);
  });

  it("matches contract with enrichment disabled", () => {
    const resp: RelationshipsResponse = {
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

    expect(resp.meta.enrichment_included).toBe(false);
    expect(resp.edges).toHaveLength(0);
  });
});

describe("ContextBlock shape", () => {
  it("matches response contract", () => {
    const block: ContextBlock = {
      context_type: "bio",
      content_json: { summary: "English rock band formed in Abingdon..." },
      provenance: {
        source: "wikidata",
        source_id: "Q1299",
        confidence: 0.93,
        match_method: "artist_crosswalk",
      },
    };

    expect(block.context_type).toBe("bio");
    expect(block.provenance.source).toBe("wikidata");
    expect(typeof block.content_json).toBe("object");
  });
});

describe("ContextResponse shape", () => {
  it("matches contract with context blocks", () => {
    const resp: ContextResponse = {
      context: [
        {
          context_type: "bio",
          content_json: { summary: "Test bio" },
          provenance: { source: "wikidata", source_id: "Q1299", confidence: 0.93, match_method: "artist_crosswalk" },
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

    expect(resp.context).toHaveLength(1);
    expect(resp.meta.enrichment_included).toBe(true);
    expect(resp.meta.enrichment_edge_count).toBe(0);
  });

  it("matches contract with empty context (unmapped)", () => {
    const resp: ContextResponse = {
      context: [],
      meta: {
        source_type: "artist",
        source_discogs_id: 999999,
        elapsed_ms: 1,
        enrichment_included: true,
        enrichment_sources: [],
        enrichment_edge_count: 0,
      },
    };

    expect(resp.context).toHaveLength(0);
  });
});

// --- Validation tests ---

describe("parseEnrichmentParams", () => {
  it("returns defaults for empty query", () => {
    const params = parseEnrichmentParams({});
    expect(params.includeEnrichment).toBe(false);
    expect(params.minConfidence).toBe(0.7);
    expect(params.sources).toBeNull();
    expect(params.limit).toBe(20);
    expect(params.cursor).toBeUndefined();
  });

  it("parses all params", () => {
    const params = parseEnrichmentParams({
      include_enrichment: "true",
      min_confidence: "0.9",
      sources: "musicbrainz,wikidata",
      limit: "50",
      cursor: "abc123",
    });

    expect(params.includeEnrichment).toBe(true);
    expect(params.minConfidence).toBe(0.9);
    expect(params.sources).toEqual(["musicbrainz", "wikidata"]);
    expect(params.limit).toBe(50);
    expect(params.cursor).toBe("abc123");
  });

  it("clamps limit to 1-100", () => {
    expect(parseEnrichmentParams({ limit: "0" }).limit).toBe(1);
    expect(parseEnrichmentParams({ limit: "-5" }).limit).toBe(1);
    expect(parseEnrichmentParams({ limit: "200" }).limit).toBe(100);
  });

  it("treats non-'true' as false for include_enrichment", () => {
    expect(parseEnrichmentParams({ include_enrichment: "false" }).includeEnrichment).toBe(false);
    expect(parseEnrichmentParams({ include_enrichment: "1" }).includeEnrichment).toBe(false);
    expect(parseEnrichmentParams({ include_enrichment: "yes" }).includeEnrichment).toBe(false);
  });
});

describe("validateEnrichmentParams", () => {
  it("returns null for valid params", () => {
    const params: EnrichmentParams = {
      includeEnrichment: true,
      minConfidence: 0.7,
      sources: ["musicbrainz"],
      limit: 20,
    };
    expect(validateEnrichmentParams(params)).toBeNull();
  });

  it("rejects confidence below 0", () => {
    const err = validateEnrichmentParams({
      includeEnrichment: true,
      minConfidence: -0.1,
      sources: null,
      limit: 20,
    });
    expect(err).not.toBeNull();
    expect(err).toContain("min_confidence");
  });

  it("rejects confidence above 1", () => {
    const err = validateEnrichmentParams({
      includeEnrichment: true,
      minConfidence: 1.5,
      sources: null,
      limit: 20,
    });
    expect(err).not.toBeNull();
    expect(err).toContain("min_confidence");
  });

  it("rejects NaN confidence", () => {
    const err = validateEnrichmentParams({
      includeEnrichment: true,
      minConfidence: NaN,
      sources: null,
      limit: 20,
    });
    expect(err).not.toBeNull();
  });

  it("rejects invalid source", () => {
    const err = validateEnrichmentParams({
      includeEnrichment: true,
      minConfidence: 0.7,
      sources: ["musicbrainz", "badsource"],
      limit: 20,
    });
    expect(err).not.toBeNull();
    expect(err).toContain("badsource");
  });

  it("accepts all valid sources", () => {
    const err = validateEnrichmentParams({
      includeEnrichment: true,
      minConfidence: 0.5,
      sources: ["musicbrainz", "wikidata", "setlistfm"],
      limit: 20,
    });
    expect(err).toBeNull();
  });

  it("accepts null sources (all sources)", () => {
    const err = validateEnrichmentParams({
      includeEnrichment: true,
      minConfidence: 0.7,
      sources: null,
      limit: 20,
    });
    expect(err).toBeNull();
  });
});
