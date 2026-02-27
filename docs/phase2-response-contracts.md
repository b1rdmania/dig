# Phase 2 Response Contracts

Locked JSON shapes for all retrieval endpoints. These contracts are stable — field additions are non-breaking, field removals or type changes require a version bump.

All responses include provenance. All endpoints are under `/v1/`.

## 1. Search Response

```
GET /v1/search?q=...&type=...&genre=...&year=...&limit=20&cursor=...
```

```jsonc
{
  "results": [
    {
      "type": "artist" | "label" | "master" | "release",
      "discogs_id": 3840,
      "name": "Radiohead",           // artists, labels
      "title": null,                  // masters, releases (null when name is used)
      "year": 1985,                   // nullable
      "country": null,                // releases only, nullable
      "data_quality": "Correct",
      "relevance": 0.95,             // ts_rank score, 0–1 normalized
      "provenance": {
        "source": "discogs",
        "dump_date": "2026-02-01",
        "discogs_id": 3840
      }
    }
  ],
  "pagination": {
    "cursor": "eyJkaXNjb2dzX2lkIjozODQwfQ==",  // opaque, base64
    "has_more": true,
    "total_estimate": 42              // approximate count, nullable
  },
  "meta": {
    "query": "radiohead",
    "type": "artist",
    "filters_applied": {},
    "elapsed_ms": 96,
    "hint": null,                     // e.g. "Try a different spelling" when fuzzy unavailable
    "degraded": false,                // true when results are unranked or incomplete
    "degraded_reason": null           // one of: "empty_tsquery", "broad_query", "filtered", "filtered_capped", "statement_timeout", or null
  }
}
```

### Search response rules

- `name` is set for artists and labels; `title` is set for masters and releases. The unused field is `null`.
- `results` is always an array (empty array for no results, never null).
- `pagination.cursor` is `null` when there are no more results.
- `pagination.total_estimate` may be `null` if estimation is too expensive.
- `meta.hint` is `null` unless the system has a suggestion (e.g., fuzzy disabled for releases).
- `meta.degraded` is `true` when results are returned via a non-ranked path (broad queries, filtered queries, stop-word short-circuits, or statement timeouts).
- `meta.degraded_reason` provides machine-readable context. Values: `"empty_tsquery"` (query was all stop words), `"broad_query"` (single high-frequency term), `"filtered"` (filtered release path, unranked), `"filtered_capped"` (filtered + candidate cap hit), `"statement_timeout"` (query timed out, partial results).

## 2. Entity Detail Responses

### 2a. Artist Detail

```
GET /v1/artists/:discogs_id
```

```jsonc
{
  "artist": {
    "discogs_id": 3840,
    "name": "Radiohead",
    "real_name": null,
    "profile": "Band from Oxfordshire, England...",
    "data_quality": "Correct",
    "aliases": [
      { "discogs_id": 12345, "name": "On A Friday" }
    ],
    "name_variations": ["Radio Head", "Radio-Head"],
    "members": [
      { "discogs_id": 67890, "name": "Thom Yorke", "active": true }
    ],
    "groups": [],
    "urls": ["https://radiohead.com"],
    "provenance": {
      "source": "discogs",
      "dump_date": "2026-02-01",
      "discogs_id": 3840
    }
  }
}
```

### 2b. Label Detail

```
GET /v1/labels/:discogs_id
```

```jsonc
{
  "label": {
    "discogs_id": 1,
    "name": "Planet E",
    "profile": "Detroit-based techno label...",
    "contact_info": "...",
    "parent_label": { "discogs_id": null, "name": null },
    "data_quality": "Needs Vote",
    "urls": ["https://planet-e.net"],
    "provenance": {
      "source": "discogs",
      "dump_date": "2026-02-01",
      "discogs_id": 1
    }
  }
}
```

### 2c. Master Detail

```
GET /v1/masters/:discogs_id
```

```jsonc
{
  "master": {
    "discogs_id": 10362,
    "title": "The Dark Side Of The Moon",
    "year": 1973,
    "main_release_discogs_id": 249504,
    "data_quality": "Correct",
    "artists": [
      { "discogs_id": 45467, "name": "Pink Floyd", "role": null, "join_relation": null }
    ],
    "genres": ["Rock"],
    "styles": ["Prog Rock", "Psychedelic Rock"],
    "videos": [
      { "url": "https://youtube.com/watch?v=...", "title": "Money", "duration_seconds": 382 }
    ],
    "provenance": {
      "source": "discogs",
      "dump_date": "2026-02-01",
      "discogs_id": 10362
    }
  }
}
```

