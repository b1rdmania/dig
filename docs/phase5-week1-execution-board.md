# Phase 5 Week 1 Execution Board

Status: in-progress (Day 1 complete)
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
1. `0` 5xx errors under c100 filtered load
2. Timeout rate below agreed SLO threshold
3. Tests include degraded path assertions

### Day 3: Track-Level Credits UX (P0)

Tasks:
1. Add per-track credit visibility on release/version pages
2. Keep layout scan-friendly and mobile-first
3. Link credited people/entities where IDs are available

Done criteria:
1. Track rows expose performer/engineer/writer-style credits
2. Mobile renders cleanly at 375px width
3. Route behavior remains consistent (`/release`, `/version`)

### Day 4: Search IA Upgrade (P1)

Tasks:
1. Improve ranking behavior for high-volume artist intents (e.g. ambiguous artist names)
2. Keep master-first grouping and reduce duplicate clutter
3. Improve quick context shown in results (type, artist, year signal)

Done criteria:
1. Relevance regression checks pass on benchmark suite
2. Duplicate-heavy queries show materially cleaner results
3. No latency regression beyond agreed SLO envelope

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
1. Events are emitted and observable
2. Event fields are documented in one place
3. Can answer top search/click-through questions from data

### Day 6: Alpha Ops Pack (P1)

Tasks:
1. Finalize tester cohort and invite messaging
2. Finalize bug report template + triage path
3. Verify rollback steps and incident runbook references

Done criteria:
1. Invite docs are ready for immediate send
2. Rollback path is tested once
3. Gate checklist is updated with decision state

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
