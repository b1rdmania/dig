# Dig API Quickstart

Dig is a music data layer built on the Discogs CC0 catalog. Search 24M+ records, retrieve entity details, and traverse the artist/label/release graph — via REST or MCP.

> **Staging alpha.** Full corpus: artists (584k), labels (2.3M), masters (2.5M), releases (18.9M). Enrichment: 1.2M artist crosswalks (MB+Wikidata), 423K relationship edges.

## Base URLs

| Interface | URL |
|-----------|-----|
| REST API | `https://dig-api.fly.dev/v1/` |
| MCP SSE | `https://dig-mcp.fly.dev/sse` |
| Health | `https://dig-api.fly.dev/v1/health` |

## Authentication

Two tiers, both read-only:

| Tier | How | Rate limit |
|------|-----|-----------|
| Anonymous | No header needed | 60 req/min per IP |
| Keyed | `X-API-Key: <your-key>` header | 300 req/min per key |

API keys are for rate-limit tiering only — there's no authorization layer on reads. To request a key, open a GitHub issue at [b1rdmania/dig](https://github.com/b1rdmania/dig/issues).

## Rate Limits

Every response includes these headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Max requests in current window |
| `X-RateLimit-Remaining` | Requests left |
| `X-RateLimit-Reset` | Seconds until window resets |
| `Retry-After` | Seconds to wait (429 only) |
| `X-Request-Id` | Request trace ID (UUID) |

When rate-limited, you get:
```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": { "retry_after": 60 }
  }
}
```

---

## Search

```
GET /v1/search?q=<query>&type=<type>&genre=<genre>&limit=<n>&cursor=<token>
```

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `q` | string | yes | 2-200 characters |
| `type` | enum | no | `artist`, `label`, `master`, `release` |
| `genre` | string | no | e.g. `Electronic`, `Rock` |
| `style` | string | no | e.g. `Techno`, `Deep House` |
| `year` | int | no | Exact year |
| `year_min` | int | no | Year range start |
| `year_max` | int | no | Year range end |
| `country` | string | no | e.g. `US`, `UK` |
| `limit` | int | no | 1-50, default 20 |
| `cursor` | string | no | Opaque token from previous response |

### Examples

```bash
# Search for an artist
curl "https://dig-api.fly.dev/v1/search?q=radiohead&type=artist"

# Search releases by genre and decade
curl "https://dig-api.fly.dev/v1/search?q=ambient&type=release&genre=Electronic&year_min=1990&year_max=1999"

# With API key for higher rate limit
curl -H "X-API-Key: dig_your_key_here" \
  "https://dig-api.fly.dev/v1/search?q=kraftwerk"

# Paginate through results
curl "https://dig-api.fly.dev/v1/search?q=daft+punk&type=master&cursor=eyJkaXNjb2dzX2lkIjo..."
```

### Response shape

```jsonc
{
  "results": [
    {
      "type": "artist",
      "discogs_id": 3840,
      "name": "Radiohead",       // artists + labels
      "title": null,              // masters + releases
      "year": null,
      "country": null,
      "data_quality": "Needs Vote",
      "relevance": 0.1,
      "provenance": { "source": "discogs", "dump_date": "2026-02-01", "discogs_id": 3840 }
    }
  ],
  "pagination": {
    "cursor": "eyJkaXNjb2dzX2lkIjozODQwfQ==",
    "has_more": true,
    "total_estimate": 42
  },
  "meta": {
    "query": "radiohead",
    "type": "artist",
    "filters_applied": {},
    "elapsed_ms": 96,
    "hint": null,
    "degraded": false,
    "degraded_reason": null
  }
}
```

**Key fields:**
- `degraded: true` means results are unranked (broad query like "Love", stop-word query, timeout, or filtered path)
- `degraded_reason`: `empty_tsquery`, `broad_query`, `filtered`, `filtered_capped`, or `statement_timeout`
- `hint`: human-readable suggestion to refine your query (when available)
- `cursor`: pass to the next request to paginate. `null` when no more results

---

## Entity Detail

