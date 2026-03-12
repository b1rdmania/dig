# Performance Baseline History

Append a row after each benchmark run or gate closeout.
Gate criteria: all SLO checks pass for 7 consecutive days.

| Date | Commit | release-fts p95 | fuzzy p95 | filtered p95 | retrieval p95 | traversal p95 | overall p50 | Errors | Notes |
|------|--------|-----------------|-----------|--------------|---------------|---------------|-------------|--------|-------|
| 2026-03-12 | `cbf6807` | — | — | — | 200ms | 474ms | 155ms | 0/96 | Burst test baseline. Slow: multi-entity 24s, fuzzy-cross 5.5s, country-filter 1.7s. Both bugs fixed (sql.raw, int4). |

---

## SLO targets

| Metric | Target | Source |
|--------|--------|--------|
| `/v1/search` p95 | < 500ms | implementation-plan-performance-hardening-v2.md |
| `/v1/search` p99 | < 2s | implementation-plan-performance-hardening-v2.md |
| 5xx rate | < 0.5% | implementation-plan-performance-hardening-v2.md |
| timeout/degraded ratio | < 2% | implementation-plan-performance-hardening-v2.md |
| retrieval p95 | < 200ms | gate E SLO |
| traversal p95 | < 500ms | gate E SLO |

---

## How to add a row

After running the benchmark:

```bash
npx tsx apps/api/src/benchmark.ts --base-url https://dig-api.fly.dev --runs 2
```

Extract p50/p95 per category from the output and add a row to the table above.
