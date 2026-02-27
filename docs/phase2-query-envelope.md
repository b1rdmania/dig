# Phase 2 Query Envelope

Locked constraints for the v1 search API. All search endpoints must enforce these limits before query execution.

## Input Constraints

| Parameter | Constraint | Rationale |
|-----------|-----------|-----------|
| `q` (query string) | Min length: 2 characters | 1-char queries ("A", "I") hit millions of rows with no useful ranking |
| `q` (query string) | Max length: 200 characters | Prevent abuse; no realistic query exceeds this |
| `limit` (page size) | Default: 20, Max: 100 | Keeps response payloads bounded; >100 results per page has no UX justification |
| `cursor` | Opaque string, base64-encoded | Cursor-based pagination only; no offset parameter exposed |
| `timeout` | 5,000ms hard limit per query | Kill queries that exceed budget; return partial or error |

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
| Artists | Enabled | `name % query` with GIN trgm index, 289k–9.9M rows, p95 < 500ms |
| Labels | Enabled | `name % query` with GIN trgm index, 2.3M rows, p95 < 500ms |
| Masters | Enabled | `title % query` with GIN trgm index, 2.5M rows, p95 < 500ms |
| Releases | **Disabled in v1** | GIN trgm on 18.9M rows exceeds p99 target (4.4s warm on Docker). Use tsvector FTS only. |

### Fuzzy fallback strategy

1. Primary: `plainto_tsquery()` against `search_vector` (tsvector FTS)
2. If FTS returns zero results AND query length >= 4 AND entity type is not `release`:
   - Fall back to `similarity()` against `name`/`title` with `pg_trgm`
   - Limit to 10 results
   - Set `similarity_threshold` to 0.3
3. If entity type is `release` and FTS returns zero results:
   - Return empty results with `hint: "Try a different spelling"` in response metadata
   - Do not attempt trgm fallback

## Pathological Query Handling

| Pattern | Behavior |
|---------|----------|
| 1-character query | Reject with 400: "Query must be at least 2 characters" |
| Common stop words only ("the", "a", "an") | Execute but expect low relevance; no special handling |
| Query > 200 characters | Reject with 400: "Query too long" |
| `limit` > 100 | Clamp to 100 silently (or reject with 400) |
| `limit` < 1 | Default to 20 |
| Empty `q` with filters only | Allowed — browse mode (filter-only queries return by year desc) |

## Timeout Budget Breakdown

Total: 5,000ms hard limit.

| Phase | Budget |
|-------|--------|
| Query parsing + validation | < 5ms |
| SQL execution | < 4,500ms |
| Response serialization | < 50ms |
| Overhead (connection, middleware) | ~445ms |

If SQL execution exceeds 4,500ms, cancel via `statement_timeout` and return 504 with partial results or error.