Four endpoints, one per entity type. All return full detail with child data.

```bash
# Artist (Radiohead)
curl "https://dig-api.fly.dev/v1/artists/3840"

# Label (Planet E)
curl "https://dig-api.fly.dev/v1/labels/1"

# Master release (OK Computer)
curl "https://dig-api.fly.dev/v1/masters/384323"

# Release (Stockholm)
curl "https://dig-api.fly.dev/v1/releases/1"
```

### Artist response

```jsonc
{
  "artist": {
    "discogs_id": 3840,
    "name": "Radiohead",
    "real_name": null,
    "profile": "Band from Oxfordshire, England...",
    "data_quality": "Correct",
    "aliases": [{ "discogs_id": 12345, "name": "On A Friday" }],
    "name_variations": ["Radio Head"],
    "members": [{ "discogs_id": 67890, "name": "Thom Yorke", "active": true }],
    "groups": [],
    "urls": ["https://radiohead.com"],
    "provenance": { "source": "discogs", "dump_date": "2026-02-01", "discogs_id": 3840 }
  }
}
```

### Release response (includes tracks, credits, formats)

```jsonc
{
  "release": {
    "discogs_id": 1,
    "title": "Stockholm",
    "country": "Sweden",
    "release_year": 1999,
    "artists": [{ "discogs_id": 1, "name": "The Persuader", "role": null }],
    "labels": [{ "discogs_id": 5, "name": "Svek", "catalog_number": "SK032" }],
    "formats": [{ "name": "Vinyl", "qty": 1, "descriptions": ["12\"", "33 ⅓ RPM"] }],
    "genres": ["Electronic"],
    "styles": ["Deep House"],
    "tracks": [
      {
        "position_raw": "A1",
        "title": "Gamla Stan",
        "duration_seconds": 325,
        "credits": [{ "artist_discogs_id": 1, "artist_name": "The Persuader", "role": "Written-By" }]
      }
    ],
    "credits": [{ "artist_discogs_id": 1, "artist_name": "The Persuader", "role": "Written-By" }],
    "identifiers": [{ "type": "Barcode", "value": "7 350007 680013" }],
    "companies": [{ "discogs_id": 266169, "name": "JVC Pressing", "entity_type": "Pressed By" }],
    "videos": [{ "url": "https://youtube.com/watch?v=...", "title": "Gamla Stan", "duration_seconds": 325 }],
    "provenance": { "source": "discogs", "dump_date": "2026-02-01", "discogs_id": 1 }
  }
}
```

Full response contracts for all entities: [phase2-response-contracts.md](phase2-response-contracts.md)

---

## Traversal

Navigate the entity graph. Five link types, all cursor-paginated.

```bash
# Artist's releases
curl "https://dig-api.fly.dev/v1/artists/3840/releases?limit=5"

# Artist's master releases
curl "https://dig-api.fly.dev/v1/artists/3840/masters?limit=5"

# Label's releases
curl "https://dig-api.fly.dev/v1/labels/1/releases?limit=10"

# Master's physical releases
curl "https://dig-api.fly.dev/v1/masters/384323/releases"

# Release credits (who worked on it)
curl "https://dig-api.fly.dev/v1/releases/1/credits"
```

### Response shape

```jsonc
{
  "links": [
    {
      "type": "release",
      "discogs_id": 964223,
      "title": "Thriller",
      "year": 1982,
      "role": "Producer",      // only on credit traversals, null otherwise
      "provenance": { "source": "discogs", "dump_date": "2026-02-01", "discogs_id": 964223 }
    }
  ],
  "pagination": { "cursor": "...", "has_more": true, "total_estimate": 150 },
  "meta": { "source_type": "artist", "source_discogs_id": 3840, "link_type": "releases", "elapsed_ms": 12 }
}
```

---

## Enrichment (EN-B)

Query artist relationships and context from MusicBrainz crosswalks. Enrichment is opt-in — pass `include_enrichment=true` to get data.

