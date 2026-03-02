# Media Embeds Audit (M1)

Date: 2026-03-02  
Source: Fly Postgres (`dig-db`)  
Dataset: full Discogs release video table in `catalog.release_videos`

## Summary

1. Media coverage exists at meaningful scale for version pages.
2. All current `release_videos` links are YouTube URLs.
3. Duplicate YouTube IDs appear low in sampled data.
4. We can ship version-first media now, with release-level aggregation fallback.

## Measured Results

## 1) Releases with at least one video

- Query: `count(distinct release_discogs_id)` from `catalog.release_videos`
- Result: **3,486,764 releases**

Coverage vs total releases (`18,876,362`):
- **18.47%** of releases have at least one linked video

## 2) Average videos per covered release

- Query: `avg(count(*))` grouped by `release_discogs_id`
- Result: **3.13 videos/release** (for releases that have videos)

## 3) YouTube vs non-YouTube split

- Query: `lower(url) like '%youtube.com%' or '%youtu.be%'`
- Result:
  - **YouTube:** `10,910,851`
  - **Non-YouTube:** `0`

Interpretation:
- v1 embed strategy can be YouTube-only with no immediate source fragmentation.

## 4) YouTube ID parse/duplicate sample

Full-table regex parse exceeded remote timeout budget, so we ran a sampled estimate:

- Sample method: `TABLESAMPLE SYSTEM (0.5)`
- Parser: fast split-based extraction (`v=` and `youtu.be/`)
- Result sample:
  - `unparsable`: **0**
  - `parsable`: **55,456**
  - `duplicate_rows`: **57**

Estimated duplicate rate in sample:
- **0.10%** (`57 / 55,456`)

Interpretation:
- Duplicate removal should still be implemented, but it is unlikely to be a dominant UX issue.

## Query Notes / Limitations

1. Two full-scan diagnostics timed out at 10-minute statement timeout:
   - exact full-table duplicate-ID computation
   - exact master-level coverage via version aggregation
2. For product rollout decisions, current measured metrics are sufficient:
   - release-level coverage
   - source split
   - sampled duplicate estimate
3. If exact master-level coverage is needed later, run offline job with longer timeout or precomputed helper table.

## Product Decision from Audit

Ship **version-first** media behavior:
1. `/version/[id]`: show exact-version videos first
2. `/release/[id]`: aggregate from versions and dedupe by YouTube ID
3. Keep fail-soft rendering (media section never blocks page load)

This aligns with `docs/media-embeds-release-version-plan.md`.
