# Dataset Sizing Report

Based on full profiling of Discogs February 2026 dump.

## Entity Counts

| Entity | Actual Count | Plan Estimate | Delta |
|--------|-------------|---------------|-------|
| Artists | 9,917,545 | ~8M | +24% |
| Labels | 2,339,067 | ~2M | +17% |
| Masters | 2,520,704 | ~1.5M | +68% |
| Releases | ~18M (extrapolated from 500k sample) | ~18M | ≈ match |

Masters count is significantly higher than planned estimate. All others are in the expected range.

## Raw Payload Sizing (ingest.raw_entities)

| Entity | Avg JSON Size | Total Payload |
|--------|--------------|---------------|
| Artists | 155 bytes | 1.5 GB |
| Labels | 147 bytes | 328 MB |
| Masters | 1,084 bytes | 2.6 GB |
| Releases | 2,895 bytes | ~50 GB |
| **Total** | — | **~55 GB** |

Note: These are JSON-serialized sizes from the profiler. Actual JSONB storage in Postgres with TOAST compression will be smaller (typically 2–4x compression on text-heavy JSON).

**Estimated raw_entities table size**: ~20–30 GB after TOAST compression.

## Canonical Table Sizing Estimates

Based on field presence rates from profiling:

| Table | Est. Rows | Est. Size | Notes |
|-------|-----------|-----------|-------|
| `catalog.artists` | 9.9M | 2 GB | Simple columns |
| `catalog.artist_name_variations` | ~4.8M | 400 MB | 48% of artists have NVs |
| `catalog.artist_aliases` | ~4.9M | 400 MB | 49% of artists have aliases |
| `catalog.artist_groups` | ~2.3M | 200 MB | |
| `catalog.artist_members` | ~2.3M | 200 MB | |
| `catalog.artist_urls` | ~2.1M | 200 MB | |
| `catalog.labels` | 2.3M | 500 MB | Includes profile text |
| `catalog.label_urls` | ~382K | 30 MB | |
| `catalog.masters` | 2.5M | 500 MB | |
| `catalog.master_artists` | ~3.1M | 250 MB | |
| `catalog.master_genres` | ~3.3M | 150 MB | |
| `catalog.master_styles` | ~3.9M | 200 MB | |
| `catalog.master_videos` | ~6.1M | 1 GB | URLs + titles |
| `catalog.releases` | ~18M | 10 GB | Largest entity, many text columns |
| `catalog.release_artists` | ~20M | 2 GB | ~1.1 per release |
| `catalog.release_credits` | ~70M | 5 GB | ~3.9 per release (73.8% have extraartists) |
| `catalog.release_labels` | ~22M | 1.5 GB | ~1.2 per release |
| `catalog.release_formats` | ~18M | 1 GB | ~1 per release |
| `catalog.release_format_descriptions` | ~30M | 1.5 GB | Multiple per format |
| `catalog.tracks` | ~120M | 8 GB | ~6.5 per release |
| `catalog.track_credits` | ~50M+ | 3 GB | Track-level extraartists |
| `catalog.release_identifiers` | ~57M | 4 GB | ~3.2 per release |
| `catalog.release_companies` | ~60M | 4 GB | ~3.4 per release |
| `catalog.release_videos` | ~39M | 3 GB | ~2.2 per release (61% have videos) |
| `catalog.genres` (lookup) | ~20 | <1 MB | Shared enum-like |
| `catalog.styles` (lookup) | ~500 | <1 MB | Shared enum-like |

**Estimated canonical tables total**: ~50 GB (data only)

## Index Sizing

| Index Type | Est. Size | Notes |
|------------|-----------|-------|
| Primary keys | ~5 GB | UUID or serial on all tables |
| Foreign keys | ~10 GB | discogs_id lookups across join tables |
| FTS tsvector (releases) | ~5 GB | title + notes |
| FTS tsvector (artists) | ~2 GB | name + profile |
| pg_trgm (releases) | ~3 GB | Fuzzy search on title |
| pg_trgm (artists) | ~2 GB | Fuzzy search on name |
| Other indexes | ~3 GB | Genre/style/country/year filters |

**Estimated indexes total**: ~30 GB

## Total Database Size Estimate

| Component | Size |
|-----------|------|
| Raw payloads (ingest.raw_entities) | 20–30 GB |
| Canonical tables (catalog.*) | ~50 GB |
| Indexes | ~30 GB |
| WAL / overhead | ~10 GB |
| **Total** | **110–120 GB** |

This is well within the 200–400 GB planning estimate from the implementation plan. A 256 GB Postgres instance provides comfortable headroom.

## Memory Requirements

Profiler ran at 124–155 MB RSS across all entity types, confirming the SAX streaming approach is memory-bounded. The import pipeline should operate with <512 MB per worker.

## Profiling Durations

| Entity | Duration | Entities/sec |
|--------|----------|-------------|
| Labels | 24.7s | 94,700/s |
| Artists | 118.0s | 84,050/s |
| Masters | 115.6s | 21,800/s |
| Releases (500k) | 93.2s | 5,365/s |

Releases are significantly slower due to deeper nesting and larger entity size. Full release import at this rate: ~56 minutes for parsing alone (not including DB writes). With batched DB inserts, estimate **4–8 hours** for full release import, well under the 24-hour target.

## Key Findings

1. **No images in dumps** — confirmed across 500k releases
2. **series** field on releases (6.6% presence) — not in original plan, should defer to v2
3. **status** attribute on releases — important for filtering (Accepted vs Draft vs Deleted)
4. **Master count** 68% higher than estimated — plan accordingly for master_videos (6.1M)
5. **Almost all releases have a master_id** — 100% in sample, good for master↔release linkage
6. **Name variations** are surprisingly common (48% of artists) — must be FTS-indexed
7. **Track credit roles are multi-valued** — "Producer, Recorded By" needs comma splitting
