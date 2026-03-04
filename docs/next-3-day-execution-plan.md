# Next 3-Day Execution Plan (Data Completeness + UX Performance)

## Goal
Stabilize core product quality before further enrichment scope:
1. Close artist ingest completeness gap
2. Remove visible page-load pain on release/version pages
3. Resume enrichment with hard evidence gates

---

## Day 1 — Artist Ingest Hard Closeout

### Scope
- Finish/verify full artist transform
- Run `ANALYZE` on artist tables
- Validate completeness and reference resolution
- Update gate docs with evidence

### Checklist
- [ ] Transform process completes without fatal errors
- [ ] Run `ANALYZE` on:
  - `catalog.artists`
  - `catalog.artist_aliases`
  - `catalog.artist_groups`
  - `catalog.artist_members`
  - `catalog.artist_name_variations`
  - `catalog.artist_urls`
- [ ] Verify counts:
  - `catalog.artists` in expected full-dump range (multi-million, near target)
  - Child-table counts are non-trivial and consistent with ingest behavior
- [ ] Verify max artist ID materially above prior partial ceiling
- [ ] Spot-check unresolved refs on 20 real pages (labels/artists/releases)
- [ ] Confirm fallback labels like `Artist 6481253` drop materially
- [ ] Update:
  - `docs/artist-ingest-gap.md`
  - relevant gate/caveat docs

### Day 1 Gate (GO / NO-GO)
GO if all are true:
- `catalog.artists` no longer partial (clear step-change from 289k)
- Query planner stats refreshed (`ANALYZE` done)
- Spot-check shows major reduction in unresolved artist references
- Evidence committed in docs

NO-GO if any are true:
- Count still near partial baseline
- Transform failed with unresolved data-integrity issues
- Unresolved refs unchanged in spot-check sample

---

## Day 2 — Release/Version Page Performance + Streaming UX

### Scope
- Reduce server-side wait on detail pages
- Add progressive render behavior (Suspense/streaming boundaries)
- Keep response contracts unchanged

### Checklist
- [ ] Profile current detail fetch chain (`master -> version -> cover`)
- [ ] Remove avoidable serial fetches; parallelize where safe
- [ ] Add cache policy for stable sub-requests
- [ ] Add Suspense boundaries for:
  - hero shell
  - tracklist/credits
  - media/linkout blocks
- [ ] Ensure user sees content progressively instead of blank wait
- [ ] Verify no regression in:
  - route correctness (`/release`, `/version`, `/artist`)
  - error handling paths

### Day 2 Gate (GO / NO-GO)
GO if all are true:
- Measurable improvement in perceived load (first meaningful UI rendered early)
- No route regressions
- No increase in 5xx/timeout error rate during smoke tests

NO-GO if any are true:
- Streaming introduces unstable/blank states
- Cache changes cause stale or incorrect page content
- Route behavior regresses

---

## Day 3 — Enrichment Resume With Proof

### Scope
- Complete high-priority enrichment backlog with evidence-first closeout:
  - Wikidata context status (if zero in active env, fix first)
  - Label crosswalk completion/verification
  - Label linkout verification pass (53k records)

### Checklist
- [ ] Confirm current `enrich.entity_context` state in active env and reconcile docs
- [ ] Run/finish context import as needed
- [ ] Complete label crosswalk ingest/verification
- [ ] Run deterministic verification pass for linkouts:
  - dead URL checks
  - provider-domain consistency
  - handle sanity checks
- [ ] Execute idempotency rerun checks on modified enrichment jobs
- [ ] Publish closeout evidence doc with counts + precision sample

### Day 3 Gate (GO / NO-GO)
GO if all are true:
- Enrichment counts and docs are consistent with active environment
- Idempotency confirmed on reruns
- Linkout verification outcomes logged with clear status categories

NO-GO if any are true:
- Docs disagree with active DB state
- Reruns inflate counts unexpectedly
- Verification process lacks auditable evidence

---

## Cross-Day Operating Rules
- No new product scope until Day 1 and Day 2 gates are green
- Do not overwrite canonical `catalog.*` fields from enrichment sources
- Every closeout must include:
  - command(s) run
  - before/after counts
  - spot-check sample method
  - commit hash reference

## Final Exit Criteria (End of Day 3)
- Artist completeness gap closed and documented
- Release/version page experience materially improved for real users
- Enrichment backlog resumed with auditable, idempotent evidence
