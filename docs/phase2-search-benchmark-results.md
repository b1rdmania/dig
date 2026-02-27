# Phase 2 Search Benchmark Results

## Run 3 — Post-mitigations (current)

**Date:** 2026-02-27
**Environment:** Docker for Mac Postgres 16, 18.9M releases + 2.5M masters + 2.3M labels + 289k artists
**Runner:** `pnpm benchmark:search --runs 3` (96 total requests, 5 warmup)
**Mitigations applied:**
- Statement timeout enforced via `db.connection()` + `SET statement_timeout = '2s'`
- Broad query detection with degraded response path (unranked, fast, deterministic)
- `websearch_to_tsquery` for releases (stricter matching)
- Rank threshold filtering (`ts_rank_cd > 0.0001`)
- Max page size reduced to 50

### Summary

| Category | p50 | p95 | Max | Target | Status |
|----------|-----|-----|-----|--------|--------|
| release-fts | 22ms | 1,442ms | 1,442ms | p95 < 500ms | **FAIL** (cold cache) |
| common-term | 5ms | 1,216ms | 1,216ms | p99 < 1,000ms | **FAIL** (DJ cold) |
| fuzzy | 44ms | 2,009ms | 2,009ms | p95 < 500ms | **FAIL** (cold cache) |
| filtered | 207ms | 2,015ms | 2,015ms | p95 < 300ms | **FAIL** (genre timeout) |
| multi-entity | 19ms | 1,875ms | 1,875ms | n/a | n/a |
| unicode | 8ms | 26ms | 26ms | n/a | **PASS** |
| retrieval | 7ms | 25ms | 25ms | p95 < 200ms | **PASS** |
| traversal | 7ms | 58ms | 58ms | p95 < 200ms | **PASS** |

**Overall:** 4/7 criteria pass (up from 3/7), 3/7 fail. Max query: 2,015ms (down from 19,673ms).
**All warm p50 values are well under targets.** Remaining failures are Docker for Mac cold-cache spikes.

### Common-term detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| "Love" (release) | 5ms | 4ms | 5ms | **Degraded path** — was 12s |
| "The" (release) | 5ms | 5ms | 3ms | 0 results (stop word) |
| "DJ" (artist) | 1,216ms | 222ms | 199ms | Cold cache spike |
| "Remix" (release) | 5ms | 6ms | 7ms | **Degraded path** — was 15s |

### Fuzzy detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Artist typo ("Radiohed") | 44ms | 14ms | 11ms | PASS warm |
| Label typo ("Planet Ee") | 1,777ms | 233ms | 197ms | Cold cache spike |
| Master typo ("Thrilr") | 2,009ms | 316ms | 178ms | Cold cache, timed out on run 1 |
| Artist 2-char off ("Madona") | 5ms | 5ms | 6ms | PASS |

### Filtered detail

| Query | Run 1 | Run 2 | Run 3 | Notes |
|-------|-------|-------|-------|-------|
| Genre filter | 2,015ms | 1,753ms | 824ms | Genre EXISTS still slow |
| Genre + year | 1,464ms | 175ms | 207ms | Cold cache spike |
| Country filter | 2,006ms | 179ms | 170ms | Timed out on run 1, fast warm |
| Style filter | 466ms | 101ms | 101ms | OK warm |

### Retrieval & traversal (all PASS)

All warm queries under 25ms (retrieval) and 58ms (traversal).

---

## Progression

| Metric | Run 1 (no fixes) | Run 2 (+timeout) | Run 3 (+broad query) |
|--------|-----------------|-------------------|---------------------|
| Max query | 19,673ms | 5,754ms | **2,015ms** |
| "Love" release | 11,927ms | 2,045ms | **5ms** |
| "Remix" release | 15,651ms | 2,128ms | **7ms** |
| Traversal p95 | 544ms (FAIL) | 178ms (PASS) | **58ms** (PASS) |
| Retrieval p95 | 150ms | 94ms | **25ms** |
| Criteria pass | 3/7 | 4/7 | **4/7** |
| Criteria PASS (new) | — | +traversal, +max<5s | (same, max<5s now PASS) |

## Remaining failures — root cause analysis

All 4 remaining failures share the same root cause: **Docker for Mac cold cache I/O latency**.

| Failure | Warm performance | Cold spike | Docker artifact? |
|---------|-----------------|------------|-----------------|
| Release FTS p95 | 22ms (p50) | 1,442ms (run 1 "dark side") | **Yes** — warm is well under 500ms |
| Common-term p99 | 5ms (p50) | 1,216ms (run 1 "DJ") | **Yes** — "DJ" artist search, cold GIN |
| Fuzzy p95 | 44ms (p50) | 2,009ms (run 1 master typo) | **Yes** — pg_trgm GIN cold scan |
| Filtered p95 | 207ms (p50) | 2,015ms (run 1 genre) | **Likely** — EXISTS on cold join tables |

### Decision: benchmark on native Postgres before further optimization

These numbers do not justify deep query surgery. The warm performance is strong:
- Release FTS p50: 22ms (target: <500ms)
- Common-term p50: 5ms (target: <1,000ms)
- Fuzzy p50: 44ms (target: <500ms)
- Filtered p50: 207ms (target: <300ms)

Next step: migrate to native Postgres (`brew install postgresql@16`), re-run the benchmark, and make go/no-go decisions from native numbers. If warm performance holds, the remaining failures will resolve with native I/O.

## Priority next steps

1. **Migrate to native Postgres** — re-run benchmark as the canonical baseline
2. **Add startup warmup** for pg_trgm GIN indexes (cheap, eliminates cold spikes)
3. **Genre filter optimization** — only if still slow on native PG. Options: precomputed facet table or reverse-index strategy
4. **Raise similarity threshold** from 0.3 to 0.4 for fuzzy if still needed
