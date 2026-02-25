# Preserve vs Normalize v1 Matrix

How each field group is handled during ingest. Guides importer implementation in Phase 1.

## Legend

- **Preserve raw**: Always stored in `ingest.raw_entities` as JSONB
- **Canonicalize v1**: Extracted into typed canonical tables in Phase 1
- **Defer**: Stored raw only, normalized in a future phase

## Artists

| Field/Group | Preserve Raw | Canonicalize v1 | Defer | Notes |
|-------------|:---:|:---:|:---:|-------|
| id | yes | yes | — | Primary key, `discogs_id` |
| name | yes | yes | — | Canonical name |
| realname | yes | yes | — | |
| profile | yes | yes | — | Free text, store as-is |
| data_quality | yes | yes | — | Discogs quality rating |
| namevariations | yes | yes | — | Array → `artist_name_variations` table |
| aliases | yes | yes | — | Array → `artist_aliases` join table (references other artist IDs) |
| groups | yes | yes | — | Array → `artist_groups` join table |
| members | yes | yes | — | Array → `artist_members` join table (inverse of groups) |
| urls | yes | yes | — | Array → `artist_urls` table |
| images | yes | defer | yes | Likely absent in dumps; CAA strategy handles images separately |

## Labels

| Field/Group | Preserve Raw | Canonicalize v1 | Defer | Notes |
|-------------|:---:|:---:|:---:|-------|
| id | yes | yes | — | Primary key |
| name | yes | yes | — | |
| profile | yes | yes | — | Free text |
| contactinfo | yes | defer | yes | Free text, low retrieval value for v1 |
| data_quality | yes | yes | — | |
| parentLabel | yes | yes | — | FK → labels (parent/child hierarchy) |
| sublabels | yes | yes | — | Array → derived from parentLabel relationships |
| urls | yes | yes | — | Array → `label_urls` table |
| images | yes | defer | yes | |

## Masters

| Field/Group | Preserve Raw | Canonicalize v1 | Defer | Notes |
|-------------|:---:|:---:|:---:|-------|
| id | yes | yes | — | Primary key |
| title | yes | yes | — | |
| main_release | yes | yes | — | FK → releases |
| year | yes | yes | — | Integer, may be 0 (unknown) |
| data_quality | yes | yes | — | |
| artists | yes | yes | — | Array → `master_artists` join table |
| genres | yes | yes | — | Array → shared `genres` table |
| styles | yes | yes | — | Array → shared `styles` table |
| videos | yes | yes | — | Array → `master_videos` table |
| images | yes | defer | yes | |

## Releases

| Field/Group | Preserve Raw | Canonicalize v1 | Defer | Notes |
|-------------|:---:|:---:|:---:|-------|
| id | yes | yes | — | Primary key |
| title | yes | yes | — | |
| status | yes | yes | — | (Accepted, Draft, etc.) |
| country | yes | yes | — | Free text, normalize common values |
| released | yes | yes | — | Partial dates common (year-only, etc.) — store raw + parsed fields |
| notes | yes | yes | — | Free text |
| data_quality | yes | yes | — | |
| master_id | yes | yes | — | FK → masters |
| artists | yes | yes | — | Array → `release_artists` join (with anv, join, role) |
| extraartists | yes | yes | — | Array → `release_credits` table (role parsing needed) |
| labels | yes | yes | — | Array → `release_labels` join (with catno) |
| formats | yes | yes | — | Array → `release_formats` table (name + descriptions + qty) |
| genres | yes | yes | — | Array → shared genres |
| styles | yes | yes | — | Array → shared styles |
| tracklist | yes | yes | — | Array → `tracks` table (position, title, duration, extraartists) |
| tracklist/extraartists | yes | yes | — | → `track_credits` table |
| identifiers | yes | yes | — | Array → `release_identifiers` (barcode, catno, matrix, ISRC, etc.) |
| companies | yes | yes | — | Array → `release_companies` (entity_type_name, catno, resource_url) |
| videos | yes | yes | — | Array → `release_videos` table |
| images | yes | defer | yes | |

## Key Normalization Rules (v1)

### Dates
- Raw `released` field stored as-is (text)
- Parse into: `release_year` (int, nullable), `release_month` (int, nullable), `release_day` (int, nullable)
- Invalid/malformed dates: store raw, set parsed fields to null

### Track Positions
- Store raw position string as-is
- Parse into: `disc_number` (int), `track_number` (text), `side` (text, nullable)
- Handle: numeric (1, 2, 3), vinyl sides (A1, B2), CD discs (1-1, 2-3), bonus/hidden tracks

### Credit Roles
- Store raw role string as-is
- v1: no role taxonomy normalization — just store the free text
- Phase 2+: parse common roles into structured role + detail

### Artist Name Variations (ANV)
- Store the ANV string alongside the canonical artist reference
- Both `anv` and canonical `name` are searchable

### Country Normalization
- Store raw country string
- v1: no normalization (too many variants: "US", "USA", "United States", "U.S.A.")
- Phase 2+: normalize to ISO 3166-1 codes

## What We Explicitly Do NOT Normalize in v1

- Credit role taxonomy (free text only)
- Country codes (raw strings)
- Contact info (labels)
- Image URLs/data
- Cross-platform IDs (Spotify, Apple Music, etc.)
