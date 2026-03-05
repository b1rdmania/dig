# Current Agent Handoff (Execution-Only)

Last updated: 2026-03-01

This file is the single execution brief for the next agent. It removes historical planning noise and defines only active work.

## 1) Ground Truth and Scope

### Ground truth docs (read first, in order)

1. `docs/implementation-plan-agent-first.md` (strategy + gates)
2. `docs/phase4-prerequisites.md` (current step state — Steps 0-8 complete)
3. `docs/phase2-search-benchmark-results.md` (Run 8 baseline + SLO policy)
4. `docs/enrichment-implementation-plan.md` (Phase 4A roadmap)
5. `docs/enrichment-migration-spec-en-a.md` (already-applied EN-A schema design)
6. `docs/ops-runbook.md` (includes pg_prewarm warmup procedure)
7. `docs/alpha-invite.md` (alpha invite brief + issued keys)
8. `docs/post-fix-validation-suite.md` (mandatory post-fix API/search/dead-page validation)
9. `docs/batch-resolution-metadata-design.md` (planned replacement for planner-coercion batch lookup)

### What is already done

- Phase 3 complete (API + MCP on Fly, docs pass, smoke tests, rate limiting)
- Full release/track corpus restored on Fly Postgres (~555M rows, 12 tables)
- Run 8 benchmark complete (0/96 errors, warm SLOs pass)
- EN-A migration applied (`enrich.*` schema live, 8 tables)
- **A1: `apps/web` Next.js scaffold** — search + release pages, CSS Modules, deployed to Vercel (`web-eight-navy-21.vercel.app`). Domain `app.dig.baby` pending DNS CNAME.
- **A2: pg_prewarm** — 8 indexes warmed (325k blocks, ~2.5GB), runbook documented, warm queries all <200ms
- **A3: Alpha invite** — `docs/alpha-invite.md` updated with full corpus, web UI, cold-start caveats, 5 keys issued

### What is not done

- DNS CNAME for `app.dig.baby` → `cname.vercel-dns.com` (user action)
- Artist/label/master detail pages in web UI (only release detail exists)
- Cover Art Archive integration
- EN-B/EN-C/EN-D enrichment ingestion
- Gate E review (all A-track items are green — gate can be opened)

## 2) Do Not Do

- Do not re-open Phase 0/1/2 architecture decisions.
- Do not add new product scope (marketplace, social features, inference-heavy paths).
- Do not modify canonical `catalog.*` fields with enrichment data.
- Do not change the web UI's server-side API key pattern (keys stay server-side).

## 3) Active Workstreams

### A. Core Launch Track — COMPLETE

All A-track items (A1, A2, A3) are done. Gate E review can proceed.

### B. Enrichment Track (background)

#### B1. EN-B prep only (no full ingest yet)

Deliverables:
- MusicBrainz source manifest validated
- Crosswalk matching implementation scaffolded (deterministic policy only)
- Sample ingest (small batch), precision sampling script

Acceptance:
- Precision sampling method runnable
- No canonical overwrite risk in code path

#### B2. Contract extension draft

Deliverables:
- API/MCP contract draft for `include_enrichment`, `min_confidence`, `sources`
- Test stubs for additive response blocks

Acceptance:
- Draft aligns with `docs/phase2-response-contracts.md` style and error taxonomy

### C. Web UI Enhancement (post-Gate E)

#### C1. Artist/label/master detail pages

- `/artist/[id]`, `/label/[id]`, `/master/[id]` pages
- Link from search results to detail pages (currently only releases link)
- Reuse existing design system components

#### C2. Cover Art Archive integration

- `https://coverartarchive.org/release/{mbid}/front` URL passthrough
- Requires Discogs → MusicBrainz ID mapping (crosswalk from EN-B)
- Fallback: placeholder images based on genre/format

## 4) Exact Execution Sequence

1. Confirm repo clean and synced with latest `main`.
2. Open Gate E review (A1/A2/A3 all green).
3. Start B1/B2 enrichment prep while alpha feedback arrives.
4. Start C1/C2 web UI enhancements when enrichment crosswalks are available.

## 5) Update Rules (required on every push)

On each meaningful milestone, update all three:

1. `docs/phase4-prerequisites.md` (step checkbox + short execution log entry)
2. `progress.html` (public-facing progress state)
3. `CLAUDE.md` (session memory / infra state drift)

If one changes and others do not, work is considered incomplete.

## 6) Minimal Commit Cadence

- One commit per completed sub-step
- Commit message prefix:
  - `phase4:` for core launch track
  - `phase4a:` for enrichment track

## 7) Key URLs

| Service | URL |
|---------|-----|
| API | https://dig-api.fly.dev/v1/ |
| MCP | https://dig-mcp.fly.dev/sse |
| Health | https://dig-api.fly.dev/v1/health |
| Frontend | https://app.dig.baby (pending DNS) / https://web-eight-navy-21.vercel.app |
| Marketing | https://dig.baby |
| GitHub | https://github.com/b1rdmania/dig |

## 8) Recent Runtime Gotcha (Do Not Repeat)

- API startup failure occurred when `apps/api` imported `sql` from `kysely` directly.
- Fix: import `sql` from `@dig/db` in app code.
- Rule: keep `kysely` usage behind `@dig/db` exports for app packages.
