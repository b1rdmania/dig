# Normalization Dictionary v1

Field-level mapping from Discogs XML dump structure to canonical database tables. Guides Phase 1 importer implementation.

> **Principle**: Preserve everything raw in `ingest.raw_entities`, normalize into canonical tables in layers. Never discard data during normalization.

## 1. Artists

### Source: `discogs_*_artists.xml.gz`

Root element: `<artist>` (no attributes — `id` is a child element)

| XML Path | Canonical Table | Column | Type | Nullable | Transform | Notes |
|----------|----------------|--------|------|----------|-----------|-------|
| `artist/id` | `catalog.artists` | `discogs_id` | integer | no | parse int | PK lookup key |
| `artist/name` | `catalog.artists` | `name` | text | no | trim | Canonical name |
| `artist/realname` | `catalog.artists` | `real_name` | text | yes | trim | |
| `artist/profile` | `catalog.artists` | `profile` | text | yes | trim | Contains Discogs markup `[a=...]` `[l=...]` |
| `artist/data_quality` | `catalog.artists` | `data_quality` | text | no | trim | Enum-like: Needs Vote, Correct, Complete, etc. |
| `artist/urls/url` | `catalog.artist_urls` | `url` | text | no | trim | Multiple per artist |
| `artist/namevariations/name` | `catalog.artist_name_variations` | `name` | text | no | trim | Multiple per artist |
| `artist/aliases/name` | `catalog.artist_aliases` | `alias_name` | text | no | trim | Also has `id` attr → FK |
| `artist/aliases/name/@id` | `catalog.artist_aliases` | `alias_discogs_id` | integer | yes | parse int | Points to another artist |
| `artist/groups/name` | `catalog.artist_groups` | `group_name` | text | no | trim | Also has `id` attr → FK |
| `artist/groups/name/@id` | `catalog.artist_groups` | `group_discogs_id` | integer | yes | parse int | |
| `artist/members/name` | `catalog.artist_members` | `member_name` | text | no | trim | Inverse of groups |
| `artist/members/name/@id` | `catalog.artist_members` | `member_discogs_id` | integer | yes | parse int | |
| `artist/images/image` | — | — | — | — | skip v1 | Not present in dumps |

### Edge cases
- **ANV**: Name variations are separate from aliases. An alias is a different artist identity; a name variation is a spelling/formatting variant of the same artist.
- **Self-referencing**: An artist can appear in both `groups` and `members` (e.g., a person who is both a solo artist and band member).
- **Missing real_name**: Common for bands/groups and anonymous artists.
- **Markup in profile**: `[a=Artist Name]`, `[l=Label Name]`, `[r=Release ID]` are Discogs-specific markup. Store as-is, parse for linking in Phase 2+.

## 2. Labels

### Source: `discogs_*_labels.xml.gz`

Root element: `<label>` (no attributes — `id` is a child element)

| XML Path | Canonical Table | Column | Type | Nullable | Transform | Notes |
|----------|----------------|--------|------|----------|-----------|-------|
| `label/id` | `catalog.labels` | `discogs_id` | integer | no | parse int | |
| `label/name` | `catalog.labels` | `name` | text | no | trim | 1 missing in 2.34M — handle gracefully |
| `label/profile` | `catalog.labels` | `profile` | text | yes | trim | 31.8% presence |
| `label/contactinfo` | `catalog.labels` | `contact_info` | text | yes | trim | 6.9% presence, free text |
| `label/data_quality` | `catalog.labels` | `data_quality` | text | no | trim | |
| `label/parentLabel` | `catalog.labels` | `parent_label_discogs_id` | integer | yes | parse int from `@id` attr | 11% have parent |
| `label/parentLabel/@id` | (same) | (same) | — | — | | |
| `label/sublabels/label` | — | — | — | — | derived | Inverse of parentLabel — don't store separately |
| `label/urls/url` | `catalog.label_urls` | `url` | text | no | trim | 8.6% have URLs |
| `label/images/image` | — | — | — | — | skip v1 | |

### Edge cases
- **1 label with missing name**: Handle as empty string or skip.
- **sublabels**: Don't need a separate table — derive from `parent_label_discogs_id` FK. The sublabels list in the dump is redundant.
- **contactinfo**: Free-form, often multi-line. Low retrieval value for v1 but preserve raw.

## 3. Masters

### Source: `discogs_*_masters.xml.gz`

Root element: `<master>` (has `id` attribute)