### 2d. Release Detail

```
GET /v1/releases/:discogs_id
```

```jsonc
{
  "release": {
    "discogs_id": 1,
    "title": "Stockholm",
    "country": "Sweden",
    "release_year": 1999,
    "released_raw": "1999",
    "status": "Accepted",
    "notes": "The song titles are the names of six Stockholm districts.",
    "data_quality": "Needs Vote",
    "master_discogs_id": null,
    "is_main_release": null,
    "artists": [
      { "discogs_id": 1, "name": "The Persuader", "role": null, "join_relation": null }
    ],
    "labels": [
      { "discogs_id": 5, "name": "Svek", "catalog_number": "SK032" }
    ],
    "formats": [
      { "name": "Vinyl", "qty": 1, "descriptions": ["12\"", "33 ⅓ RPM"] }
    ],
    "genres": ["Electronic"],
    "styles": ["Deep House"],
    "tracks": [
      {
        "position_raw": "A1",
        "title": "Gamla Stan",
        "duration_seconds": 325,
        "disc": null,
        "credits": [
          { "artist_discogs_id": 1, "artist_name": "The Persuader", "role": "Written-By" }
        ]
      }
    ],
    "credits": [
      { "artist_discogs_id": 1, "artist_name": "The Persuader", "role": "Written-By" }
    ],
    "identifiers": [
      { "type": "Barcode", "value": "7 350007 680013", "description": null }
    ],
    "companies": [
      { "discogs_id": 266169, "name": "JVC Pressing", "entity_type": "Pressed By" }
    ],
    "videos": [
      { "url": "https://youtube.com/watch?v=...", "title": "Gamla Stan", "duration_seconds": 325 }
    ],
    "provenance": {
      "source": "discogs",
      "dump_date": "2026-02-01",
      "discogs_id": 1
    }
  }
}
```

## 3. Traversal Links Response

For navigating the entity graph. All traversal endpoints return paginated lists.

```
GET /v1/artists/:discogs_id/releases?limit=20&cursor=...
GET /v1/artists/:discogs_id/masters?limit=20&cursor=...
GET /v1/labels/:discogs_id/releases?limit=20&cursor=...
GET /v1/masters/:discogs_id/releases?limit=20&cursor=...
GET /v1/releases/:discogs_id/credits?limit=20&cursor=...
```

```jsonc
{
  "links": [
    {
      "type": "release",
      "discogs_id": 964223,
      "title": "Thriller",
      "year": 1982,
      "role": "Producer",              // nullable, present on credit traversals
      "provenance": {
        "source": "discogs",
        "dump_date": "2026-02-01",
        "discogs_id": 964223
      }
    }
  ],
  "pagination": {
    "cursor": "eyJkaXNjb2dzX2lkIjo5NjQyMjN9",
    "has_more": true,
    "total_estimate": 150
  },
  "meta": {
    "source_type": "artist",
    "source_discogs_id": 45467,
    "link_type": "releases",
    "elapsed_ms": 12
  }
}
```

### Traversal link rules

- `role` is only present on credit-based traversals (artist→releases via credits, release→credits). It is `null` on direct links (artist→releases via release_artists).
- All traversal endpoints use cursor-based pagination with the same `limit`/`cursor` contract as search.
- `total_estimate` may be `null`.

## 4. Error Response

All error responses use this shape. No exceptions.

```jsonc
{
  "error": {
    "code": "NOT_FOUND",               // machine-readable error code
    "message": "Artist 999999 not found", // human-readable description
    "details": null                     // optional structured details
  }
}
```

### Error codes

| HTTP Status | Code | When |
|-------------|------|------|
| 400 | `INVALID_REQUEST` | Missing/invalid parameters, query too short/long |
| 404 | `NOT_FOUND` | Entity does not exist for given discogs_id |
| 408 | `TIMEOUT` | Query exceeded timeout budget |
| 429 | `RATE_LIMITED` | Too many requests (includes `retry_after` in details) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 504 | `QUERY_TIMEOUT` | SQL statement timeout (includes partial results if available) |

### Error response rules

- `error.code` is always a string constant (uppercase, underscored).
- `error.message` is always a human-readable string.
- `error.details` is `null` or a JSON object with additional context (never a string).
- Error responses never include a `results` or entity key — only `error`.
