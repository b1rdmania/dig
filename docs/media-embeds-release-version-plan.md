# Media Embeds Plan (Release + Version Pages)

Status: planned (ready for spike)  
Owner: core app/API  
Scope: Discogs-linked YouTube media presentation on `/release/[id]` and `/version/[id]`.

## 1) Goal

Add an elegant, low-clutter media experience that:
1. Prefers exact version media on `/version/[id]`
2. Provides canonical media context on `/release/[id]`
3. Makes provenance explicit (`Discogs video link`)
4. Avoids performance regressions on mobile

## 2) Source of Truth

Primary source is `catalog.release_videos` from Discogs dumps.

Current assumption (to verify with audit queries below):
1. Media links are attached to specific `release_discogs_id`
2. Release pages can aggregate across version releases under a master
3. URL quality is mixed (some non-YouTube, dead links, duplicates)

## 3) Data Audit (Step M1)

Run these first and store outputs in `docs/media-embeds-audit.md`.

### 3.1 Coverage by release

```sql
select
  count(distinct release_discogs_id) as releases_with_videos
from catalog.release_videos;
```

### 3.2 Avg videos per release

```sql
select
  round(avg(video_count)::numeric, 2) as avg_videos_per_release
from (
  select release_discogs_id, count(*) as video_count
  from catalog.release_videos
  group by release_discogs_id
) t;
```

### 3.3 YouTube vs non-YouTube split

```sql
select
  case
    when lower(url) like '%youtube.com%' or lower(url) like '%youtu.be%' then 'youtube'
    else 'other'
  end as source_type,
  count(*) as links
from catalog.release_videos
group by 1
order by 2 desc;
```

### 3.4 Duplicate YouTube IDs

```sql
with y as (
  select
    release_discogs_id,
    regexp_replace(
      coalesce(
        nullif(substring(url from 'v=([^&]+)'), ''),
        nullif(substring(url from 'youtu\.be/([^?&/]+)'), '')
      ),
      '[^A-Za-z0-9_-]',
      '',
      'g'
    ) as youtube_id
  from catalog.release_videos
  where lower(url) like '%youtube.com%' or lower(url) like '%youtu.be%'
)
select
  count(*) filter (where youtube_id is null) as unparsable,
  count(*) filter (where youtube_id is not null) as parsable,
  count(*) filter (where youtube_id is not null) - count(distinct youtube_id) as duplicate_rows
from y;
```

### 3.5 Master-level effective coverage (via versions)

```sql
select
  count(distinct r.master_discogs_id) filter (where r.master_discogs_id is not null) as masters_with_any_video
from catalog.releases r
join catalog.release_videos v
  on v.release_discogs_id = r.discogs_id
 and v.batch_id = r.batch_id;
```

## 4) Serving Model (Step M2)

## API contract

Add one endpoint:

`GET /v1/releases/:id/media`

Parameters:
1. `context=version|release` (default: `version`)
2. `limit` (default 12, max 30)

Response shape:

```json
{
  "items": [
    {
      "youtube_id": "dQw4w9WgXcQ",
      "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "title": "Track title",
      "description": "Optional text",
      "duration_seconds": 245,
      "embedable": true,
      "match_level": "exact_version",
      "confidence": 0.92,
      "provenance": {
        "source": "discogs_release_videos",
        "release_discogs_id": 12345
      }
    }
  ],
  "meta": {
    "requested_release_discogs_id": 12345,
    "context": "version",
    "degraded": false,
    "degraded_reason": null,
    "counts": {
      "exact_version": 3,
      "from_release_group": 6,
      "excluded_non_youtube": 2,
      "excluded_duplicates": 4
    }
  }
}
```

## Matching hierarchy

For `/version/[id]`:
1. `exact_version`: videos directly on requested release
2. `from_release_group`: videos from sibling versions under same master

For `/release/[id]`:
1. Aggregate from versions under this master
2. Rank and dedupe before render

## Ranking rules (v1 deterministic)

Score components:
1. `+100` exact version match
2. `+40` title token overlap with release/master title
3. `+20` official/topic signal in title/channel text (if present)
4. `-20` live/clip/teaser signal
5. `-999` duplicate YouTube ID (drop)

## 5) UI Model (Step M3)

## `/release/[id]` (canonical page)

Section: `Media`
1. Show top 3 embeds inline
2. Show remaining as link list behind `Show more`
3. Label items as `From release versions`

## `/version/[id]` (specific pressing)

Section order:
1. `This Version` (exact media)
2. `Related from Release` (collapsed by default)

Rules:
1. No autoplay
2. Lazy iframe load on click (thumbnail shell first)
3. If no media: show concise empty state + external Discogs link

## 6) Performance/Safety Constraints

1. Default max rendered embeds per page load: `3`
2. Endpoint timeout should respect existing search/read timeout guardrails
3. Cache media response for 1h (safe since dump-backed)
4. Never block page render on media failure (fail-soft section)

## 7) Implementation Steps

1. M1 audit SQL + write `docs/media-embeds-audit.md`
2. M2 add domain service `getReleaseMedia()`
3. M2 add API route `GET /v1/releases/:id/media`
4. M2 unit tests for parsing/dedupe/ranking
5. M3 add `MediaSection` component for release/version pages
6. M3 add click telemetry (`media_play_clicked`, `media_show_more_clicked`)
7. Load test API path (small burst + sustained)
8. Update `progress.html` + execution board

## 8) Test Pack (Step M4)

Create 4 deterministic fixtures from production IDs:
1. Version with multiple YouTube links
2. Version with no video links
3. Release with strong sibling-version media
4. Release with duplicate/noisy links

Validation checks:
1. Exact-version media appears ahead of related media
2. Duplicate YouTube IDs are removed
3. Non-YouTube links are listed as external links only
4. Page still renders if media endpoint errors

## 9) Launch Gate (Media v1)

GO when all are true:
1. API contract stable and documented
2. No page-level regressions on `/release` or `/version`
3. Mobile render passes at 375px
4. p95 media endpoint latency inside agreed alpha budget
5. Provenance labels visible in UI
