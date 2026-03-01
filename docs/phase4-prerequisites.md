# Phase 4 Prerequisites

Phase 4 is the human search UI (Next.js on Vercel). Before starting, these prerequisites must be met.
After Phase 4 baseline, enrichment work is executed via [Enrichment Implementation Plan](enrichment-implementation-plan.md) (Phase 4A / Gate E1).
Execution handoff document: [Current Agent Handoff](current-agent-handoff.md).

## 1. Full Releases Dataset Migration

**Current state:** Fly Postgres has 50k releases (0.3% of full catalog). Full dataset is 18,876,362 releases with 11 child tables.

### Disk estimate

| Table group | Rows | Estimated size |
|------------|------|---------------|
| catalog.releases | 18.9M | ~8GB |
| catalog.release_artists | ~20M | ~3GB |
| catalog.release_labels | ~22M | ~3GB |
| catalog.release_formats | ~19M | ~2.5GB |
| catalog.release_genres | ~20M | ~2.5GB |
| catalog.release_styles | ~37M | ~5GB |
| catalog.release_credits | ~56M | ~8GB |
| catalog.release_identifiers | ~62M | ~9GB |
| catalog.release_companies | ~69M | ~10GB |
| catalog.release_videos | ~58M | ~8GB |
| catalog.tracks | ~106M | ~15GB |
| catalog.track_credits | ~73M | ~10GB |
| **FTS indexes** | — | ~15GB |
| **pg_trgm indexes** | — | ~10GB |
| **Total releases** | — | **~100GB** |

Current non-release data: 9.5GB. **Total with full releases: ~110GB.**

### Fly volume sizing

| Option | Disk | Headroom | Monthly cost |
|--------|------|----------|-------------|
| 150GB | 36% free | Tight — no room for VACUUM/reindex | ~$12/mo |
| 200GB | 45% free | Comfortable | ~$18/mo |
| 250GB | 56% free | Generous — room for growth | ~$22/mo |

**Recommendation:** 200GB. Leaves room for VACUUM overhead and index rebuilds.

### Migration approach

Two options:

**Option A: pg_dump per table (slower, safer)**
```bash
# From local Docker PG, dump each release table
docker exec dig-baby-mvp-postgres-1 pg_dump -Fc -t catalog.releases dig > releases.dump
# Restore via fly proxy
fly proxy 15432:5432 -a dig-db &
pg_restore -h localhost -p 15432 -U postgres -d dig releases.dump
```
Estimated time: 4-8 hours. Can resume if interrupted.

**Option B: COPY pipe (faster, fragile)**
```bash
docker exec dig-baby-mvp-postgres-1 psql -d dig -c "COPY catalog.releases TO STDOUT" | \
  psql "postgresql://postgres:xxx@localhost:15432/dig" -c "COPY catalog.releases FROM STDIN"
```
Estimated time: 2-4 hours. Cannot resume — must restart table on failure.

**Recommendation:** Option A. Disk is cheap, reliability matters.

### Pre-migration checklist

- [ ] Upgrade Fly volume to 200GB: `fly volumes extend <vol-id> --size 200 -a dig-db`
- [ ] Scale Postgres for bulk load: `fly scale vm shared-cpu-4x --memory 2048 -a dig-db`
- [ ] Verify free disk before starting: `fly ssh console -a dig-db -C "df -h"`
- [ ] Run migration table by table, verify row counts
- [ ] Populate FTS search_vectors for new releases
- [ ] Rebuild pg_trgm indexes if needed
- [ ] Scale Postgres back down after migration
- [ ] Run smoke tests

## 2. Full-Corpus Benchmark Rerun

Run 7 was against 50k releases — not representative. Release FTS and filtered search will regress significantly with 18.9M rows.

### Expected regressions

| Category | Run 7 p50 (50k) | Expected p50 (18.9M) | Notes |
|----------|-----------------|---------------------|-------|
| Release FTS | 99ms | 200-500ms | Index scan cost scales with corpus |
| Filtered | 125ms | 500-3,000ms | BitmapAnd on larger heap |
| Multi-entity | 322ms | 500-2,000ms | Release sub-query dominates |
| Fuzzy | 105ms | Same (already full dataset) | Labels/masters unchanged |
| Retrieval | 101ms | Same | Point lookups, no scan |
| Traversal | 101ms | Same | Index lookups |

### Run 8 plan

- Run benchmark from same macOS client against Fly
- Compare with Run 7 (staging) and Run 6 (local full)
- Update SLO targets if needed
- Document in `docs/phase2-search-benchmark-results.md` as Run 8

## 3. Postgres Capacity Plan

### RAM

| Workload | Current (1GB) | Recommended |
|----------|--------------|-------------|
| Full dataset loaded | OK for reads | 2GB minimum |
| Concurrent search + traversal | Marginal | 2-4GB |
| pg_trgm fuzzy under load | Cache eviction | 4GB ideal |

shared_buffers is typically 25% of RAM. At 1GB, that's 256MB — barely enough to cache active indexes for 110GB of data.

**Recommendation:** shared-cpu-4x with 2GB RAM for beta. 4GB for production.

### Cost estimate (Fly.io)

| Tier | VM | RAM | Disk | Monthly |
|------|-----|-----|------|---------|
| Current staging | shared-cpu-2x | 1GB | 40GB | ~$12/mo |
| Beta (full data) | shared-cpu-4x | 2GB | 200GB | ~$48/mo |
| Production | performance-2x | 4GB | 200GB | ~$90/mo |

## 4. Other Prerequisites

