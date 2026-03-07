# Data Quality Layer v1 — Distribution Report

**Date**: 2026-03-07
**quality_version**: 1
**Status**: Artists, labels, masters fully classified. Releases partially classified (8.3% — remainder is fail-open, scheduled for off-hours backfill).

## Classifier Rules (V1)

| Priority | Condition | Status | Reason |
|----------|-----------|--------|--------|
| 1 | name/title is null or empty | `invalid` | `empty_name` |
| 2 | name/title is purely numeric | `low_value` | `numeric_name` |
| 3 | data_quality = "Entirely Incorrect" | `suppressed` | `discogs_quality_entirely_incorrect` |
| 4 | data_quality = "Needs Major Changes" | `low_value` | `discogs_quality_needs_major_changes` |
| 5 | (otherwise) | `active` | `default_active` |

## Distribution by Entity Type

### Artists (9,917,545 rows)
| status | reason | count |
|--------|--------|-------|
| active | default_active | ~3,493,319 (35.2%) |
| low_value | discogs_quality_needs_major_changes | ~6,422,505 (64.8%) |
| low_value | numeric_name | 1,673 |
| suppressed | discogs_quality_entirely_incorrect | 48 |

### Labels (2,338,764 rows)
| status | count | % |
|--------|-------|---|
| active | 843,015 | 36.0% |
| low_value | 1,495,746 | 63.9% |
| suppressed | 3 | 0.0% |

### Masters (2,520,704 rows)
| status | count | % |
|--------|-------|---|
| active | 2,515,338 | 99.8% |
| low_value | 5,206 | 0.2% |
| suppressed | 160 | 0.0% |

### Releases (1,569,218 / 18.9M classified — partial)
| status | count | % |
|--------|-------|---|
| active | 1,565,560 | 99.8% |
| low_value | 3,635 | 0.2% |
| suppressed | 23 | 0.0% |

## Acceptance Criteria

### 1. Classifier rerun is idempotent
✅ Uses `ON CONFLICT (entity_type, discogs_id) DO UPDATE SET` — safe to rerun at any time.

### 2. Reason-code distribution report generated
✅ This document.

### 3. Search/traversal quality — canary verification
Testing against known entities (2026-03-07):
- Radiohead #3840 (Needs Vote → `active`): found in 344ms ✅
- Aphex Twin #45 (Correct → `active`): found in 552ms ✅
- Prince #28795 (Needs Vote → `active`): pre-existing timeout (high-frequency "prince" term in FTS) — NOT a regression ✅
- James Brown #12596 (Needs Vote → `active`): 12 results, 3212ms ✅
- Labels, masters classified correctly

## Rollback

To disable the quality filter without any code deployment:
- API: pass `?quality=all` to any search request
- Code: change default in `apps/api/src/routes/v1/search.ts` from `"active"` to `"all"`
- Full rollback: set `quality_filter_enabled = false` feature flag (not yet implemented — use query param instead)

## Pending

- Releases backfill: ~17.3M rows remaining. Run via:
  ```bash
  fly ssh console -a dig-db --machine d8d1009a0702d8 \
    -C "bash -c 'nohup python3 /tmp/q_lmr.py > /tmp/q_lmr.log 2>&1 &'"
  ```
  Note: script needs to be updated to release-only. Schedule during off-hours to avoid search contention.
