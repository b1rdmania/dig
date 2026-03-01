# Current Agent Handoff (Execution-Only)

Last updated: 2026-03-01

This file is the single execution brief for the next agent. It removes historical planning noise and defines only active work.

## 1) Ground Truth and Scope

### Ground truth docs (read first, in order)

1. `docs/implementation-plan-agent-first.md` (strategy + gates)
2. `docs/phase4-prerequisites.md` (current step state)
3. `docs/phase2-search-benchmark-results.md` (Run 8 baseline + SLO policy)
4. `docs/enrichment-implementation-plan.md` (Phase 4A roadmap)
5. `docs/enrichment-migration-spec-en-a.md` (already-applied EN-A schema design)

### What is already done

- Phase 3 complete (`API + MCP on Fly`, docs pass, smoke tests, rate limiting)
- Full release/track corpus restored on Fly Postgres
- Run 8 benchmark complete (`0/96 errors`, warm SLOs pass)
- EN-A migration applied (`enrich.*` schema live)

### What is not done

- Phase 4 step 7: Next.js frontend scaffold in `apps/web`
- Phase 4 step 8: soft alpha invite
- Search warmup (`pg_prewarm`) integration + verification
- EN-B/EN-C/EN-D enrichment ingestion

## 2) Do Not Do

- Do not re-open Phase 0/1/2 architecture decisions.
- Do not add new product scope (marketplace, social features, inference-heavy paths).
- Do not modify canonical `catalog.*` fields with enrichment data.
- Do not start enrichment bulk ingest before core UI path is live (Phase 4 step 7 complete).

## 3) Active Workstreams

## A. Core Launch Track (priority)

### A1. Build `apps/web` Next.js scaffold

Deliverables:
- `apps/web` app in monorepo
- Deployed on Vercel
- Configured against `https://dig-api.fly.dev/v1`

Minimum pages:
- `/` search page (mobile-first)
- `/release/[id]` record page

Required UX behavior:
- Search -> result list -> click through to record page
- Record page sections (hero, tracklist, credits, connections/context placeholder)
- Loading and empty/error states

Acceptance:
- End-to-end flow works on production API, mobile viewport
- No direct DB calls from frontend (API only)

### A2. Search warmup hardening (`pg_prewarm`)

Deliverables:
- Startup/runbook command path for warming release FTS + trgm indexes
- Verification step documented in `docs/ops-runbook.md`

Acceptance:
- Post-deploy cold spikes reduced in first benchmark pass
- Procedure is reproducible by operator without code changes

### A3. Phase 4 step 8 soft alpha invite

Use `docs/alpha-invite.md`.

Deliverables:
- Invite message template finalized
- 5-10 testers selected
- API key issuance process documented and executed

Acceptance:
- At least 5 external testers receive working setup + quickstart

## B. Enrichment Track (background, after A1 starts)

### B1. EN-B prep only (no full ingest yet)

Deliverables:
- MusicBrainz source manifest validated
- Crosswalk matching implementation scaffolded (deterministic policy only)
- Sample ingest (small batch), precision sampling script

Acceptance:
- Precision sampling method runnable
- No canonical overwrite risk in code path

### B2. Contract extension draft

Deliverables:
- API/MCP contract draft for `include_enrichment`, `min_confidence`, `sources`
- Test stubs for additive response blocks

Acceptance:
- Draft aligns with `docs/phase2-response-contracts.md` style and error taxonomy

## 4) Exact Execution Sequence

1. Confirm repo clean and synced with latest `main`.
2. Complete A1 (`apps/web` + deploy).
3. Update `progress.html` and `docs/phase4-prerequisites.md` with A1 status.
4. Complete A2 (`pg_prewarm` ops path + verify once).
5. Complete A3 (soft alpha invite pack + initial users).
6. Start B1/B2 enrichment prep while feedback arrives.
7. Open Gate E review when A1/A2/A3 are all green.

## 5) Update Rules (required on every push)

On each meaningful milestone, update all three:

1. `docs/phase4-prerequisites.md` (step checkbox + short execution log entry)
2. `progress.html` (public-facing progress state)
3. `CLAUDE.md` (session memory / infra state drift)

If one changes and others do not, work is considered incomplete.

## 6) Minimal Commit Cadence

- One commit per completed sub-step (`A1`, `A2`, `A3`, `B1`, `B2`)
- Commit message prefix:
  - `phase4:` for core launch track
  - `phase4a:` for enrichment track

Examples:
- `phase4: scaffold apps/web search and release pages`
- `phase4: add pg_prewarm post-deploy runbook and verification`
- `phase4a: add MB crosswalk sample ingest + precision sampler`