### Next.js frontend scaffold
- Create `apps/web/` in the monorepo
- Deploy to Vercel, connect to `dig-api.fly.dev`
- Mobile-first search interface

### Cover Art Archive integration
- Release images sourced from [Cover Art Archive](https://coverartarchive.org/)
- Direct URL passthrough: `https://coverartarchive.org/release/{mbid}/front`
- Requires Discogs→MusicBrainz ID mapping (not in Discogs dump — need CAA API lookup)
- Fallback: placeholder images based on genre/format

### Search warmup on deploy
- `pg_prewarm` for GIN and pg_trgm indexes on Fly machine start
- Eliminates cold-cache spikes after deploys
- Add to Dockerfile or init script

### Multi-filter composite index
- Genre+year queries are slow on cold cache (~3s)
- Composite index on `(batch_id, genre, release_discogs_id)` would fix
- Or materialized view for common filter combinations
- Blocked until full release data is loaded (index on 50k is meaningless)

## 5. Enrichment Prerequisites (Phase 4A)

These items are required before starting MusicBrainz/Wikidata/Setlist ingestion at scale.

### Crosswalk + schema readiness

- [ ] `enrich.*` schema migrations created and tested (crosswalks, edges, context, ingest batches)
- [ ] Deterministic matching policy locked (exact > deterministic fallback > review queue)
- [ ] Confidence thresholds defined and documented

### Source/legal readiness

- [ ] MusicBrainz usage terms reviewed and documented
- [ ] Wikidata usage/attribution requirements documented
- [ ] Setlist.fm usage terms reviewed before bulk ingestion
- [ ] Source kill-switch config prepared (disable source feed without redeploy)

### API/MCP readiness

- [ ] `include_enrichment` + `min_confidence` contract additions implemented
- [ ] Per-edge provenance fields implemented (`source`, `source_id`, `confidence`, `match_method`)
- [ ] Enrichment responses are additive only (no canonical overwrite)

### Quality gate readiness

- [ ] Crosswalk precision sampling method documented
- [ ] Enrichment latency impact benchmark plan documented
- [ ] Review queue workflow defined for low-confidence matches

## 6. Phase 4 Kickoff Checklist

- [x] Full releases migrated to Fly Postgres
- [x] Fly volume at 200GB+ (300GB)
- [x] Fly Postgres at shared-cpu-4x / 2GB RAM (8GB during load)
- [x] Run 8 benchmark completed and documented (0/96 errors, 7/7 warm SLOs pass)
- [x] SLO targets adjusted for full corpus (no changes needed — warm SLOs hold)
- [x] Search warmup script tested (pg_prewarm — 8 indexes, 325k blocks, verified)
- [x] Next.js scaffold created in `apps/web/` (2910b1c)
- [x] Vercel project created and linked (web-eight-navy-21.vercel.app)
- [ ] CAA integration spike (ID mapping feasibility)
- [x] Enrichment prerequisites reviewed and sequenced (Phase 4A plan accepted)

---

## Phase 4 Execution Log

### 2026-03-01 — Operator: Claude Code

**Preflight snapshot:**
- Machine: `d8d1009a0702d8` (shared-cpu-4x, 8GB RAM, iad)
- Disk: 167GB / 295GB (59%)
- 1 critical health check (metrics token — non-blocking)

**Step 0: Data load (COMPLETE)**
- pg_restore of 12 release/track tables finished. ~555M rows, ~14 hours.
- Row counts verified — Fly matches local Docker exactly:
  - releases: 18,876,362 | release_artists: 22,941,980
  - release_credits: 68,279,405 | release_labels: 21,903,042
  - release_formats: 19,332,941 | release_genres: 25,132,711
  - release_styles: 28,476,230 | release_identifiers: 33,122,730
  - release_companies: 33,396,408 | release_videos: 10,910,851
  - tracks: 168,024,918 | track_credits: 85,996,293

**Step 1: ANALYZE** — PASS (all 12 tables, no errors)
**Step 2: search_vector population** — PASS (already populated from source dump: 18,876,362/18,876,362)
**Step 3: Run 8 benchmark** — PASS (0 errors / 96 queries, p50 108ms, 5/7 cold, **7/7 warm**)
  - Warm SLOs all pass. Cold failures are pg_prewarm-solvable.
  - Full results: `docs/phase2-search-benchmark-results.md`
**Step 4: Cleanup dump** — PASS (11GB freed on Fly: 167GB → 156GB. Local dump also deleted.)
**Step 5: Scale down** — PASS (shared-cpu-4x/8GB → shared-cpu-2x/4GB. 3/3 health checks, API green.)
**Step 6: EN-A migration** — PASS (006_enrich_schema.ts applied local + Fly, 8 tables, health green)
**Step 7: Frontend scaffold** — PASS (`apps/web` Next.js 15 scaffold: search + release pages, CSS Modules, server-side API fetch with 10s timeout + runtime guards, build passes. Commit `2910b1c`. Deployed to Vercel: `web-eight-navy-21.vercel.app`, domain `app.dig.baby` pending DNS.)
**Step 7a: pg_prewarm** — PASS (8 indexes warmed, 325k blocks/~2.5GB. All warm queries <200ms except fuzzy label ~3.2s (known). Runbook updated.)
**Step 8: Alpha invite** — PASS (alpha-invite.md updated with web UI, full corpus info, cold-start caveat, 5 keys issued.)
**Step 9: Filtered-query concurrency hardening** — IN PROGRESS (100-concurrent load test exposed `genre+year` filtered release path as bottleneck under contention. Implementing capped fallback + composite year/discogs index migration `007_release_filtered_perf_indexes.ts`; rerun c100 benchmark after migration.)
