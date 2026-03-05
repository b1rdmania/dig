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
- [x] Transform process completes without fatal errors — **DONE** (9,917,545 parsed, 0 skipped)
- [x] Run `ANALYZE` on all 6 artist tables — **DONE**
- [x] Verify counts — **DONE**:
  - `catalog.artists`: **10,207,045** (up from 289,500)
  - `catalog.artist_aliases`: 5,263,371
  - `catalog.artist_name_variations`: 5,543,424
  - `catalog.artist_groups`: 2,532,887
  - `catalog.artist_members`: 2,580,904
  - `catalog.artist_urls`: 2,372,842
- [x] Verify max artist ID: **17,254,783** (up from 399,622)
- [x] Spot-check unresolved refs:
  - James Brown (12596): all refs resolved, related artists show real names
  - James Brown & The Famous Flames (386724): 16+ members resolved
  - Artist 6,481,253: previously unresolvable, now loads with 47 members
  - High-ID coverage confirmed up to 17.2M
- [x] Confirm fallback labels dropped: "Artist XXXXXX" no longer appears on checked pages
- [x] Update `docs/artist-ingest-gap.md` — **CLOSED** with full evidence

### Day 1 Gate: **GO**
- [x] `catalog.artists` no longer partial: 10.2M (35x increase from 289k)
- [x] Query planner stats refreshed (`ANALYZE` done on all 6 tables)
- [x] Spot-check confirms major reduction in unresolved artist references
- [x] Evidence committed: `docs/artist-ingest-gap.md` updated, commit `156e931`

---

## Day 2 — Release/Version Page Performance + Streaming UX

### Scope
- Reduce server-side wait on detail pages
- Add progressive render behavior (Suspense/streaming boundaries)
- Keep response contracts unchanged

### Checklist
- [x] Profile current detail fetch chain — **DONE** (fetches already parallelized via Promise.all)
- [x] Remove avoidable serial fetches — **DONE** (no serial fetches found; already optimal)
- [x] Add cache policy for stable sub-requests — **DONE** (already in place: 300s entity, 3600s enrichment/cover)
- [x] Add Suspense boundaries for all 4 entity pages — **DONE**:
  - **Release**: hero sync → tracklist/credits, media, versions stream via 3 Suspense sections
  - **Version**: hero+content sync → cover art streams in separately
  - **Artist**: hero+releases sync → about (bio+profile) + connections (relationships+timeline) stream via 2 Suspense sections
  - **Label**: hero+releases sync → profile+linkouts+external links stream via 1 Suspense section
- [x] New `SectionSkeleton` component with shimmer animation for Suspense fallbacks
- [x] User sees content progressively — hero renders immediately, enrichment streams in
- [x] No regression in route correctness or error handling — typecheck passes, all routes verified
- [x] Benchmark: no TTFB regression (release p50 127ms, version 122ms, artist 141ms — within noise of baseline)

### Day 2 Gate: **GO**
- [x] Suspense streaming implemented on all 4 entity pages
- [x] Hero + primary content renders immediately (no blank wait)
- [x] `pnpm typecheck` passes cleanly
- [x] Deployed to Fly.io — app.dig.baby live
- [x] Benchmark shows no regression (curl TTFB p50 within ±10ms of baseline)
- [x] No 5xx errors in post-deploy checks

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
