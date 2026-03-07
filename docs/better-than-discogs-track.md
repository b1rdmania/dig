# Better Than Discogs Track (Execution Checklist)

Purpose: run a focused quality-improvement stream while SEO cohort expansion is paused.

Scope window: next 7-10 days.

Authority: execute under `docs/operating-implementation-guide.md` and `docs/ops-runbook.md`.

## 0) Constraints

1. Raw Discogs source data in `catalog.*` remains immutable.
2. Improvements are additive (`enrich.*`, quality metadata, read-path policy).
3. Every item needs rollback, verification evidence, and owner.
4. No item moves to DONE without migration parity and gate evidence.

## 1) Priority Queue

## 1. Data Quality Layer v1 (P2)

Goal: hide low-signal junk by default without deleting source data.

Implementation:
1. Add quality metadata for core entities (artist/label/master/release):
   - `quality_status` (`active`, `low_value`, `suppressed`, `invalid`, `orphan`)
   - `quality_reason` (deterministic reason code)
   - `quality_version`
   - `quality_scored_at`
2. Implement deterministic classifier with versioned rules.
3. Apply classifier to current corpus and delta ingest path.
4. Read path defaults to `quality_status = 'active'`; admin/debug override flag available.

Acceptance:
1. Classifier rerun is idempotent.
2. Reason-code distribution report generated.
3. Search/traversal quality improves on canary set with no regressions in core recall.

Rollback:
1. Disable default quality filter by feature flag/query flag.
2. Revert to pre-quality read path while retaining metadata.

## 2. No-Dead-Ends v2 (P1/P2)

Goal: every user-visible link resolves or provides explicit fallback.

Implementation:
1. Expand fixed canary set from 50 to 200 entities.
2. Extend checker (`scripts/no-dead-ends-check.ts`) to include:
   - release resolver fallback integrity
   - artist credits paths
   - label outbound link sections
3. Add CI gate for no-dead-ends checker.

Acceptance:
1. Canary: 200/200 pass.
2. CI blocks merges on new dead-end regressions.
3. Fallback copy exists for sparse records with no linkable entities.

Rollback:
1. CI gate can be toggled to warning-only if emergency unblock required.

## 3. Artist Completeness Upgrade (P2)

Goal: reduce artist pages with missing meaningful work links.

Implementation:
1. Audit role-family coverage (`writing`, `arranging`, `performance`, `production`, `other`).
2. Fill missing role mappings and document edge cases.
3. Ensure traversal/API exposes all mapped credits surfaces consistently.
4. Add completeness report:
   - `% artists with master/release/credits links`
   - `% artists with at least one linked work`

Acceptance:
1. Coverage report checked in to docs.
2. Spot-check set (top/famous + long-tail) passes expected link presence.
3. No performance regressions over agreed API thresholds.

Rollback:
1. Keep previous role mapping as fallback switch.

## 4. Search Ranking Quality v2 (P1)

Goal: improve relevance ordering on high-visibility queries.

Implementation:
1. Add quality-weight signal to existing exact/prefix/entity-weight scoring.
2. Preserve deterministic ordering with clear tie-breakers.
3. Add benchmark assertions for representative query classes:
   - famous artist
   - ambiguous title
   - broad term
   - filtered query

Acceptance:
1. Top-3 assertions pass for benchmark query set.
2. p95 does not regress past current SLO envelopes.
3. `degraded_reason` behavior remains deterministic.

Rollback:
1. Feature flag back to prior ranking strategy.

## 5. Release/Version Quality Pass (P1/P3)

Goal: remove blank/surprising page states and improve sparse-record UX.

Implementation:
1. Standardize resolver behavior for sparse early IDs.
2. Enforce fallback artwork chain:
   - cover art archive
   - YouTube thumbnail
   - generated OG/placeholder
3. Add explicit “limited data” copy for sparse pages.

Acceptance:
1. No blank page states in canary run.
2. Fallback artwork chain proven on sample cases.
3. Metadata/share cards still valid after fallback.

Rollback:
1. Revert resolver behavior and keep safe link fallback.

## 6. Enrichment Confidence Surfacing (P2/P3)

Goal: make additive enrichment transparent and trustworthy.

Implementation:
1. Expose provenance + confidence in relevant API responses.
2. Render confidence/provenance in UI for enrichment sections.
3. Keep Discogs fields clearly distinguished as ground truth.

Acceptance:
1. Contract updates documented in `docs/phase2-response-contracts.md` (or additive supplement).
2. UI clearly labels enrichment source and confidence.

Rollback:
1. Hide confidence UI while keeping backend fields additive.

## 2) Sequencing

Run in this order:
1. Item 1 (Data Quality Layer)
2. Item 2 (No-Dead-Ends v2)
3. Item 3 (Artist Completeness)
4. Item 4 (Ranking v2)
5. Item 5 (Release/Version pass)
6. Item 6 (Enrichment confidence)

Do not start Item 4+ until Items 1-3 are green.

## 3) Daily/Weekly Governance

Daily:
1. Error rate
2. Timeout rate
3. Canary status
4. Any open P0/P1 blockers

Weekly gate:
1. GO / GO-WITH-CAVEATS / NO-GO
2. Evidence links (benchmarks, smoke, canary, logs)
3. Explicit defer list with owner/date

Rule: no new feature stream while open P0/P1 exists.

## 4) Deliverables Expected From Agent

For each item:
1. Plan section (scope, assumptions, blast radius)
2. Code/migration changes
3. Verification output summary
4. Rollback command/procedure
5. Doc update (status + decision)

## 5) Pause Rule For SEO Expansion

SEO expansion remains paused for one week while this track hardens data quality/reliability. Resume only after weekly gate confirms no unresolved P0/P1 and no-dead-ends gate remains green.
