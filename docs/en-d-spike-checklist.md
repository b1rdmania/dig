# EN-D Spike Checklist (Setlist Timeline)

## Objective
Validate whether Setlist.fm timeline enrichment should move from spike to production integration, without expanding scope prematurely.

## Scope (Spike Only)
- One ingestion spike over a fixed 1,000-artist cohort.
- Use existing `enrich.artist_crosswalks` MBID mappings.
- Store timeline data in a bounded spike path (`enrich.performance_events` or documented temporary table).
- Expose one read path for evaluation only.
- No GA rollout, no full-corpus backfill in this phase.

## Non-goals
- Full history import for all mapped artists.
- UI polishing beyond minimal validation rendering.
- New recommendation/ranking logic.
- Any overwrite of canonical `catalog.*` fields.

## Preconditions
- [ ] EN-C is closed GO.
- [ ] `SETLISTFM_API_KEY` available and stored as secret in API runtime.
- [ ] Setlist.fm terms reviewed and attribution language approved.
- [ ] Feature flag created: `ENRICH_SETLIST_ENABLED`.

## Workstream A: Compliance + Configuration
1. [ ] Record Setlist.fm rate limits and usage constraints in docs.
2. [ ] Add attribution text for API/UI surfaces that expose setlist data.
3. [ ] Add kill switch config and verify runtime disable behavior.
4. [ ] Add structured source metadata requirements:
   - `source = "setlistfm"`
   - `source_id` (setlist ID)
   - `fetched_at`
   - `match_method`
   - `confidence`

## Workstream B: Cohort + Ingest Spike
1. [ ] Build deterministic 1,000-artist cohort query:
   - MBID present
   - split by high/medium/low Discogs activity bands
2. [ ] Implement ingest job (batch + retry + backoff + checkpoint).
3. [ ] Upsert into spike table with idempotent key strategy.
4. [ ] Track ingest batch in `enrich.ingest_batches`.
5. [ ] Re-run ingest on same cohort and prove zero row inflation.

## Workstream C: Read Path + Contracts
1. [ ] Add one API read path for timeline (behind feature flag):
   - `GET /v1/artists/:discogs_id/timeline?include_enrichment=true`
2. [ ] Preserve response provenance per item.
3. [ ] Add MCP parity check for timeline access.
4. [ ] Keep contracts additive and backward compatible.

## Workstream D: Measurement (Decision Data)
### Coverage
- [ ] `% cohort artists with >=1 setlist event`
- [ ] `avg events per covered artist`
- [ ] date-range completeness
- [ ] venue/city/country field fill rates

### Performance
- [ ] ingest throughput (artists/min, events/min)
- [ ] timeline endpoint p50/p95 (warm)
- [ ] timeline endpoint error/timeout rate

### Data Quality
- [ ] precision sample (minimum 50 artists)
- [ ] provenance completeness = 100%
- [ ] duplicate rate after upsert

## EN-D Gate Criteria
### GO
- coverage: >=35% of cohort has >=1 event
- timeline p95 warm: <250ms
- ingest exhausted-error rate: <1%
- provenance completeness: 100%
- no terms/compliance blockers

### GO WITH CAVEATS
- coverage between 20-35% but quality/perf pass and clear expansion plan

### NO-GO
- coverage <20%, or p95 fails materially, or legal/terms blocker unresolved

## Deliverables
- [ ] `docs/en-d-spike-results.md` (coverage, latency, quality, verdict)
- [ ] API/MCP contract notes updated
- [ ] alpha docs updated with enrichment semantics and caveats
- [ ] gate decision recorded in implementation plan

## Execution Order (Minimal-Risk)
1. compliance + key + flag
2. cohort query locked
3. ingest spike run
4. idempotency re-run
5. read path validation
6. measurement + gate decision
