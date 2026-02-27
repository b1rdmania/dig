# Phase 2 Search Benchmark Results

**Date:** 2026-02-27
**Commit:** `584bfa9`
**Environment:** Docker for Mac Postgres 16, 18.9M releases + 2.5M masters + 2.3M labels + 289k artists
**Runner:** `npx tsx apps/api/src/benchmark.ts --runs 3` (96 total requests, 5 warmup)

## Summary

| Category | p50 | p95 | p99 | Max | Target | Status |
|----------|-----|-----|-----|-----|--------|--------|
| release-fts | 30ms | 277ms | 277ms | 277ms | p95 < 500ms | **PASS** |
| common-term | 695ms | 15,651ms | 15,651ms | 15,651ms | p99 < 1,000ms | **FAIL** |
| fuzzy | 99ms | 5,472ms | 5,472ms | 5,472ms | p95 < 500ms | **FAIL** |
| filtered | 361ms | 6,857ms | 6,857ms | 6,857ms | p95 < 300ms | **FAIL** |
| multi-entity | 45ms | 19,673ms | 19,673ms | 19,673ms | n/a | n/a |
| unicode | 26ms | 190ms | 190ms | 190ms | n/a | **PASS** |
| retrieval | 27ms | 150ms | 150ms | 150ms | p95 < 200ms | **PASS** |
| traversal | 32ms | 544ms | 544ms | 544ms | p95 < 200ms | **FAIL** |

**Overall:** 3/7 criteria pass, 4/7 fail.

## Detailed Analysis

### PASS: Release FTS (tsvector)

All release tsvector queries complete well under 500ms. The GIN index on `search_vector` is performing correctly. Even partial matches ("dark side") stay under 280ms.

| Query | Run 1 | Run 2 | Run 3 |
|-------|-------|-------|-------|
| Exact title ("Stockholm") | 189ms | 158ms | 122ms |
| Partial ("dark side") | 277ms | 251ms | 245ms |
| Multi-word ("ok computer") | 30ms | 28ms | 23ms |
| Obscure ("Svek deep house") | 12ms | 10ms | 7ms |

### FAIL: Common-term stress

"Love" and "Remix" are the problem queries. Both scan massive candidate sets in the release table (18.9M rows).

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| "Love" (release) | 7,864ms | 11,420ms | 11,927ms | Exceeds 5s timeout — not being killed |
| "The" (release) | 15ms | 84ms | 12ms | Returns 0 results (stop word stripped) |
| "DJ" (artist) | 695ms | 353ms | 268ms | OK warm |
| "Remix" (release) | 15,651ms | 6,588ms | 5,091ms | Exceeds 5s timeout — not being killed |

**Root cause:** `SET LOCAL statement_timeout` requires a transaction context to work. Without `BEGIN/COMMIT`, it has no effect. These queries run unbounded.

**Mitigation needed:**
1. Fix `statement_timeout` — wrap search queries in a transaction, or use `SET statement_timeout` (session-level)
2. Consider adding a pre-filter on data_quality to reduce candidate set
3. "Love" matches ~2M release titles — the tsvector GIN scan itself is slow at this cardinality

### FAIL: Fuzzy (pg_trgm)

Label and master fuzzy are slow on first run (cold cache), fast on subsequent runs.

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Artist typo ("Radiohed") | 99ms | 87ms | 35ms | PASS |
| Label typo ("Planet Ee") | 3,571ms | 680ms | 603ms | Cold cache spike |
| Master typo ("Thrilr") | 5,472ms | 569ms | 540ms | Cold cache spike |
| Artist 2-char off ("Madona") | 16ms | 11ms | 8ms | PASS |

**Root cause:** First-run cold cache on Docker for Mac I/O. Warm p95 for labels/masters is ~680ms — still above 500ms target.

**Mitigation needed:**
1. Migrate to native Postgres (eliminates Docker VM I/O overhead, est. 2-3x improvement)
2. Consider raising fuzzy threshold from 0.3 to 0.4 to reduce candidate set
3. Re-benchmark after native Postgres migration before adding indexes

### FAIL: Filter combinations

Genre filter on releases is the bottleneck — EXISTS subquery on 18.9M rows.

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Genre filter | 6,857ms | 1,500ms | 1,092ms | Cold then warm |
| Genre + year | 3,481ms | 361ms | 307ms | Year filter helps |
| Country filter | 1,381ms | 338ms | 318ms | OK warm |
| Style filter | 438ms | 127ms | 113ms | OK warm |

**Root cause:** Genre/style EXISTS subquery forces a scan of the join table. Warm performance is acceptable for year, country, style. Genre + FTS on releases is the pathological case.

**Mitigation needed:**
1. For genre/style: consider denormalizing into the main table (array column) to avoid JOIN
2. Alternatively: composite index on `(batch_id, genre)` in genre tables (already exists, but the EXISTS pattern may not use it efficiently)
3. Re-benchmark after native Postgres migration

### PASS: Unicode/diacritics

All diacritic queries work correctly and are fast. `unaccent` extension is functioning.

| Query | Run 1 | Run 2 | Run 3 |
|-------|-------|-------|-------|
| Bjork → Björk | 7ms | 9ms | 12ms |
| Dahlback → Dahlbäck | 114ms | 40ms | 50ms |
| Cafe del Mar | 39ms | 26ms | 190ms |
| Motorhead | 11ms | 8ms | 28ms |

### PASS: Entity retrieval

All entity detail queries well under 200ms target.

### FAIL: Traversal (marginal)

Label releases traversal is slow on cold cache (544ms) due to JOIN on release_labels → releases (18.9M rows). Warm performance is 77-98ms.

| Query | Run 1 | Run 2 | Run 3 |
|-------|-------|-------|-------|
| Artist releases | 65ms | 10ms | 32ms |
| Artist masters | 178ms | 17ms | 38ms |
| Label releases | 544ms | 77ms | 98ms |
| Release credits | 7ms | 4ms | 5ms |

**Root cause:** Docker for Mac cold cache I/O. Warm p95 is well under target.

## Environment Caveats

All benchmarks run on Docker for Mac, which adds ~2-3x I/O latency vs native Postgres due to the Linux VM + virtual filesystem layer. Many of the "FAIL" results are cold-cache effects that will improve significantly with:

1. **Native Postgres migration** (pre-Phase 2 infra task, already planned)
2. **Production deployment on Fly.io** (native Linux, NVMe storage)

## Priority Mitigations

1. **FIX `statement_timeout`** — Currently not enforced. Queries can run unbounded. Must wrap in transaction or use session-level timeout. This is a correctness bug, not just performance.
2. **Migrate to native Postgres** — Re-run benchmarks after migration. Many cold-cache failures will resolve.
3. **Common-term query optimization** — "Love" and "Remix" on 18.9M releases need investigation. Options: partial index on data_quality, term frequency pre-filtering, or clamped result estimation.
4. **Genre filter optimization** — EXISTS subquery is slow. Consider denormalization or materialized view.
5. **Re-benchmark after mitigations** — Run full suite again after each fix to measure impact.