| XML Path | Canonical Table | Column | Type | Nullable | Transform | Notes |
|----------|----------------|--------|------|----------|-----------|-------|
| `master/@id` | `catalog.masters` | `discogs_id` | integer | no | parse int | Top-level attr |
| `master/title` | `catalog.masters` | `title` | text | no | trim | |
| `master/main_release` | `catalog.masters` | `main_release_discogs_id` | integer | yes | parse int | FK → releases |
| `master/year` | `catalog.masters` | `year` | integer | yes | parse int, null if 0 | 0 = unknown |
| `master/data_quality` | `catalog.masters` | `data_quality` | text | no | trim | |
| `master/artists/artist/id` | `catalog.master_artists` | `artist_discogs_id` | integer | no | parse int | |
| `master/artists/artist/name` | `catalog.master_artists` | `artist_name` | text | no | trim | Denormalized for display |
| `master/artists/artist/anv` | `catalog.master_artists` | `anv` | text | yes | trim | Artist Name Variation used |
| `master/artists/artist/join` | `catalog.master_artists` | `join_relation` | text | yes | trim | e.g., "&", "feat.", "vs" |
| `master/genres/genre` | `catalog.master_genres` | `genre` | text | no | trim | |
| `master/styles/style` | `catalog.master_styles` | `style` | text | no | trim | |
| `master/videos/video` | `catalog.master_videos` | — | — | no | see below | |
| `master/videos/video/@src` | `catalog.master_videos` | `url` | text | no | — | |
| `master/videos/video/@duration` | `catalog.master_videos` | `duration_seconds` | integer | yes | parse int | |
| `master/videos/video/title` | `catalog.master_videos` | `title` | text | yes | trim | |
| `master/videos/video/description` | `catalog.master_videos` | `description` | text | yes | trim | |
| `master/images/image` | — | — | — | — | skip v1 | |

### Edge cases
- **year = 0**: Means unknown. Store as null in canonical.
- **Missing main_release**: Profiling will confirm if this occurs. Handle as nullable FK.
- **Multiple artists**: Use `join_relation` to reconstruct display string (e.g., "Artist A & Artist B feat. Artist C").

## 4. Releases

### Source: `discogs_*_releases.xml.gz`

Root element: `<release>` (has `id` and `status` attributes)

| XML Path | Canonical Table | Column | Type | Nullable | Transform | Notes |
|----------|----------------|--------|------|----------|-----------|-------|
| `release/@id` | `catalog.releases` | `discogs_id` | integer | no | parse int | Top-level attr |
| `release/@status` | `catalog.releases` | `status` | text | no | — | Accepted, Draft, Deleted, etc. |
| `release/title` | `catalog.releases` | `title` | text | no | trim | |
| `release/country` | `catalog.releases` | `country` | text | yes | trim | Raw string, not normalized |
| `release/released` | `catalog.releases` | `released_raw` | text | yes | trim | Raw date string |
| `release/released` | `catalog.releases` | `release_year` | integer | yes | parse year | Extracted from released |
| `release/released` | `catalog.releases` | `release_month` | integer | yes | parse month | May be null |
| `release/released` | `catalog.releases` | `release_day` | integer | yes | parse day | May be null |
| `release/notes` | `catalog.releases` | `notes` | text | yes | trim | Free text |
| `release/data_quality` | `catalog.releases` | `data_quality` | text | no | trim | |
| `release/master_id` | `catalog.releases` | `master_discogs_id` | integer | yes | parse int | FK → masters |
| `release/master_id/@is_main_release` | `catalog.releases` | `is_main_release` | boolean | yes | parse bool | |

### Release Artists
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/artists/artist/id` | `catalog.release_artists` | `artist_discogs_id` | integer | |
| `release/artists/artist/name` | `catalog.release_artists` | `artist_name` | text | Denormalized |
| `release/artists/artist/anv` | `catalog.release_artists` | `anv` | text | Artist Name Variation |
| `release/artists/artist/join` | `catalog.release_artists` | `join_relation` | text | |
| `release/artists/artist/role` | `catalog.release_artists` | `role` | text | Usually empty for main artists |

### Release Credits (extraartists)
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/extraartists/artist/id` | `catalog.release_credits` | `artist_discogs_id` | integer | |
| `release/extraartists/artist/name` | `catalog.release_credits` | `artist_name` | text | |
| `release/extraartists/artist/anv` | `catalog.release_credits` | `anv` | text | |
| `release/extraartists/artist/role` | `catalog.release_credits` | `role` | text | Free text, may contain multiple roles comma-separated |

