# Phase 2 Search Risk Mitigation

Known search performance risks and their v1 mitigations. Each risk has a measurable acceptance criterion.

## Risk 1: Release-title fuzzy search exceeds latency target

### Problem

`pg_trgm` GIN index on `catalog.releases.title` (18.9M rows) produces p99 latency of 4,377ms (warm cache, Docker for Mac). Target is < 2,000ms p99. Cold cache was 42,506ms.

Root cause: trigram GIN scans generate massive candidate sets for short/common terms. The index itself is correct — the problem is the data volume.

### v1 Policy

**Release fuzzy search is disabled in v1.**

Search path for releases:
1. Primary: `websearch_to_tsquery()` against `search_vector` (tsvector FTS with GIN index)
2. If FTS returns zero results: return empty results with `hint: "Try a different spelling"`
3. Do **not** fall back to `pg_trgm` for releases

Search path for artists/labels/masters:
1. Primary: `plainto_tsquery()` against `search_vector`
2. If FTS returns zero results AND query length >= 4: fall back to `similarity()` via `pg_trgm`
3. Artists: limit 10, `similarity_threshold = 0.30`
4. Labels/masters: limit 5, `similarity_threshold = 0.45`

### Acceptance Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| Release FTS (tsvector) p95 | < 500ms | Benchmark suite queries 1–4 (exact + partial) |
| Release FTS (tsvector) p99 | < 1,000ms | Common-term stress queries ("Love", "The") |
| Artist/label/master fuzzy p95 | < 500ms | Benchmark suite queries 9–12 (typo tolerance) |
| No fuzzy fallback on releases | 0 calls | Instrumented counter in search service |

### v2 Options (deferred)

- Pre-computed fuzzy candidate table (top 100k release titles → trigram similarity matrix)
- Client-side "did you mean?" using artist/label fuzzy results to rewrite release queries
- `pg_trgm.similarity_threshold` tuning (raise from 0.3 to 0.5 to reduce candidate set)
- Partitioned trgm index by data_quality (only index "Correct" releases)
- External fuzzy layer (meilisearch, typesense) if Postgres trgm proves permanently insufficient

## Risk 2: Common-term query explosion

### Problem

Queries like "Love", "The", "DJ" match millions of rows. Without `LIMIT`, these generate full index scans and sort operations.

### v1 Policy

1. Enforce `LIMIT` on all queries (max 50, default 20)
2. Use `ts_rank_cd()` (cover density) not `ts_rank()` (frequency) — better ranking for short queries
3. Reject 1-character queries at validation layer
4. For queries that return > 10,000 estimated rows: skip `total_estimate` (use `null`)
5. Apply `statement_timeout = '3s'` on all search queries
6. For broad/filtered release queries, use guarded degraded path (no rank sort, `discogs_id DESC`, `meta.degraded=true`)

### Acceptance Criteria

| Metric | Target |
|--------|--------|
| "Love" query returns in < 1,000ms | Enforced by statement_timeout |
| "The" query returns in < 1,000ms | Enforced by statement_timeout |
| No query ever exceeds 3,000ms per entity type | statement_timeout kills at 3s |

## Risk 3: Filter combination cardinality

### Problem

Some filter combinations (e.g., `genre=Electronic AND style=House AND country=US AND year=1990-1999`) may benefit from composite indexes that don't exist.

### v1 Policy

1. Filters are applied as WHERE clauses after FTS index scan — not as leading index columns
2. Monitor slow query log for filter-heavy queries
3. Add composite indexes only when benchmarks show a specific combination exceeding p95 target
4. v1 filter set is intentionally small (see query-envelope.md)

### Acceptance Criteria

| Metric | Target |
|--------|--------|
| Any filter+search query p95 | < 300ms |
| Genre+year filtered search p95 | < 200ms |

## Risk 4: Deep pagination performance

### Problem

Cursor-based pagination is O(1) per page, but deep pages (page 100+) may still be slow if the cursor-to-row lookup scans many rows.

### v1 Policy

1. Cursor encodes the last-seen `discogs_id` — WHERE clause on indexed column, no offset scan
2. Limit maximum pagination depth to 1,000 results (50 pages at 20/page)
3. Beyond 1,000 results: return `has_more: false` with hint to refine query

### Acceptance Criteria

| Metric | Target |
|--------|--------|
| Page 1 latency | < 200ms p95 |
| Page 50 latency | < 200ms p95 |
| Consistent per-page latency | < 10% variance between pages |

## Risk 5: Unicode and diacritic normalization

### Problem

`to_tsvector('english', ...)` strips diacritics inconsistently. Users searching for "Björk" or "Dahlbäck" may not match ASCII-normalized names.

### v1 Policy

1. Install `unaccent` extension if not present
2. Use `unaccent()` in both index population and query path
3. Test with benchmark suite Unicode queries (queries 21–24)

### Acceptance Criteria

| Metric | Target |
|--------|--------|
| "Bjork" finds "Björk" | Must match |
| "Dahlback" finds "Dahlbäck" | Must match |
| Diacritic query latency overhead | < 20% vs ASCII equivalent |