```bash
# Artist relationships (member_of, collaboration, etc.)
curl "https://dig-api.fly.dev/v1/artists/3840/relationships?include_enrichment=true"

# Filter by source and confidence
curl "https://dig-api.fly.dev/v1/artists/3840/relationships?include_enrichment=true&sources=musicbrainz&min_confidence=0.9"

# Artist context blocks (bio, etc.)
curl "https://dig-api.fly.dev/v1/artists/3840/context?include_enrichment=true&sources=wikidata"

# Paginate relationships
curl "https://dig-api.fly.dev/v1/artists/3840/relationships?include_enrichment=true&limit=10&cursor=eyJpZCI6MTIzfQ"
```

### Query parameters

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `include_enrichment` | boolean | `false` | Required `true` for non-empty enrichment data |
| `min_confidence` | number | `0.7` | Range 0.0–1.0 |
| `sources` | csv | all | `musicbrainz`, `wikidata`, `setlistfm` |
| `limit` | int | `20` | 1–100 |
| `cursor` | string | — | Opaque pagination token |

### Response shape (relationships)

```jsonc
{
  "edges": [
    {
      "edge_type": "member_of",
      "source_entity": { "entity_type": "artist", "discogs_id": 3840, "name": "Radiohead" },
      "target_entity": { "entity_type": "artist", "discogs_id": 12345, "external_id": null, "name": "On A Friday" },
      "valid_from": null,
      "valid_to": null,
      "provenance": { "source": "musicbrainz", "source_id": "...", "confidence": 0.9, "match_method": "deterministic_metadata" }
    }
  ],
  "pagination": { "cursor": null, "has_more": false, "total_estimate": null },
  "meta": {
    "source_type": "artist",
    "source_discogs_id": 3840,
    "elapsed_ms": 41,
    "enrichment_included": true,
    "enrichment_sources": ["musicbrainz"],
    "enrichment_edge_count": 1
  }
}
```

Unmapped artists return `200` with empty `edges`/`context` — not `404`.

---

## MCP Setup

Dig exposes the same functionality as MCP tools for AI agents.

### Claude Code

```bash
claude mcp add --transport sse --scope user dig-catalog "https://dig-mcp.fly.dev/sse"
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dig-catalog": {
      "url": "https://dig-mcp.fly.dev/sse"
    }
  }
}
```

### Available tools

| Tool | What it does | Key params |
|------|-------------|-----------|
| `search_catalog` | Search across all entity types | `query`, `type?`, `genre?`, `style?`, `year?`, `limit?`, `cursor?` |
| `get_artist` | Get artist detail by Discogs ID | `discogs_id` |
| `get_label` | Get label detail by Discogs ID | `discogs_id` |
| `get_master` | Get master release detail by Discogs ID | `discogs_id` |
| `get_release` | Get release with tracks, credits, formats | `discogs_id` |
| `traverse_links` | Navigate entity graph | `link_type`, `discogs_id`, `limit?`, `cursor?` |

`traverse_links` accepts these `link_type` values: `artist_releases`, `artist_masters`, `label_releases`, `master_releases`, `release_credits`.

MCP tools return the exact same JSON as REST endpoints, wrapped in MCP content blocks. Error codes are identical.

---

## Errors

All errors use this shape (REST and MCP):

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Artist 999999 not found",
    "details": null
  }
}
```

| Code | HTTP | When |
|------|------|------|
| `INVALID_REQUEST` | 400 | Missing or invalid parameters |
| `NOT_FOUND` | 404 | No entity with that Discogs ID |
| `QUERY_TIMEOUT` | 408/504 | Query exceeded 3s timeout |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Data

All data comes from the [Discogs CC0 monthly data dump](https://discogs-data-dumps.s3-us-west-2.amazonaws.com/data/2026/) (February 2026). No live sync — data is refreshed on dump releases.

Every response includes `provenance` with `source: "discogs"` and `dump_date` so you always know where the data came from and how fresh it is.

**Current data:**
- Full corpus: 584k artists, 2.3M labels, 2.5M masters, 18.9M releases
- Enrichment: 1.2M artist crosswalks (MusicBrainz + Wikidata), 1.8M release crosswalks, 423K relationship edges
