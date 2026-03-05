# Batch Resolution Refactor (Replace Planner Coercion)

## Problem
Current `getBatchForTable()` relies on probing large `catalog.*` tables with `EXISTS (...)` and may require planner coercion (`enable_seqscan=off`) for acceptable latency on very large tables.

This is operationally fragile and hard to reason about under cache churn/restarts.

## Goal
Resolve active batch IDs in O(1) time from metadata, without scanning large entity tables and without planner toggles.

## Proposed Design

## 1) New metadata table

Create `ingest.batch_entity_coverage`:

- `batch_id UUID NOT NULL` (FK ingest.dump_batches.id)
- `entity_table TEXT NOT NULL` (e.g. `catalog.artists`, `catalog.masters`, `catalog.releases`, `catalog.labels`, `catalog.release_artists`, `catalog.master_artists`)
- `row_count BIGINT NOT NULL`
- `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
- `PRIMARY KEY (batch_id, entity_table)`

Indexes:
- `(entity_table, batch_id)`
- Optional partial index for active/qa join path

## 2) Writer path (single source of truth)

Update coverage rows whenever ingest/transform writes complete per entity table:

- At end of each transform segment, upsert row counts into `ingest.batch_entity_coverage`.
- On rerun/idempotent writes, overwrite `row_count` with current count for that table+batch.

No runtime probing of `catalog.*` required.

## 3) Reader path (`getBatchForTable`)

Replace current logic with:

```sql
SELECT b.id, b.dump_date
FROM ingest.dump_batches b
JOIN ingest.batch_entity_coverage c
  ON c.batch_id = b.id
WHERE b.status IN ('active', 'qa')
  AND c.entity_table = $1
  AND c.row_count > 0
ORDER BY b.created_at DESC
LIMIT 1;
```

Expected latency: sub-ms to low-ms.

## 4) Cache policy

Keep 60s in-memory cache as a fast path, but it becomes optional optimization rather than correctness dependency.

- Cache key: `entity_table`
- Cache value: `{ batchId, dumpDate, resolvedAt }`
- Fallback to metadata query on miss

## 5) Migration / rollout plan

1. Add migration for `ingest.batch_entity_coverage`.
2. Backfill coverage rows for current active/qa batches via one-time job.
3. Update transform pipeline to maintain coverage rows.
4. Switch `getBatchForTable` read path to metadata table.
5. Remove `enable_seqscan=off` from batch resolution path.
6. Monitor:
   - `batch_resolution_ms`
   - cache hit rate
   - error rate

## 6) Guardrails

- If coverage row missing for a table in active/qa batches, return explicit error with table name.
- Add CI/integration test: for known seeded data, all entity routes resolve non-empty batches.
- Keep import boundary rule: app code imports `sql` from `@dig/db`, never direct `kysely`.

## Acceptance Criteria

- No `enable_seqscan=off` in batch resolution path
- `getBatchForTable` p95 < 10ms under normal load
- No regression in entity/search/traversal correctness across split batches
- Post-fix validation suite remains green

## Out of Scope

- Cross-batch result merging
- Rewriting search ranking logic
- Changes to API response contracts
