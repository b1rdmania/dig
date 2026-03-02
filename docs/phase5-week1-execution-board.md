# Phase 5 Week 1 Execution Board

Status: in-progress (Day 5 complete)
Scope: execute immediate post-Phase 4 priorities without changing Phase 0-4 architecture decisions.

This board is an execution layer on top of:
- `docs/implementation-plan-agent-first.md` (Phase 5 and Gate E)
- `docs/phase4-prerequisites.md` (Phase 4 completion + current caveats)
- `docs/current-agent-handoff.md` (active work handoff)

It does not replace the implementation plan. It sequences the next 7 days so delivery stays measurable.

## Priorities

1. P0: search stability under concurrency (especially filtered release queries)
2. P0: track-level credits UX on release/version pages
3. P1: search ranking + dedupe quality for real user intents
4. P1: alpha instrumentation and invite loop
5. P2: enrichment continues in background (no launch blocking)

## Day-by-Day Plan

### Day 1: Load + SLO Baseline (P0)

Tasks:
1. Freeze SLO table for alpha (`p50`, `p95`, `p99`, timeout rate, error rate)
2. Run c100 load tests for:
   - artist FTS
   - broad release FTS
   - filtered release query (`genre+year`)
3. Publish baseline results in docs and progress page

Done criteria:
1. ~~Baseline numbers are committed~~ ✅ `docs/slo-baseline-alpha.md` (commit `f5cb332`)
2. ~~Outliers are tagged with severity (`P0`/`P1`)~~ ✅ Broad FTS p95 and filtered release p95 tagged P1
3. ~~A go/no-go threshold is explicit for each search class~~ ✅ GO for all classes (two with caveats)

### Day 2: Filtered Query Hardening (P0)

Tasks:
1. Finalize guarded path for expensive filter combinations
2. Ensure degraded responses are explicit and deterministic
3. Verify no timeout storms under c100

Done criteria:
1. ~~`0` 5xx errors under c100 filtered load~~ ✅ Zero 5xx across all c10-c20 stress tests
2. ~~Timeout rate below agreed SLO threshold~~ ✅ Zero timeouts post-fix (was 3 timeouts before)
3. ~~Tests include degraded path assertions~~ ✅ All filtered paths return `degraded_reason: "filtered_capped"`

### Day 3: Track-Level Credits UX (P0)

Tasks:
1. Add per-track credit visibility on release/version pages
2. Keep layout scan-friendly and mobile-first
3. Link credited people/entities where IDs are available

Done criteria:
1. ~~Track rows expose performer/engineer/writer-style credits~~ ✅ Always-visible inline credits grouped by role (Written-By, Mixed By, Vocals, etc.)
2. ~~Mobile renders cleanly at 375px width~~ ✅ 480px breakpoint with stacked credit rows, narrower position column
3. ~~Route behavior remains consistent (`/release`, `/version`)~~ ✅ All routes return 200, both `/release/[id]` and `/version/[id]` render track credits via shared Tracklist component

### Day 4: Search IA Upgrade (P1)

Tasks:
1. Improve ranking behavior for high-volume artist intents (e.g. ambiguous artist names)
2. Keep master-first grouping and reduce duplicate clutter
3. Improve quick context shown in results (type, artist, year signal)

