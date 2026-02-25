# Phase 1 QA Gate Spec

Numeric pass/fail criteria for the Phase 1 import pipeline. These thresholds must be met before promoting a batch to "active" and proceeding to Phase 2.

## Entity Count Thresholds

Minimum acceptable counts after a full import run (Feb 2026 dump baseline):

| Entity | Minimum | Expected | Source |
|--------|---------|----------|--------|
| Artists | 9,500,000 | 9,917,545 | Must be >95% of profiled count |
| Labels | 2,200,000 | 2,339,067 | |
| Masters | 2,400,000 | 2,520,704 | |
| Releases | 17,000,000 | ~18,000,000 | |
| Tracks | 100,000,000 | ~120,000,000 | ~6.5 per release |
| Release Credits | 50,000,000 | ~70,000,000 | |
| Release Identifiers | 40,000,000 | ~57,000,000 | |
| Release Companies | 40,000,000 | ~60,000,000 | |

**Threshold**: actual count must be >= minimum. If below, investigate before promoting.

## Field Completeness Thresholds

Percentage of entities with non-null/non-empty required fields:

| Entity.Field | Min Rate | Profiled Rate |
|-------------|----------|---------------|
| artists.name | 99.99% | 100.00% |
| artists.discogs_id | 100% | 100% |
| labels.name | 99.99% | 100.00% |
| labels.discogs_id | 100% | 100% |
| masters.title | 100% | 100% |
| masters.main_release | 99.9% | 100% |
| masters.year | 99% | 100% (but may include 0) |
| releases.title | 100% | 100% |
| releases.discogs_id | 100% | 100% |
| releases.data_quality | 100% | 100% |
| releases.country | 98% | 99.55% |
| releases.released_raw | 95% | 97.71% |
| releases.genres (at least 1) | 99% | 100% |
| tracks.title | 95% | TBD (profiler didn't track nested text) |
| tracks.position_raw | 90% | TBD |

## Malformed Data Thresholds

Maximum acceptable rate of malformed/unparseable data:

| Check | Max Rate | Notes |
|-------|----------|-------|
| Unparseable release dates | 2% | Dates that don't match any known pattern |
| Unparseable track positions | 5% | Positions that can't be parsed into disc/track/side |
| Unparseable track durations | 10% | Many tracks legitimately have no duration |
| Invalid discogs_id (non-integer) | 0% | Must be 0 failures |
| Duplicate discogs_id within entity type | 0% | Must be 0 duplicates per batch |

## Orphan Reference Thresholds

References that point to entities not in the current batch:

| Reference | Max Orphan Rate | Notes |
|-----------|----------------|-------|
| release.master_id → masters | 5% | Some releases reference masters not in the dump |
| release_labels.label_id → labels | 5% | |
| release_credits.artist_id → artists | 10% | Credits may reference artists not in the dump |
| master_artists.artist_id → artists | 5% | |
| artist_aliases.alias_id → artists | 10% | Some alias references are broken |

Orphan references are logged but not blocking — store the reference, mark as unresolved.

## Performance Thresholds

| Metric | Target | Hard Limit |
|--------|--------|------------|
| Full import time | < 8 hours | < 24 hours |
| Parser memory usage | < 512 MB | < 1 GB |
| Canonical upsert throughput | > 5,000 entities/sec | > 1,000 entities/sec |

## FTS Performance Thresholds

Post-import search query performance on full dataset:

| Query Type | p50 | p95 | p99 |
|------------|-----|-----|-----|
| Single-term search | < 50ms | < 200ms | < 500ms |
| Multi-term search | < 100ms | < 300ms | < 1000ms |
| Fuzzy (pg_trgm) search | < 100ms | < 500ms | < 2000ms |
| Filtered search (+ genre/year) | < 100ms | < 300ms | < 1000ms |

## QA Report Format

Each import run generates a JSON report:

```json
{
  "batch_id": "uuid",
  "dump_date": "2026-02-01",
  "started_at": "ISO timestamp",
  "completed_at": "ISO timestamp",
  "duration_seconds": 12345,
  "entity_counts": {
    "artists": 9917545,
    "labels": 2339067,
    "masters": 2520704,
    "releases": 18000000,
    "tracks": 120000000,
    "release_credits": 70000000
  },
  "field_completeness": {
    "artists.name": 0.9999,
    "releases.country": 0.9955
  },
  "malformed_rates": {
    "unparseable_dates": 0.005,
    "unparseable_positions": 0.02
  },
  "orphan_rates": {
    "release_master_id": 0.03
  },
  "thresholds_passed": true,
  "failures": []
}
```

## Gate Decision

**PASS**: All thresholds met → promote batch to active.
**FAIL**: Any threshold violated → log failures, do not promote, investigate.

The previous active batch remains in place during investigation. No data loss on failure.
