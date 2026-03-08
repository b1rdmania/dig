# Gate Closeout Template

Use this template for any phase/gate completion report.

---

## Gate

- Gate ID:
- Date:
- Owner:
- Decision: `GO` | `GO WITH CAVEATS` | `NO-GO`

## Scope

- What was in scope:
- What was explicitly out of scope:

## Changes Shipped

1. Commit:
   - Summary:
2. Commit:
   - Summary:

## Verification Evidence

1. Typecheck/tests:
2. Migration parity audit (`npm run audit:migrations`):
3. Regression smoke (`npm run smoke:regression`):
4. Additional checks (benchmarks/canary/MCP smoke):

## Backfill / Data Evidence (when applicable)

1. Completion marker line:
2. `ANALYZE` confirmation:
3. Guardrail SQL snapshot:
   - `entity_type, quality_status, count(*)`
   - top `quality_reason` counts
   - `quality_version` counts
4. Before/after noisy-query sample (`quality=active` vs `quality=all`):

## Metrics Snapshot

- Error rate:
- Timeout rate:
- p50/p95 (if relevant):
- Notable outliers:

## Rollback Plan

1. Rollback command(s):
2. Data rollback/migration rollback notes:
3. Post-rollback verification steps:

## Risks and Caveats

1. Risk:
   - Mitigation:
2. Risk:
   - Mitigation:

## Explicit Blockers (if not fully closed)

1. Blocker ID:
   - Impact:
   - Exit criteria:

## Follow-ups

1. Task:
   - Owner:
   - Due:
2. Task:
   - Owner:
   - Due:

## Final Sign-off

- Operationally safe to proceed: `yes/no`
- Next gate/phase to execute:
