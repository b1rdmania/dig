/**
 * Enrichment domain services — EN-B.
 *
 * Queries enrich.* tables for relationship edges and context blocks.
 * Additive only — never modifies catalog.* data.
 */

import { type Kysely, sql } from "kysely";
import type { Database } from "@dig/db";

// --- Types ---

export type EnrichmentSource = "musicbrainz" | "wikidata" | "setlistfm";

const VALID_SOURCES = new Set<string>(["musicbrainz", "wikidata", "setlistfm"]);

export interface EnrichmentProvenance {
  source: string;
  source_id: string;
  confidence: number;
  match_method: string;
}

export interface RelationshipEdge {
  edge_type: string;
  source_entity: {
    entity_type: string;
    discogs_id: number;
    name: string | null;
  };
  target_entity: {
    entity_type: string;
    discogs_id: number | null;
    external_id: string | null;
    name: string | null;
  };
  valid_from: string | null;
  valid_to: string | null;
  provenance: EnrichmentProvenance;
}

export interface RelationshipsResponse {
  edges: RelationshipEdge[];
  pagination: {
    cursor: string | null;
    has_more: boolean;
    total_estimate: number | null;
  };
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    elapsed_ms: number;
    enrichment_included: boolean;
    enrichment_sources: string[];
    enrichment_edge_count: number;
  };
}

export interface ContextBlock {
  context_type: string;
  content_json: unknown;
  provenance: EnrichmentProvenance;
}

export interface ContextResponse {
  context: ContextBlock[];
  meta: {
    source_type: "artist";
    source_discogs_id: number;
    elapsed_ms: number;
    enrichment_included: boolean;
    enrichment_sources: string[];
    enrichment_edge_count: number;
  };
}

export interface EnrichmentParams {
  includeEnrichment: boolean;
  minConfidence: number;
  sources: string[] | null; // null = all sources
  limit: number;
  cursor?: string;
}

// --- Helpers ---

function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id })).toString("base64url");
}

function decodeCursor(cursor: string): number | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString());
    return typeof parsed.id === "number" ? parsed.id : null;
  } catch {
    return null;
  }
}

export function parseEnrichmentParams(query: Record<string, string | undefined>): EnrichmentParams {
  const includeEnrichment = query.include_enrichment === "true";
  const minConfidence = query.min_confidence ? parseFloat(query.min_confidence) : 0.7;
  const limit = query.limit ? Math.min(Math.max(parseInt(query.limit, 10), 1), 100) : 20;
  const cursor = query.cursor;

  let sources: string[] | null = null;
  if (query.sources) {
    sources = query.sources.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return { includeEnrichment, minConfidence, sources, limit, cursor };
}

export function validateEnrichmentParams(params: EnrichmentParams): string | null {
  if (params.minConfidence < 0 || params.minConfidence > 1 || isNaN(params.minConfidence)) {
    return "min_confidence must be between 0.0 and 1.0";
  }
  if (params.sources) {
    for (const s of params.sources) {
      if (!VALID_SOURCES.has(s)) {
        return `Invalid source: ${s}. Allowed: musicbrainz, wikidata, setlistfm`;
      }
    }
  }
  return null;
}

// --- Domain functions ---

export async function getArtistRelationships(
  db: Kysely<Database>,
  discogsId: number,
  params: EnrichmentParams,
): Promise<RelationshipsResponse> {
  const start = Date.now();

  if (!params.includeEnrichment) {
    return {
      edges: [],
      pagination: { cursor: null, has_more: false, total_estimate: null },
      meta: {
        source_type: "artist",
        source_discogs_id: discogsId,
        elapsed_ms: Date.now() - start,
        enrichment_included: false,
        enrichment_sources: [],
        enrichment_edge_count: 0,
      },
    };
  }

  const lim = params.limit;
  const afterId = params.cursor ? decodeCursor(params.cursor) : null;

  let query = sql<{
    id: number;
    edge_type: string;
    source_entity_type: string;
    source_discogs_id: number;
    target_entity_type: string;
    target_discogs_id: number | null;
    target_external_id: string | null;
    edge_source: string;
    edge_source_id: string;
    confidence: number;
    match_method: string;
    valid_from: string | null;
    valid_to: string | null;
  }>`
    SELECT id, edge_type, source_entity_type, source_discogs_id,
           target_entity_type, target_discogs_id, target_external_id,
           edge_source, edge_source_id, confidence::float, match_method,
           valid_from::text, valid_to::text
    FROM enrich.relationship_edges
    WHERE source_entity_type = 'artist'
      AND source_discogs_id = ${discogsId}
      AND confidence >= ${params.minConfidence}
      ${params.sources ? sql`AND edge_source IN (${sql.join(params.sources.map(s => sql`${s}`), sql`, `)})` : sql``}
      ${afterId !== null ? sql`AND id > ${afterId}` : sql``}
    ORDER BY id ASC
    LIMIT ${lim + 1}
  `;

  const { rows } = await query.execute(db);

  const hasMore = rows.length > lim;
  const resultRows = hasMore ? rows.slice(0, lim) : rows;

  // Collect unique discogs IDs to resolve names
  const sourceIds = new Set<number>();
  const targetIds = new Set<number>();
  for (const r of resultRows) {
    sourceIds.add(r.source_discogs_id);
    if (r.target_discogs_id) targetIds.add(r.target_discogs_id);
  }

  // Resolve names from catalog if we have edges
  const nameMap = new Map<number, string>();
  const allIds = [...sourceIds, ...targetIds];
  if (allIds.length > 0) {
    const { rows: nameRows } = await sql<{ discogs_id: number; name: string }>`
      SELECT discogs_id, name FROM catalog.artists
      WHERE discogs_id = ANY(${sql`ARRAY[${sql.join(allIds.map(id => sql`${id}`), sql`, `)}]::int[]`})
      LIMIT ${allIds.length}
    `.execute(db);
    for (const nr of nameRows) nameMap.set(nr.discogs_id, nr.name);
  }

  const usedSources = new Set<string>();
  const edges: RelationshipEdge[] = resultRows.map((r) => {
    usedSources.add(r.edge_source);
    return {
      edge_type: r.edge_type,
      source_entity: {
        entity_type: r.source_entity_type,
        discogs_id: r.source_discogs_id,
        name: nameMap.get(r.source_discogs_id) ?? null,
      },
      target_entity: {
        entity_type: r.target_entity_type,
        discogs_id: r.target_discogs_id,
        external_id: r.target_external_id,
        name: r.target_discogs_id ? (nameMap.get(r.target_discogs_id) ?? null) : null,
      },
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      provenance: {
        source: r.edge_source,
        source_id: r.edge_source_id,
        confidence: r.confidence,
        match_method: r.match_method,
      },
    };
  });

  return {
    edges,
    pagination: {
      cursor: hasMore && resultRows.length > 0 ? encodeCursor(resultRows[resultRows.length - 1].id) : null,
      has_more: hasMore,
      total_estimate: null,
    },
    meta: {
      source_type: "artist",
      source_discogs_id: discogsId,
      elapsed_ms: Date.now() - start,
      enrichment_included: true,
      enrichment_sources: [...usedSources],
      enrichment_edge_count: edges.length,
    },
  };
}

export async function getArtistContext(
  db: Kysely<Database>,
  discogsId: number,
  params: EnrichmentParams,
): Promise<ContextResponse> {
  const start = Date.now();

  if (!params.includeEnrichment) {
    return {
      context: [],
      meta: {
        source_type: "artist",
        source_discogs_id: discogsId,
        elapsed_ms: Date.now() - start,
        enrichment_included: false,
        enrichment_sources: [],
        enrichment_edge_count: 0,
      },
    };
  }

  const { rows } = await sql<{
    context_type: string;
    content_json: unknown;
    source: string;
    source_id: string;
    confidence: number;
    match_method: string;
  }>`
    SELECT context_type, content_json, source, source_id,
           confidence::float, match_method
    FROM enrich.entity_context
    WHERE entity_type = 'artist'
      AND discogs_id = ${discogsId}
      AND confidence >= ${params.minConfidence}
      ${params.sources ? sql`AND source IN (${sql.join(params.sources.map(s => sql`${s}`), sql`, `)})` : sql``}
    ORDER BY confidence DESC
    LIMIT 50
  `.execute(db);

  const usedSources = new Set<string>();
  const context: ContextBlock[] = rows.map((r) => {
    usedSources.add(r.source);
    return {
      context_type: r.context_type,
      content_json: r.content_json,
      provenance: {
        source: r.source,
        source_id: r.source_id,
        confidence: r.confidence,
        match_method: r.match_method,
      },
    };
  });

  return {
    context,
    meta: {
      source_type: "artist",
      source_discogs_id: discogsId,
      elapsed_ms: Date.now() - start,
      enrichment_included: true,
      enrichment_sources: [...usedSources],
      enrichment_edge_count: 0,
    },
  };
}
