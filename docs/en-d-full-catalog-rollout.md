# EN-D Full-Catalog Rollout (Setlist Timeline)

Owner: enrichment agent  
Status: NOT_STARTED  
Scope class: full-catalog (eligible set)

## 1) Objective

Promote EN-D from sample/cohort validation to full-catalog completion using the quality eligibility policy.

Full-catalog for EN-D means:
- Process all mapped artists in `enrich.artist_crosswalks` that are eligible by quality.
- Eligibility is defined by `enrich.entity_quality` for `entity_type='artist'`.

## 2) Eligibility Policy (Locked)

- `eligible`: `quality_status IN ('active','low_value')`
- `excluded`: `quality_status='suppressed'`
- Suppressed artists are intentionally skipped and must be counted in final metrics.

No "sample done" state for EN-D closeout.  
Allowed statuses only: `NOT_COMPLETE`, `FULLY_CLOSED`, or `DEFERRED_BY_DECISION`.

## 3) Execution Steps

1. Build eligible population snapshot
- Join `enrich.artist_crosswalks` to `enrich.entity_quality` by `discogs_artist_id`.
- Materialize a deterministic processing list ordered by `discogs_artist_id`.

2. Run resumable ingest
- Batch by `discogs_artist_id` (or MBID) with checkpoint table updates every batch.
- Upserts only (idempotent writes).
- Record per-batch metrics: processed, inserted, updated, errors, quota waits.

3. Apply guardrails
- Stop if error rate > 2% over the last 1,000 records.
- Stop if provider quota is exhausted.
- Resume from checkpoint on next window; no restart-from-zero runs.

4. Post-run maintenance
- `ANALYZE` touched enrichment tables.
- Re-run idempotency check (full eligible set rerun, delta must be 0).

## 4) Required Metrics (Gate Evidence)

Capture all values in closeout:

1. `artists_total`
2. `artists_eligible`
3. `artists_excluded_suppressed`
4. `artists_processed`
5. `artists_with_timeline`
6. `coverage_pct = artists_with_timeline / artists_eligible`
7. `idempotency_delta` (must be 0)
8. `error_rate_pct`
9. `quota_wait_events`
10. p50/p95 endpoint latency delta (`/v1/artists/:id/timeline`, if applicable)

## 5) Acceptance Criteria (Pass/Fail)

EN-D is `FULLY_CLOSED` only if all are true:

1. Full eligible population processed (or explicitly exhausted with reason).
2. `idempotency_delta = 0` on rerun.
3. No canonical data overwrite (enrichment-only writes).
4. API/MCP smoke pass for timeline + related enrichment tools.
5. No regression in core search/retrieval/traversal smoke.
6. Evidence logged in:
   - `docs/full-catalog-rollout-ledger.md`
   - EN-D gate closeout doc

If any fail, status remains `NOT_COMPLETE`.

## 6) Verification Queries (Template)

Use equivalent queries in your environment and record outputs.

```sql
-- Eligible vs excluded artists
select
  count(*) filter (where eq.quality_status in ('active','low_value')) as artists_eligible,
  count(*) filter (where eq.quality_status = 'suppressed') as artists_excluded_suppressed
from enrich.artist_crosswalks ac
join enrich.entity_quality eq
  on eq.entity_type = 'artist'
 and eq.discogs_id = ac.discogs_artist_id;

-- Artists with at least one timeline context row
select count(distinct ec.discogs_id) as artists_with_timeline
from enrich.entity_context ec
join enrich.entity_quality eq
  on eq.entity_type = ec.entity_type
 and eq.discogs_id = ec.discogs_id
where ec.entity_type = 'artist'
  and ec.context_type = 'timeline_note'
  and eq.quality_status in ('active','low_value');
```

```sql
-- Idempotency delta check (run before/after rerun)
select count(*) as timeline_rows
from enrich.entity_context
where entity_type = 'artist'
  and context_type = 'timeline_note';
```

## 7) Rollback / Abort

- EN-D writes are additive in `enrich.*`; canonical `catalog.*` is untouched.
- If abort is required:
  1. stop worker process
  2. keep checkpoint state
  3. investigate errors
  4. resume from last successful checkpoint

No destructive rollback of enrichment rows during active investigation.

## 8) Agent Handoff Instructions (Copy/Paste)

1. Execute EN-D only on the quality-eligible artist set (`active`,`low_value`).
2. Use resumable idempotent batches with checkpoint persistence.
3. Capture required metrics in Section 4 and append to EN-D closeout.
4. Run idempotency rerun and prove delta = 0.
5. Update:
   - `docs/full-catalog-rollout-ledger.md`
   - EN-D closeout doc
   - gate decision status
6. Do not mark EN-D closed unless acceptance criteria in Section 5 all pass.
