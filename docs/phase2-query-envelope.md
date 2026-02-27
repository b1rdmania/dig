# Phase 2 Query Envelope

Locked constraints for the v1 search API. All search endpoints must enforce these limits before query execution.

## Input Constraints

| Parameter | Constraint | Rationale |
|-----------|-----------|-----------|
| `q` (query string) | Min length: 2 characters | 1-char queries ("A", "I") hit millions of rows with no useful ranking |
| `q` (query string) | Max length: 200 characters | Prevent abuse; no realistic query exceeds this |
| `limit` (page size) | Default: 20, Max: 50 | Keeps response payloads bounded; reduced from 100 to limit sort cost on large result sets |
| `cursor` | Opaque string, base64-encoded | Cursor-based pagination only; no offset parameter exposed |
| `timeout` | 3,000ms per-entity statement timeout | Bound worst-case scans while still allowing cold-cache filtered release queries to return |

## Allowed Filters

All filters are optional. Multiple filters combine with AND.

| Filter | Type | Values | Index Used |
|--------|------|--------|------------|
| `type` | enum | `artist`, `label`, `master`, `release` | Routes to specific table |
| `genre` | text | Exact match against genre join table | btree on genre tables |
| `style` | text | Exact match against style join table | btree on style tables |
| `year` | integer or range | Single year or `min-max` range | btree on year/release_year |
| `country` | text | Exact match | btree on country column |
| `format` | text | Exact match against format join table | btree on format tables |
| `label` | text | FTS match against label name | GIN on labels.search_vector |
| `data_quality` | enum | `Correct`, `Complete and Correct`, `Needs Vote`, etc. | btree |

### v1 Excluded Filters (deferred)

- `artist` as cross-entity filter on releases (requires join, defer to v2)
- `identifier` / `barcode` search (requires separate index strategy)
- `has_image` boolean (images not yet integrated)
- Date range (only year supported in v1)

## Allowed Sorts

| Sort | Direction | Notes |
|------|-----------|-------|
| `relevance` (default) | desc | `ts_rank` or `ts_rank_cd` score |
| `year` | asc/desc | Release year or master year |
| `title` | asc/desc | Alphabetical on title/name |

### v1 Excluded Sorts

- `popularity` (no play/collection count data)
- `date_added` (no user-facing timestamp)
- `random` (expensive at scale)

## Fuzzy Search Policy

| Entity | Fuzzy (pg_trgm) | Policy |
|--------|-----------------|--------|
| Artists | Enabled | `name % query` with `similarity_threshold=0.30`, limit 10 |
| Labels | Enabled (guarded) | `name % query` with `similarity_threshold=0.45`, limit 5 |
| Masters | Enabled (guarded) | `title % query` with `similarity_threshold=0.45`, limit 5 |
| Releases | **Disabled in v1** | GIN trgm on 18.9M rows exceeds p99 target (4.4s warm on Docker). Use tsvector FTS only. |

### Fuzzy fallback strategy

1. Primary: `plainto_tsquery()` against `search_vector` (tsvector FTS)
2. If FTS returns zero results AND query length >= 4 AND entity type is not `release`:
   - Fall back to `similarity()` against `name`/`title` with `pg_trgm`
   - Artists: limit 10, threshold 0.30
   - Labels/masters: limit 5, threshold 0.45
3. If entity type is `release` and FTS returns zero results:
   - Return empty results with `hint: "Try a different spelling"` in response metadata
   - Do not attempt trgm fallback

## Broad Query Detection & Degraded Response

Single common terms ("Love", "Remix", "DJ", "House") match hundreds of thousands of rows in releases. These are detected as "broad queries" and served via a degraded-but-useful path.

### Broad query heuristic

A query is classified as **broad** when:
1. It is a single token (no spaces after trim), AND
2. It is 2–5 characters long, OR it matches a known high-frequency term list

Known high-frequency terms (v1, hardcoded):
`love`, `remix`, `the`, `you`, `live`, `blue`, `rock`, `jazz`, `house`, `soul`, `baby`, `night`, `dance`, `dream`, `world`, `heart`, `time`, `best`, `gold`, `fire`, `magic`, `party`, `super`, `radio`, `black`, `white`, `sweet`, `angel`, `crazy`, `happy`

### Degraded response contract

When a broad query is detected for releases:
1. Skip the full `ts_rank_cd` sort (expensive on 400k+ rows)
2. Instead: return results from `search_vector @@ query` with `LIMIT 50`, ordered by `discogs_id DESC` (newest first — deterministic, fast, no sort on rank)
3. Set `meta.degraded` to `true` in the response
4. Set `meta.hint` to `"Broad query — showing recent matches. Add filters or more search terms for ranked results."`
5. Set `pagination.has_more` to `true` (there are always more results for broad terms)

The `degraded` flag in `meta` tells clients that:
- Results are **not** ranked by relevance
- The result set is a **sample**, not the top-N by score
- Adding filters (genre, year, country) or more search terms will produce ranked results

### Response shape addition

```json
{
  "meta": {
    "query": "love",
    "type": "release",
    "filters_applied": {},
    "elapsed_ms": 45,
    "hint": "Broad query — showing recent matches. Add filters or more search terms for ranked results.",
    "degraded": true
  }
}
```

`meta.degraded` is `false` (or absent) for normal queries, `true` for broad queries.

### Broad query + filters

If a broad query has filters applied (genre, year, country), it is **not** classified as broad — the filters narrow the result set enough for ranked results to be feasible. The heuristic only fires for unfiltered broad terms.

## Release Search Two-Path Strategy

To avoid rank-sort blowups on large release result sets, v1 release search uses two execution paths:

1. **Path A (ranked)**: `ts_rank_cd` + relevance sort for unfiltered release queries.
2. **Path B (guarded)**: no rank computation, ordered by `discogs_id DESC`, with `meta.degraded=true`.
   - Broad single-term release queries always use guarded path.
   - Filtered release queries use guarded path.
   - For single-filter guarded queries, `enable_bitmapscan=off` is set on the pinned connection for that query and reset immediately after.
   - For multi-filter guarded queries, bitmap scan remains enabled because `BitmapAnd` is typically the better plan.

## Pathological Query Handling

| Pattern | Behavior |
|---------|----------|
| 1-character query | Reject with 400: "Query must be at least 2 characters" |
| Broad single-term query (releases) | Degraded mode: capped unranked results + refinement hint |
| Common stop words only ("the", "a", "an") | Execute but tsvector strips them; may return 0 results |
| Query > 200 characters | Reject with 400: "Query too long" |
| `limit` > 50 | Clamp to 50 silently |
| `limit` < 1 | Default to 20 |
| Empty `q` with filters only | Allowed — browse mode (filter-only queries return by year desc) |

## Timeout Budget Breakdown

Per-statement timeout: 3,000ms. Set via `SET statement_timeout = '3s'` on a pinned connection (`db.connection().execute()`).

| Phase | Budget |
|-------|--------|
| Query parsing + validation | < 5ms |
| SQL execution (per entity type) | < 3,000ms |
| Response serialization | < 50ms |
| Overhead (connection, middleware) | ~50ms |

If a single entity type query exceeds 3s, it is cancelled via `statement_timeout` (error code `57014`). The search continues with remaining entity types and returns partial results with `hint: "Some results may be incomplete due to query complexity"`.

Total wall time for multi-entity search is bounded to ~12s worst case (4 entity types x 3s each), but typical queries complete in < 1s.
