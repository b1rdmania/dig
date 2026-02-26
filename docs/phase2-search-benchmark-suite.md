# Phase 2 Search Benchmark Suite (v1)

Use this suite before and during Phase 2 search development so tuning is driven by measured performance and result quality, not intuition.

## Goals

- Establish a repeatable `p50 / p95 / p99` latency baseline
- Catch query-shape regressions early
- Validate fuzzy matching and filter performance on the full dataset
- Define and enforce the v1 query envelope

## Metrics to Record

For each query:

- `p50`, `p95`, `p99` latency
- row count returned
- first-result correctness (manual spot check)
- SQL plan for slow outliers (`EXPLAIN ANALYZE`)
- notes on relevance issues (ranking, false positives, missing expected result)

Run each benchmark in:

- cold-ish cache (first run)
- warm cache (repeat 3–5 times)

## Query Envelope (lock before endpoint implementation)

- Minimum query length (recommended: `2` or `3`)
- Maximum page size (recommended: `50` or `100`)
- Allowed sorts (limit in v1)
- Allowed filter combinations (v1 only)
- Timeout budget per query
- Fallback behavior for pathological/common queries (`The`, 1-char queries)

## Benchmark Query Set (v1)

### 1. Exact lookup (single-entity)

1. Artist exact: `The Persuader`
2. Label exact: `Planet E`
3. Release exact: `Stockholm`
4. Master exact: `Moments In Time`

Target: exact matches should rank correctly and be consistently fast.

### 2. Prefix / partial lookup

5. Artist prefix: `dahlb`
6. Label prefix: `warp`
7. Release partial phrase: `blue monday`
8. Catalog-number-ish partial (if supported in v1): `CAT 001`

Target: prefix queries stay fast and avoid broad scans.

### 3. Fuzzy / typo tolerance

9. `persuadar` (artist typo)
10. `stokholm` (release typo)
11. `carl craigg` (artist typo)
12. `ninja tun` (label typo)

Target: `pg_trgm` path performs acceptably and returns plausible candidates.

### 4. Filtered search (common)

13. Genre + year range: `Electronic`, `1990–1999`
14. Style + country: `Techno`, `UK`
15. Genre + style + format: `Electronic` + `House` + `12"`
16. Label + year range: `Warp` + `1991–1996`

Target: filter combinations work within the supported query envelope and use indexes effectively.

### 5. Edge/common-term stress

17. `The`
18. `Love`
19. `Unknown`
20. One-character query (if allowed): `A`

Target: define and enforce graceful behavior for high-cardinality/common terms.

### 6. Unicode / punctuation

21. `Dahlbäck`
22. `Björk`
23. `L'Été` (or another apostrophe/diacritic case)
24. `A Guy Called Gerald`

Target: normalization + matching consistency for Unicode/punctuation variants.

### 7. Rare-term / high-precision

25. Rare style term from profiled data
26. Uncommon artist/label term from fixtures
27. Long exact title phrase
28. Identifier-like exact string (if supported in v1 search)

Target: high-precision retrieval without accidental truncation/normalization errors.

### 8. Pagination stress

29. Deep page on common query (`Electronic`) — page/cursor depth ~20
30. Deep page on common query + filters
31. Cursor pagination loop (10 pages)
32. Large page-size rejection (`limit=5000`) — verify validation/error path

Target: stable pagination behavior and enforced limits.

## Success Targets (v1)

- Exact lookups: `p95 < 100ms`
- Filtered search: `p95 < 200ms`
- Fuzzy/common-term stress: `p95 < 300–500ms` (or intentionally constrained by query envelope)

## Output Artifacts

Store benchmark outputs in a repeatable form:

- `docs/phase2-search-benchmark-results.md` (human summary)
- machine-readable JSON/CSV (optional)
- saved SQL plans for the slowest 5 queries

## Notes

- This suite should evolve, but changes should be versioned so you can compare regressions over time.
- Keep a small set of canonical “must pass” queries that never changes between releases.
