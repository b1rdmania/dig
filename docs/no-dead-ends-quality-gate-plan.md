# No-Dead-Ends Quality Gate Plan (v1)

Date: 2026-03-07  
Owner: Product + Domain + Web + Ops  
Status: Execution Ready

## 1. Objective

Prevent shipping entity pages that feel empty or misleading by enforcing “actionable next steps” across artist/label/release/version pages before deploy.

## 2. Scope

In scope:
- Web UI safeguards
- API/domain invariants
- Canary dataset regression tests
- CI quality gate
- Telemetry + alerting

Out of scope:
- Full content enrichment redesign
- New ingestion architecture
- Ranking model overhaul

## 3. Hard Definition of “Dead End”

A page is a dead end if all are true:
1. Page loads successfully.
2. Core entity exists.
3. No actionable internal links are rendered (releases/versions/artists/labels/credits).
4. No explicit fallback message explains why.

## 4. Deliverables

## A) Shared Audit Spec

Create:
- `docs/no-dead-ends-audit-v1.md`

Must include:
- Per-page required sections
- Minimum actionable-link thresholds
- Allowed fallback copy
- Explicit exemptions for truly sparse entities

## B) Canary Dataset

Create:
- `docs/no-dead-ends-canary-ids.md`

Include fixed IDs:
- 20 artists (mix primary + credits-heavy)
- 10 labels
- 10 releases
- 10 versions
- Include known failure IDs (e.g., artist `769196`)

## C) API/Domain Invariant Tests

Add tests asserting:
- Artist data path includes at least one:
  - masters/releases
  - credits/appearances
  - enrichment relationships
- Label data path includes releases or fallback condition
- Release/version data path includes onward navigation targets

## D) UI Contract Tests

Add tests asserting:
- If data list empty, explicit fallback block renders.
- If credits exist, “Credits & Appearances” section renders.
- Route links are correct (`/release` vs `/version` behavior).

## E) End-to-End Canary Check Script

Add:
- `scripts/no-dead-ends-check.ts`

Behavior:
1. Load canary URL set.
2. Fetch HTML (or API backing data where applicable).
3. Count actionable links by selector/rules.
4. Validate fallback copy when links absent.
5. Output:
   - JSON report
   - markdown summary
6. Exit non-zero on violations.

## F) CI Gate

Add a workflow step that:
1. Runs unit/integration tests.
2. Runs `scripts/no-dead-ends-check.ts`.
3. Fails PR on any dead-end violation.
4. Uploads report artifact for review.

## G) Telemetry + Alerting

Add event:
- `dead_end_page_viewed`

Properties:
- `entity_type`
- `entity_id`
- `reason`
- `has_fallback_copy`
- `route`

Alerting:
- Daily threshold alert if event count exceeds baseline.

## 5. Page-Level Rules (v1)

## Artist
Must show at least one actionable set:
- Releases (masters)
- Credits & Appearances
- Related Artists

If none:
- Render explicit fallback explanation and outbound Discogs link.

## Label
Must show:
- Releases list OR explicit “no linked releases yet” fallback.

## Release
Must show:
- Artist links + at least one onward path (label/version/master/credits).

## Version
Must show:
- Parent release link + at least one onward path.

## 6. Rollout Plan

## Phase 1 (Day 1)
- Add audit spec doc.
- Add canary IDs doc.
- Standardize fallback copy blocks.

## Phase 2 (Day 2-3)
- Add domain/api invariant tests.
- Add UI contract tests.
- Implement canary check script.

## Phase 3 (Day 3)
- Add CI gate with report artifacts.

## Phase 4 (Day 4)
- Add telemetry event and daily alert.
- Run first baseline report.

## 7. Acceptance Criteria

1. Canary script passes for all fixed IDs.
2. CI blocks dead-end regressions.
3. Artist/label/release/version fallback behavior is consistent.
4. `dead_end_page_viewed` event is emitted and queryable.
5. One post-deploy report shows zero dead ends in canary set.

## 8. Ownership

- Domain/API: invariants + endpoints
- Web: rendering/fallback behavior
- Ops: CI gate + alerts
- Product: canary list maintenance + exemption approval

## 9. Non-Negotiables

1. No generic latest-batch lookup for entity endpoints.
2. No silent empty section rendering.
3. No deploy if canary set fails.

## 10. Immediate Agent Task List

1. Create `docs/no-dead-ends-audit-v1.md`.
2. Create `docs/no-dead-ends-canary-ids.md` with first 50 entities.
3. Implement `scripts/no-dead-ends-check.ts`.
4. Add tests and wire CI gate.
5. Add telemetry event + alert threshold.
6. Produce initial baseline report in docs.
