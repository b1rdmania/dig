# Phase 2 Search Benchmark Results

## Run 4 — Native Postgres (current)

**Date:** 2026-02-27
**Environment:** Native Postgres 14 (brew), 18.9M releases + 2.5M masters + 2.3M labels + 289k artists
**Runner:** `pnpm benchmark:search --runs 3` (96 total requests, 5 warmup)
**Mitigations applied:** same as Run 3 (statement_timeout, broad query, websearch_to_tsquery, rank threshold, max page 50)

### Summary

| Category | p50 | p95 | Max | Target | Status |
|----------|-----|-----|-----|--------|--------|
| release-fts | 30ms | 745ms | 745ms | p95 < 500ms | **FAIL** (warm 400-500ms) |
| common-term | 4ms | 314ms | 314ms | p99 < 1,000ms | **PASS** |
| fuzzy | 64ms | 2,242ms | 2,242ms | p95 < 500ms | **FAIL** (label/master trgm) |
| filtered | 2,066ms | 2,205ms | 2,205ms | p95 < 300ms | **FAIL** (genuinely slow) |
| multi-entity | 43ms | 2,988ms | 2,988ms | n/a | n/a |
| unicode | 33ms | 563ms | 563ms | n/a | cold cache |
| retrieval | 15ms | 1,220ms | 1,220ms | p95 < 200ms | **FAIL** (cold cache only) |
| traversal | 49ms | 976ms | 976ms | p95 < 200ms | **FAIL** (cold cache only) |

**Overall:** 2/7 criteria pass. Max query: 2,988ms (bounded by timeout). Cold-start PG (brand new DB, no prior cache).

### Critical finding: filtered queries are NOT Docker artifacts

Previous analysis attributed filtered query failures to Docker I/O. **Native PG proves this wrong.** Genre/country/style filters are consistently 2s+ across ALL runs, even warm:

### Release-FTS detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Exact title ("dark side of the moon") | 14ms | 524ms | 418ms | **Warm 400-500ms** — near target |
| Partial title ("blue monday") | 30ms | 745ms | 573ms | **Warm 500-700ms** — over target |
| Multi-word ("kind of blue miles") | 4ms | 54ms | 40ms | PASS |
| Obscure ("xyzzy nonexistent") | 4ms | 14ms | 5ms | PASS (0 results) |

### Common-term detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| "Love" (release) | 2ms | 4ms | 2ms | **Degraded path** — excellent |
| "The" (release) | 2ms | 8ms | 2ms | 0 results (stop word) |
| "DJ" (artist) | 314ms | 293ms | 192ms | Consistent ~200-300ms — PASS |
| "Remix" (release) | 8ms | 4ms | 3ms | **Degraded path** — excellent |

### Fuzzy detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Artist typo ("Radiohed") | 39ms | 28ms | 23ms | PASS warm |
| Label typo ("Planet Ee") | 1,684ms | 1,335ms | 1,634ms | **Consistently 1.3-1.7s — REAL** |
| Master typo ("Thrilr") | 1,296ms | 2,242ms | 2,116ms | **Consistently 1.3-2.2s — REAL** |
| Artist 2-char off ("Madona") | 4ms | 64ms | 21ms | PASS |

### Filtered detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Genre filter | 2,090ms | 2,101ms | 2,055ms | **ALL TIMEOUT — 0 results** |
| Genre + year | 1,852ms | 2,066ms | 2,205ms | **ALL TIMEOUT — 0 results** |
| Country filter | 2,084ms | 2,070ms | 2,114ms | **ALL TIMEOUT — 0 results** |
| Style filter | 1,187ms | 1,512ms | 1,847ms | **Consistently 1.2-1.8s** |

**Note:** Genre/country/year filters returning 0 results + timing out suggests the query plan is scanning join tables without hitting the index, or the filter EXISTS subqueries are running sequential scans.

### Retrieval detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Artist detail | 1,220ms | 21ms | 22ms | Cold cache spike only |
| Label detail | 178ms | 9ms | 7ms | Cold cache spike only |
| Master detail | 151ms | 6ms | 5ms | Cold cache spike only |
| Release detail | 416ms | 15ms | 14ms | Cold cache spike only |

Warm retrieval: 5-22ms — well under 200ms target. **PASSES once cache warm.**

### Traversal detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Artist releases | 237ms | 26ms | 26ms | PASS warm |
| Artist masters | 976ms | 60ms | 49ms | Cold cache spike |
| Label releases | 947ms | 336ms | 207ms | **Still 200-300ms warm** |
| Release credits | 12ms | 3ms | 3ms | PASS |

Warm traversal: 3-336ms. Label releases slow on warm — may need index tuning.

---

## Docker vs Native comparison

