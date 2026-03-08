# Full Catalog Rollout Ledger

Purpose: prevent sample-only wins from being treated as complete.

Rule: any change validated on sample/partial data must be explicitly promoted to full-catalog before it is marked `FULLY_CLOSED`.

## Status Labels

- `VALIDATED_ON_SAMPLE`
- `ROLLED_OUT_FULL`
- `FULLY_CLOSED`

Only `FULLY_CLOSED` counts as done.

## Ledger Table

| Item | Scope | Sample Evidence | Full Rollout Command/Job | Full Completion Evidence | Analyze Done | Canary/Smoke Recheck | Status | Owner | Updated |
|------|-------|-----------------|--------------------------|--------------------------|--------------|----------------------|--------|-------|---------|
| Item 1: Data Quality Layer v2 | artists/labels/masters/releases | gate-item1 doc + query samples | `q_v2_all.py` on dig-db | BACKFILL marker + guardrail snapshot | yes/no | yes/no | VALIDATED_ON_SAMPLE / ROLLED_OUT_FULL / FULLY_CLOSED | | |
| Item 2: No-Dead-Ends v2 | web canary set | checker report | CI gate + route fixes | timeout + fail/pass comparison | n/a | yes/no | VALIDATED_ON_SAMPLE / ROLLED_OUT_FULL / FULLY_CLOSED | | |

## Required Full-Rollout Evidence Block

For each item, include:

1. Rows processed vs total rows (or entities/pages tested vs total target).
2. Completion marker line/log.
3. `ANALYZE` confirmation for touched large tables (if data/index change).
4. Before/after canary or noisy-query sample.
5. Rollback path verified.

## Promotion Checklist (Copy/Paste)

- [ ] Sample validation completed and documented.
- [ ] Full-catalog rollout job/command executed.
- [ ] Full completion marker captured.
- [ ] Post-rollout `ANALYZE` done (if applicable).
- [ ] Regression smoke + canary re-run.
- [ ] Gate doc updated from `VALIDATED_ON_SAMPLE` -> `ROLLED_OUT_FULL` -> `FULLY_CLOSED`.

