# Dig Operating Implementation Guide

This is the canonical execution guide for day-to-day work.

Use this document for sequencing, safety, gates, deploy checks, and incident response.
Use `docs/implementation-plan-agent-first.md` for long-form product strategy and phase context.

## 1) Operating Rules (Non-Negotiable)

1. Raw Discogs data in `catalog.*` is immutable source data.
2. Curation/enrichment happens additively (`enrich.*`, quality layers), not by destructive edits.
3. No production DB change without migration parity in repo.
4. Every production change must include: plan, verification evidence, rollback path, owner.
5. No parallel "source of truth" docs. This file governs execution.

## 2) Work Classification

1. `P0 hotfix`: service down/data correctness risk.
2. `P1 production change`: API/MCP/query/index behavior change.
3. `P2 ingest/enrichment`: batch jobs, importers, classifiers.
4. `P3 web/SEO/content`: presentation/indexing/distribution work.

## 3) Required Workflow Per Change

1. Define scope and success criteria.
2. Tag scope as one of: `sample-only`, `partial-catalog`, `full-catalog`.
2. Identify blast radius (API, MCP, DB, web, SEO, infra).
3. Implement smallest safe diff.
4. Run class-specific checks (Section 6).
5. Deploy in controlled order (Section 7).
6. Record outcome in status/decision log.
7. If not full-catalog, mark as `VALIDATED_ON_SAMPLE` only.
8. Promote to full-catalog and record in `docs/full-catalog-rollout-ledger.md` before `FULLY_CLOSED`.

## 4) Database Safety Protocol

1. Prefer additive schema changes and `IF NOT EXISTS`.
2. For large index builds, run off-peak and one heavy index at a time.
3. All long-running ingest jobs must be idempotent and resumable.
4. Run `ANALYZE` on touched large tables after major writes.
5. Keep migration parity: no durable manual prod changes left undocumented.

## 5) Query/Search Guardrails

1. Resolve batches by table/entity, never "latest batch globally."
2. Keep `statement_timeout` policy explicit and unchanged unless documented.
3. Preserve deterministic degraded behavior with `degraded_reason`.
4. Maintain fallback paths for expensive filters and cold-cache tails.
5. Re-check key EXPLAIN plans when query logic or indexes change.

## 6) Verification Matrix (Must Pass)

### P0
- Health endpoint green.
- Broken path reproduced then fixed.
- Post-fix smoke confirms no regression in critical routes.

### P1
- Typecheck/tests pass for changed packages.
- API entity/search/traversal smoke passes.
- MCP smoke passes for all tools.
- Web click-through on affected routes.

### P2
- Dry-run/sample validation first.
- Idempotency check on rerun.
- Count and spot-check verification.
- Throughput/error profile captured.

### P3
- Build/typecheck pass.
- Page-level smoke (desktop + mobile).
- Metadata/SEO expectations verified if affected.

## 7) Deploy Order and Post-Deploy Checks

1. Deploy API (if touched) -> verify `/v1/health`.
2. Deploy MCP (if touched) -> run MCP smoke.
3. Deploy web (if touched) -> verify key user journeys.
4. Run post-deploy warmup procedure from `docs/ops-runbook.md`.
5. Re-run the critical canary set before closing the task.

## 8) No-Dead-Ends Policy

1. Any linked entity on UI pages must resolve or degrade with explicit fallback copy.
2. Validate against canary set (`docs/no-dead-ends-canary-ids.md`).
3. Keep checker script green (`scripts/no-dead-ends-check.ts`) before broad rollout.

## 9) MCP Launch Policy

1. Start with strict anonymous limits + spend guardrails.
2. Keep protect mode and capacity mode operational.
3. Preserve stable response contracts and structured errors.
4. Review volume, timeout rate, and abuse signals on a weekly cadence.

## 10) SEO Rollout Policy

1. Prioritize high-signal artists + labels first.
2. Keep low-value/duplicate pages out of indexing cohorts.
3. Maintain sitemap and robots correctness.
4. Track Search Console ingestion/errors weekly before expanding cohorts.

## 11) Incident Discipline

For each incident class (API crash, search regression, DB saturation, MCP degradation):

1. Detect
2. Mitigate
3. Verify recovery
4. Record root cause
5. Add prevention action

Use `docs/ops-runbook.md` as the runbook authority.

## 12) Canonical Document Order

When docs conflict, precedence is:

1. `docs/operating-implementation-guide.md` (execution authority)
2. `docs/ops-runbook.md` (operations authority)
3. `docs/implementation-plan-agent-first.md` (product/phase strategy)
4. Specialized plans (`docs/enrichment-implementation-plan.md`, `docs/seo-staged-roadmap.md`, etc.)

## 13) Current Priority Loop

1. Keep production stable.
2. Close open P0/P1 risks first.
3. Expand SEO/enrichment cohorts only with gates and measurements.
4. Ship new surfaces only after the above remain green.
5. No item is complete until full-catalog promotion evidence exists (or a written defer decision is approved).