| Category | Docker p50 | Docker p95 | Native p50 | Native p95 | Docker artifact? |
|----------|-----------|-----------|-----------|-----------|-----------------|
| release-fts | 22ms | 1,442ms | 30ms | 745ms | **Partially** — improved but still fails |
| common-term | 5ms | 1,216ms | 4ms | 314ms | **Yes** — now passes |
| fuzzy | 44ms | 2,009ms | 64ms | 2,242ms | **No** — label/master trgm genuinely slow |
| filtered | 207ms | 2,015ms | 2,066ms | 2,205ms | **No** — genuinely broken |
| retrieval | 7ms | 25ms | 15ms | 1,220ms | **Yes** — warm is 5-22ms |
| traversal | 7ms | 58ms | 49ms | 976ms | **Partially** — label releases still 200ms+ |

### Key findings

1. **Filtered queries are genuinely broken.** Genre/country/style filters consistently timeout at 2s across all runs. This is NOT Docker overhead — it's a query plan problem (likely missing or unused indexes on join tables, or EXISTS subqueries doing sequential scans).

2. **Fuzzy pg_trgm on labels (2.3M) and masters (2.5M) is genuinely slow.** 1.3-2.2s for typo queries even warm. The GIN trgm index is either not being used, or the similarity scan is inherently expensive at this scale.

3. **Common-term degraded path works perfectly.** "Love" 2ms, "Remix" 3ms. The broad query heuristic is validated.

4. **Retrieval and traversal are fast once warm.** Cold cache spikes are expected for a fresh DB — in production with persistent caches, these will be sub-50ms.

5. **Release FTS has a warm ceiling around 400-500ms** for common queries like "dark side of the moon" and "blue monday". Close to target but not passing.

---

## Run 3 — Post-mitigations on Docker (previous)

**Date:** 2026-02-27
**Environment:** Docker for Mac Postgres 16

| Category | p50 | p95 | Max | Target | Status |
|----------|-----|-----|-----|--------|--------|
| release-fts | 22ms | 1,442ms | 1,442ms | p95 < 500ms | **FAIL** |
| common-term | 5ms | 1,216ms | 1,216ms | p99 < 1,000ms | **FAIL** |
| fuzzy | 44ms | 2,009ms | 2,009ms | p95 < 500ms | **FAIL** |
| filtered | 207ms | 2,015ms | 2,015ms | p95 < 300ms | **FAIL** |
| unicode | 8ms | 26ms | 26ms | n/a | **PASS** |
| retrieval | 7ms | 25ms | 25ms | p95 < 200ms | **PASS** |
| traversal | 7ms | 58ms | 58ms | p95 < 200ms | **PASS** |

---

## Progression

| Metric | Run 1 (no fixes) | Run 2 (+timeout) | Run 3 (+broad query) | Run 4 (native PG) |
|--------|-----------------|-------------------|---------------------|-------------------|
| Environment | Docker PG 16 | Docker PG 16 | Docker PG 16 | **Native PG 14** |
| Max query | 19,673ms | 5,754ms | 2,015ms | **2,988ms** |
| "Love" release | 11,927ms | 2,045ms | 5ms | **2ms** |
| "Remix" release | 15,651ms | 2,128ms | 7ms | **3ms** |
| Common-term p99 | — | — | 1,216ms (FAIL) | **314ms (PASS)** |
| Traversal p95 | 544ms (FAIL) | 178ms (PASS) | 58ms (PASS) | 976ms (cold) |
| Retrieval p95 | 150ms | 94ms | 25ms | 1,220ms (cold) |
| Criteria pass | 3/7 | 4/7 | 4/7 | **2/7** (cold DB) |

Note: Run 4 is on a fresh native PG with no warm cache, which inflates p95 for retrieval/traversal. Warm performance is better than Docker in most categories.

## Priority next steps (updated from native PG results)

1. **Fix filtered queries (P0)** — Genre/country/style filters are broken. `EXPLAIN ANALYZE` the filter queries, verify index usage, likely need to rewrite EXISTS subqueries or add composite indexes.
2. **Optimize fuzzy pg_trgm (P1)** — Label and master trgm queries are 1.3-2.2s. Options: raise similarity threshold from 0.3→0.5, add `SET pg_trgm.similarity_threshold`, limit candidate set, or switch to prefix-based matching.
3. **Release FTS warm ceiling (P2)** — "dark side of the moon" and "blue monday" are 400-700ms warm. May need to revisit `ts_rank_cd` vs `ts_rank`, or add a covering index.
4. **Add startup warmup (P2)** — `SELECT count(*) FROM pg_trgm_indexes` or similar to pre-warm caches. Eliminates cold-start spikes for retrieval/traversal.
5. **Re-run benchmark after fixes** — with warm cache (add explicit warmup run before measuring).
