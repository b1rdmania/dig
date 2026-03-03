# EN-B API Contract (MusicBrainz Relationships)

Status: draft for implementation  
Phase: 4B (Enrichment Gate EN-B)  
Scope: additive relationship edges and artist context lookup backed by `enrich.*` crosswalks.

## 1. Contract Principles

1. Discogs remains canonical.
2. Enrichment is opt-in and additive only.
3. Every enrichment object must include:
   - `source`
   - `source_id`
   - `confidence`
   - `match_method`
4. No canonical field overwrite.
5. Existing `/v1` contracts remain backward compatible.

## 2. Query Parameters (common)

Used on enrichment-capable endpoints:

- `include_enrichment` (`boolean`, default `false`)
- `min_confidence` (`number`, default `0.7`, range `0.0..1.0`)
- `sources` (`csv`, optional, allowed: `musicbrainz,wikidata,setlistfm`)
- `limit` (`number`, endpoint-specific max)
- `cursor` (`string`, for paginated edge lists)

Validation:
- invalid `sources` -> `400 INVALID_REQUEST`
- invalid `min_confidence` -> `400 INVALID_REQUEST`

## 3. New Endpoints (EN-B)

## 3.1 Artist Relationship Graph

`GET /v1/artists/:discogs_id/relationships`

Purpose:
- return typed relationship edges for a Discogs artist, sourced from MusicBrainz (and optionally other sources later).

Query:
- `include_enrichment=true` required for non-empty response in EN-B
- `min_confidence`, `sources`, `limit`, `cursor`

Response:

```json
{
  "edges": [
    {
      "edge_type": "member_of",
      "source_entity": {
        "entity_type": "artist",
        "discogs_id": 3840,
        "name": "Radiohead"
      },
      "target_entity": {
        "entity_type": "artist",
        "discogs_id": 12345,
        "name": "On A Friday"
      },
      "valid_from": null,
      "valid_to": null,
      "provenance": {
        "source": "musicbrainz",
        "source_id": "relationship:abc123",
        "confidence": 0.98,
        "match_method": "musicbrainz_url"
      }
    }
  ],
  "pagination": {
    "cursor": "opaque",
    "has_more": false,
    "total_estimate": null
  },
  "meta": {
    "source_type": "artist",
    "source_discogs_id": 3840,
    "elapsed_ms": 41,
    "enrichment_included": true,
    "enrichment_sources": ["musicbrainz"],
    "enrichment_edge_count": 12
  }
}
```

## 3.2 Artist Context

`GET /v1/artists/:discogs_id/context`

Purpose:
- return additive context blocks from enrichment sources for mapped artists.

Query:
- `include_enrichment=true` required for non-empty response in EN-B
- `min_confidence`, `sources`

Response:

```json
{
  "context": [
    {
      "context_type": "bio",
      "content_json": {
        "summary": "English rock band formed in Abingdon..."
      },
      "provenance": {
        "source": "wikidata",
        "source_id": "Q1299",
        "confidence": 0.93,
        "match_method": "artist_crosswalk"
      }
    }
  ],
  "meta": {
    "source_type": "artist",
    "source_discogs_id": 3840,
    "elapsed_ms": 19,
    "enrichment_included": true,
    "enrichment_sources": ["wikidata"],
    "enrichment_edge_count": 0
  }
}
```

## 4. Additive Extensions to Existing Endpoints

## 4.1 Traversal endpoint extension

`GET /v1/traverse`-class endpoints keep existing schema and add optional fields in `meta`:

- `enrichment_included`
- `enrichment_sources`
- `enrichment_edge_count`

No field removals or type changes in existing objects.

## 4.2 Search endpoint extension

Search keeps current shape. Optional `meta` additions when enrichment enabled:

- `enrichment_included`
- `enrichment_sources`

Search results remain canonical records; enrichment does not alter rank in EN-B.

## 5. Error Contract Additions

Error shape remains:

```json
{
  "error": {
    "code": "INVALID_REQUEST|NOT_FOUND|QUERY_TIMEOUT|INTERNAL_ERROR",
    "message": "text",
    "details": null
  }
}
```

Additional details for enrichment validation errors:
- bad source filter
- confidence threshold out of range

## 6. Confidence and Filtering Rules

1. Default confidence floor: `0.7`.
2. Edge/context below `min_confidence` excluded.
3. If no mapped crosswalk: return empty `edges/context` with `200`.
4. If `include_enrichment=false`: return canonical-only behavior (no enrichment fields except optional meta flags set to false/empty).

## 7. Latency/SLO Expectations (EN-B)

Targets with enrichment enabled:
- p95 latency delta <= 20% relative to canonical-only baseline.
- enrichment queries that exceed timeout return:
  - canonical response where possible
  - `meta.enrichment_included=false`
  - `meta.enrichment_sources=[]`

## 8. Gate EN-B Acceptance Checklist

1. `GET /v1/artists/:id/relationships` returns typed edges with provenance.
2. `GET /v1/artists/:id/context` returns context blocks with provenance.
3. `min_confidence` and `sources` filters enforced.
4. No canonical overwrite regressions.
5. Contract tests pass for empty/mapped/partial/invalid source cases.
6. Latency delta within gate threshold.