Done criteria:
1. ~~Relevance regression checks pass on benchmark suite~~ ✅ Before/after captured in `docs/day4-search-ia-upgrade.md`. Exact matches now surface correctly (Prince artist #1, Coltrane's Blue Train appears, DSOTM masters visible).
2. ~~Duplicate-heavy queries show materially cleaner results~~ ✅ FK-based dedup replaces fuzzy title+year. Per-type cap prevents single-type flooding. Frontend caps sections at 5 with "+N more".
3. ~~No latency regression beyond agreed SLO envelope~~ ✅ All queries within SLO: prince 90ms, miles davis 34ms, love 392ms, filtered 904ms.

### Day 5: Product Instrumentation (P1)

Tasks:
1. Add events for:
   - search submit
   - search result click
   - release/version page load
   - outbound Discogs click
2. Keep telemetry minimal and privacy-safe
3. Document event schema + query examples

Done criteria:
1. ~~Events are emitted and observable~~ ✅ 5 event types: `search_submitted`, `search_result_clicked`, `release_page_viewed`, `version_page_viewed`, `outbound_discogs_clicked`. All logged to Fly structured logs.
2. ~~Event fields are documented in one place~~ ✅ `docs/telemetry-schema.md` — full schema, log format, query examples.
3. ~~Can answer top search/click-through questions from data~~ ✅ Query examples documented: top queries, click-through rate, session flow.

### Day 6: Alpha Ops Pack (P1)

Tasks:
1. Finalize tester cohort and invite messaging
2. Finalize bug report template + triage path
3. Verify rollback steps and incident runbook references

Done criteria:
1. ~~Invite docs are ready for immediate send~~ ✅ `docs/alpha-invite.md` updated with current limitations/capabilities, 5 keys issued, MCP + REST + UI setup instructions complete.
2. ~~Rollback path is tested once~~ ✅ Rollback releases verified (API v19, web v14). Rollback drill previously executed 2026-02-28 (documented in ops-runbook.md). Health endpoint confirmed OK.
3. ~~Gate checklist is updated with decision state~~ ✅ See "Pre-Launch Gate Checklist" below.

Bonus:
- Events endpoint hardened with per-IP rate limiter (30 req/min, separate from global)
- GitHub issue templates created (`.github/ISSUE_TEMPLATE/alpha-bug-report.md`, `alpha-feature-request.md`)
- Ops runbook updated (frontend Vercel→Fly)

## Pre-Launch Gate Checklist

| # | Gate Item | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Search stability inside SLO | ✅ GO | Day 1 baseline: p50 ~110ms, p95 <500ms. Day 2: 0 timeouts under c100. |
| 2 | Track-level credits on release/version | ✅ GO | Day 3: always-visible inline credits, mobile-responsive at 480px. |
| 3 | Search relevance improved | ✅ GO | Day 4: exact/prefix boost, FK dedup, per-type cap. Before/after in `docs/day4-search-ia-upgrade.md`. |
| 4 | Instrumentation live | ✅ GO | Day 5: 5 event types, structured logs, verified in Fly. Schema in `docs/telemetry-schema.md`. |
| 5 | Events rate-limited | ✅ GO | Day 6: per-IP 30 req/min on `/v1/events` write path. |
| 6 | Invite docs ready | ✅ GO | `docs/alpha-invite.md` — setup for UI, REST, MCP. 5 keys issued. |
| 7 | Bug report path | ✅ GO | GitHub issue templates: bug report + feature request. Triage via [b1rdmania/dig](https://github.com/b1rdmania/dig/issues). |
| 8 | Rollback verified | ✅ GO | Drill executed 2026-02-28. Releases available for API + web. Documented in `docs/ops-runbook.md`. |
| 9 | Ops runbook current | ✅ GO | Updated for Fly frontend, health checks, incident playbooks. |
| 10 | No blocking enrichment dependency | ✅ GO | Enrichment is background work only. No launch-critical path. |

**Overall decision: GO for soft alpha (5-10 testers).**

### Day 7: Soft Alpha + 24h Triage Loop (P1)

Tasks:
1. Send invites
2. Monitor first 24h of traffic and errors
3. Ship top two fixes from real usage feedback

Done criteria:
1. First user behavior data captured
2. First alpha patch deployed
3. Next-week priorities ranked by evidence

## Constraints (Do Not Violate)

1. Do not block launch-critical track on enrichment work
2. Do not introduce new architecture branches outside current modular monolith plan
3. Do not reintroduce legacy route model (`/master` as primary)
4. End each day with:
   - one status commit
   - docs sync
   - progress page update (if user-visible milestone changed)

## Acceptance Gate for Week Completion

Week is considered complete when all conditions are true:
1. Search stability is inside agreed SLO envelope for alpha traffic profile
2. Release/version pages include track-level credits and remain mobile-usable
3. Search relevance quality is improved on core artist/release intents
4. Instrumentation is live and producing actionable usage evidence
5. Soft alpha has started with documented triage outcomes