### Tracks
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/tracklist/track/position` | `catalog.tracks` | `position_raw` | text | Raw position string |
| `release/tracklist/track/position` | `catalog.tracks` | `disc_number` | integer | Parsed |
| `release/tracklist/track/position` | `catalog.tracks` | `track_number` | text | Parsed (may be "A1", "B2", etc.) |
| `release/tracklist/track/title` | `catalog.tracks` | `title` | text | |
| `release/tracklist/track/duration` | `catalog.tracks` | `duration_raw` | text | e.g., "3:45" |
| `release/tracklist/track/duration` | `catalog.tracks` | `duration_seconds` | integer | Parsed to seconds |

### Track Credits
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/tracklist/track/extraartists/artist/*` | `catalog.track_credits` | — | — | Same shape as release credits |

### Labels on Release
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/labels/label/@name` | `catalog.release_labels` | `label_name` | text | Denormalized |
| `release/labels/label/@catno` | `catalog.release_labels` | `catno` | text | Catalog number |
| `release/labels/label/@id` | `catalog.release_labels` | `label_discogs_id` | integer | FK |

### Formats
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/formats/format/@name` | `catalog.release_formats` | `name` | text | e.g., "Vinyl", "CD", "Cassette" |
| `release/formats/format/@qty` | `catalog.release_formats` | `qty` | integer | |
| `release/formats/format/@text` | `catalog.release_formats` | `text` | text | Free text description |
| `release/formats/format/descriptions/description` | `catalog.release_format_descriptions` | `description` | text | e.g., "LP", "Album", "33 ⅓ RPM" |

### Identifiers
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/identifiers/identifier/@type` | `catalog.release_identifiers` | `type` | text | Barcode, Matrix / Runout, ASIN, etc. |
| `release/identifiers/identifier/@value` | `catalog.release_identifiers` | `value` | text | |
| `release/identifiers/identifier/@description` | `catalog.release_identifiers` | `description` | text | |

### Companies
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/companies/company/id` | `catalog.release_companies` | `company_discogs_id` | integer | FK → labels (companies are labels) |
| `release/companies/company/name` | `catalog.release_companies` | `company_name` | text | Denormalized |
| `release/companies/company/catno` | `catalog.release_companies` | `catno` | text | |
| `release/companies/company/entity_type` | `catalog.release_companies` | `entity_type` | text | Numeric code |
| `release/companies/company/entity_type_name` | `catalog.release_companies` | `entity_type_name` | text | e.g., "Pressed By", "Distributed By" |

### Videos
| XML Path | Canonical Table | Column | Type | Notes |
|----------|----------------|--------|------|-------|
| `release/videos/video/@src` | `catalog.release_videos` | `url` | text | |
| `release/videos/video/@duration` | `catalog.release_videos` | `duration_seconds` | integer | |
| `release/videos/video/title` | `catalog.release_videos` | `title` | text | |
| `release/videos/video/description` | `catalog.release_videos` | `description` | text | |

## 5. Date Parsing Rules

Input: `released` field (text)

| Pattern | Example | year | month | day |
|---------|---------|------|-------|-----|
| `YYYY-MM-DD` | `1995-03-14` | 1995 | 3 | 14 |
| `YYYY-MM` | `1995-03` | 1995 | 3 | null |
| `YYYY` | `1995` | 1995 | null | null |
| `YYYY-00-00` | `1995-00-00` | 1995 | null | null |
| `YYYY-MM-00` | `1995-03-00` | 1995 | 3 | null |
| Empty/missing | — | null | null | null |
| Other | `Spring 1995` | attempt parse | null | null |

## 6. Track Position Parsing Rules

Input: `position` field (text)

| Pattern | Example | disc | track | side |
|---------|---------|------|-------|------|
| Numeric | `3` | 1 | `3` | null |
| Vinyl side | `A1` | 1 | `A1` | `A` |
| CD disc | `1-3` | 1 | `3` | null |
| CD disc | `2-1` | 2 | `1` | null |
| Bonus | `B` | 1 | `B` | `B` |
| Video/DVD | `V1` | null | `V1` | null |
| Empty | `` | null | null | null |
| Sub-track | `1.1` | 1 | `1.1` | null |

Store `position_raw` always. Parsed fields are best-effort.

## 7. Duration Parsing Rules

Input: `duration` field (text)

| Pattern | Example | seconds |
|---------|---------|---------|
| `M:SS` | `3:45` | 225 |
| `MM:SS` | `12:05` | 725 |
| `H:MM:SS` | `1:02:30` | 3750 |
| Empty | `` | null |

Store `duration_raw` always.
