# Performance Hardening v2 (Ninja-Level)

Date: 2026-03-12  
Owner: API/Platform  
Status: READY_FOR_HANDOFF

## 1) Objective

Eliminate brownouts from slow query paths without sacrificing public search UX.

Primary targets:

1. `p95 /v1/search < 500ms`
2. `p99 /v1/search < 2s`
3. `5xx < 0.5%`
4. `timeout/degraded ratio < 2%`

---

## 2) Scope

In scope:

1. Query plan optimization for top slow shapes.
2. Search lane separation (core vs heavy paths).
3. Load shedding and fairness controls.
4. Capacity policy and burst readiness.
5. Daily performance regression gate.

Out of scope:

1. Full re-architecture of data model.
2. Multi-region DB.
3. New product features.

---

## 3) Workstreams

## W1: Slow Query Elimination (Top 20)

1. Capture top 20 slow query shapes from logs by elapsed time and frequency.
2. Reproduce each with `EXPLAIN (ANALYZE, BUFFERS)`.
3. Classify each as:
   - bad planner choice
   - missing/weak index
   - query shape too broad
   - fallback path mis-selection
4. Fix in descending impact order.

Deliverables:

1. `docs/perf-top20-query-shapes.md` (query, explain summary, fix, before/after).
2. Migration(s) for new indexes.
3. Query rewrites where required.

Acceptance:

1. Top 20 median latency reduced by >= 40%.
2. No new full-table scans on hot paths.

## W2: Search Lane Separation

1. Explicitly split search traffic into:
   - Core lane: artist/label/master + simple release search.
   - Heavy lane: release fuzzy + filtered + expensive trgm/fts combos.
2. Add strict budgets and fallback contracts for heavy lane.
3. Ensure heavy lane cannot starve core lane (pool/concurrency isolation or route-level caps).

Deliverables:

1. Route classification map in code comments and runbook.
2. Per-lane limits and timeouts.

Acceptance:

1. Core lane p95 remains <500ms during heavy-lane bursts.

## W3: Load Shedding + Fairness

1. Add endpoint-specific concurrency caps:
   - `/v1/search` heavy filtered release paths
   - `/v1/artists/:id/catalog_releases`
   - `/v1/artists/:id/credits`
2. Early shed when pool waiting or queue thresholds exceed safe limits.
3. Return explicit degraded contracts instead of allowing queue collapse.

Deliverables:

1. Config constants for per-endpoint caps.
2. Structured logs for shed events.

Acceptance:

1. No healthy-instance depletion during controlled burst tests.

## W4: Capacity Playbook

1. Define scale triggers:
   - pool waiting sustained
   - timeout ratio sustained
   - p99 threshold breach
2. Document manual and automatic responses:
   - temporarily tighten heavy lane caps
   - scale API machines
   - enable protect mode for non-core traffic

Deliverables:

1. `docs/ops-runbook.md` section: “Performance Protect Mode”.

Acceptance:

1. Incident response under 10 minutes with deterministic actions.

## W5: Daily Perf Gate

1. Add CI job to run controlled benchmark suite daily.
2. Compare against previous baseline; fail on regression thresholds.
3. Publish artifact (p50/p95/p99, 4xx/5xx, timeout/degraded ratio).

Deliverables:

1. CI workflow + artifact output.
2. `docs/perf-baseline-history.md`.

Acceptance:

1. Regressions are caught before user-visible impact.

---

## 4) Execution Order (Type-Ship)

1. Type A (safe): instrumentation and top-20 capture.
2. Type B (medium): query/index fixes + lane split.
3. Type C (risky): load shedding + scale policy tuning.
4. Type D (governance): daily perf gate enforcement.

Rollout cadence:

1. Ship one cluster of fixes.
2. Run benchmark + smoke.
3. Record before/after.
4. Continue to next cluster.

---

## 5) Concrete Task List for Agent

1. Create query-shape capture script and collect 24h sample.
2. Produce Top 20 table with impact score (latency * frequency).
3. For each of top 10 first:
   - reproduce explain
   - ship index/query fix
   - verify before/after
4. Implement core/heavy lane switch in search code.
5. Add per-endpoint concurrency caps and shed logs.
6. Add protect-mode runbook entries.
7. Add daily benchmark CI with failure thresholds.
8. Publish gate closeout with SLO deltas.

---

## 6) Validation

Required checks after each change set:

1. `pnpm --filter @dig/db typecheck`
2. `pnpm --filter @dig/domain typecheck`
3. `pnpm --filter @dig/api typecheck`
4. regression smoke
5. benchmark run with before/after diff
6. live health checks post-deploy

Hard fail conditions:

1. 5xx increase > 0.5pp
2. core-lane p95 regression > 20%
3. timeout ratio increase > 1pp

---

## 7) Exit Criteria

This phase is complete only when:

1. SLO targets in section 1 hold for 7 consecutive days.
2. No crash-loop incidents.
3. Daily perf gate green for 7 consecutive runs.
4. Protect-mode runbook tested once with recorded evidence.
