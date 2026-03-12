# Performance — Top Slow Query Shapes

Status: BASELINE CAPTURED (Run 8, burst test 2026-03-12)
Next update: after W1 index/query fixes ship.

---

## Known slow shapes (from burst test Run 8 / gate-closeout-hardening-v1.md)

| Shape | Observed p95 | Root cause | Status |
|-------|-------------|------------|--------|
| Multi-entity cross-search (`/v1/search?q=...` no type) | ~24s | 4 serial DB calls (artist → label → master → release) each with 3s timeout; cold cache misses on batch lookup | Open — W1 |
| Cross-language fuzzy (`/v1/search?q=...&type=artist` non-ASCII) | ~5.5s | pg_trgm trigram scan cold; similarity threshold 0.3 scans 289k rows | Open — W1 |
| Country filter (`/v1/search?q=...&country=US&type=release`) | ~1.7s | FTS + country btree join on 18.9M rows; warm path acceptable, cold path slow | Open — W1 |

---

## How to refresh this table

```bash
# Capture 24h of logs
fly logs -a dig-api --no-tail | npx tsx scripts/query-shape-capture.ts --top 20 --min-ms 500 --output docs/perf-top20-query-shapes.md
```

Run after each fix cluster to record before/after. Append results below.

---

## Fix log

### 2026-03-12 — Baseline

- **Traversal sql.raw() bug** (`cbf6807`): `SET LOCAL statement_timeout` rejected parameterized values → all 8 traversal routes 500. Fixed.
- **int4 overflow bug** (`e5d84d0`): IDs > 2,147,483,647 caused PG integer overflow → 500. Fixed.

---

## Query shape fix template

For each shape from the capture report:

```
### Shape N: <route>

**Query**: `<SQL or domain function>`
**Explain summary**: <seq scan / bitmap heap / nested loop>
**Classification**: missing index / bad planner choice / query too broad / fallback mis-selection
**Fix**: <index DDL or query rewrite>
**Migration**: `packages/db/migrations/NNN_fix.ts`
**Before**: p50=Xms p95=Yms
**After**: p50=Xms p95=Yms
```

---

## SLO targets (from implementation-plan-performance-hardening-v2.md)

| Metric | Target |
|--------|--------|
| `/v1/search` p95 | < 500ms |
| `/v1/search` p99 | < 2s |
| 5xx rate | < 0.5% |
| timeout/degraded ratio | < 2% |
