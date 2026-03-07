# Implementation Plan: Artist “No Dead Ends” via Credits Traversal

Date: 2026-03-07  
Owner: Domain + API + Web  
Status: Execution Ready

## 1. Problem Statement

Artist pages currently rely on:
- `artist -> masters` (`catalog.master_artists`)
- `artist -> releases` (`catalog.release_artists`)

This misses many real associations (writer/arranger/remixer/performer/session roles) that exist in:
- `catalog.release_credits`
- `catalog.track_credits`

Result: users land on valid artist pages that appear empty or incomplete, violating “no dead ends.”

## 2. Goal

Make artist pages reliably useful even when an artist is not a primary release/master artist by surfacing credit-based links and roles.

Success criteria:
1. Artists with no primary masters/releases but with credits show meaningful release links.
2. Role information is visible and filterable.
3. No regressions in existing artist/master/release traversal behavior.

## 3. Scope

In scope:
- New credit traversal in domain layer
- New API endpoint(s) for artist credits
- Artist page UI section for “Credits & Appearances”
- Role grouping/filtering and pagination
- Index/perf checks on credit tables
- Tests + rollout checks

Out of scope:
- Full graph redesign
- New ingestion pipeline
- Ranking model overhauls

## 4. Data Sources (Canonical)

Primary tables:
- `catalog.release_credits` (release-level roles)
- `catalog.track_credits` (track-level roles)
- `catalog.releases` (title/year/country/master linkage)

Join key:
- `artist_discogs_id`
- `release_discogs_id` + `batch_id`

## 5. API and Domain Design

## 5.1 Domain function (new)

Add in `packages/domain/src/traversal.ts`:
- `getArtistCredits(...)`

Proposed response shape:
- `links[]` where each item includes:
  - `release_discogs_id`
  - `title`
  - `year`
  - `country`
  - `roles[]` (deduped normalized role labels)
  - `role_count`
  - `credit_source` (`release` | `track` | `both`)
  - provenance
- pagination cursor
- meta:
  - `total_estimate`
  - `elapsed_ms`
  - `source_type=artist`
  - `link_type=credits`

Role filter:
- optional `role` query param
- optional `role_family` (`writing`, `arranging`, `performance`, `production`, `other`)

## 5.2 API routes (new)

In `apps/api/src/routes/v1/traversal.ts`:
- `GET /v1/artists/:discogs_id/credits`

Query params:
- `limit` (default 20, max 100)
- `cursor`
- `role` (exact match, case-insensitive)
- `role_family` (mapped in domain)

Batch resolution:
- use `getBatchForTable(db, "catalog.release_credits")`
- for track-credit path, use table-aware batch fallback:
  - `catalog.track_credits`
  - ensure same resolved batch for joined release lookups

Error taxonomy:
- unchanged (`INVALID_REQUEST`, `INTERNAL_ERROR`)

## 5.3 Optional compatibility extension

Add traversal link type alias in MCP tool docs:
- `artist_credits`

Do not remove existing tool shapes; additive only.

## 6. UI/UX: Artist Page

File: `apps/web/src/app/artist/[id]/page.tsx`

### New section order
1. Hero (name/provenance)
2. About
3. Credits & Appearances (new)
4. Releases (masters) — existing
5. Related artists / timeline — existing

### “Credits & Appearances” behavior
- Render if credits list non-empty.
- Show release title + year + compact role badges.
- Clicking goes to `/release/[id]` (or `/version/[id]` only when needed by current IA rule).
- Provide role filter chips:
  - All, Writing, Arranging, Performance, Production, Other
- Include “Show more” pagination.

### No-dead-end policy
- If masters list empty but credits exist:
  - section must still render and be first actionable list.
- If neither masters nor credits exist:
  - explicit message that no linked releases/credits are available yet.

## 7. Performance and Indexing

Expected heavy paths are role lookups on credit tables.

Validate/add indexes (if missing):
- `catalog.release_credits(batch_id, artist_discogs_id, release_discogs_id)`
- `catalog.track_credits(batch_id, artist_discogs_id, release_discogs_id)`
- optional role filter support:
  - `catalog.release_credits(batch_id, artist_discogs_id, role)`
  - `catalog.track_credits(batch_id, artist_discogs_id, role)`

Use EXPLAIN ANALYZE before/after for:
- unfiltered credits query
- role-filtered credits query

SLO target:
- p95 <= 300ms warm for artist credits endpoint

## 8. Detailed Task List (Agent)

## Phase A — Domain/API
1. Add `getArtistCredits` in `packages/domain/src/traversal.ts`.
2. Export from `packages/domain/src/index.ts`.
3. Add route `GET /v1/artists/:discogs_id/credits` in `apps/api/src/routes/v1/traversal.ts`.
4. Add type definitions in `apps/web/src/lib/types.ts` for credits traversal response.
5. Add tests:
   - domain unit tests for dedupe/group/pagination
   - API route tests for shape + filters + invalid params

## Phase B — UI
1. Add credits fetch in artist page server component.
2. Add new “Credits & Appearances” section with role badges.
3. Add role-family filter chips (URL-driven query param).
4. Add fallback messaging for no masters/no credits cases.
5. Ensure existing Suspense streaming still works.

## Phase C — Validation + rollout
1. Spot-check known problematic artist IDs:
   - `769196` (Tommy Danvers)
   - plus at least 10 random writer/remixer-heavy artists
2. Run perf checks and record p95.
3. Update docs:
   - this plan progress
   - ops note if new indexes added
4. Deploy API + web.

## 9. Acceptance Criteria

Must pass before merge:
1. Artist 769196 page shows release links from credits (writer/arranger/etc.).
2. At least one role-family filter returns non-empty subset.
3. No regressions on existing artist masters list.
4. Endpoint returns consistent pagination and provenance.
5. p95 for artist credits endpoint stays within agreed envelope.
6. 0 contract-breaking changes (additive only).

## 10. Rollback Plan

If regressions or load spikes:
1. Feature-flag hide “Credits & Appearances” section in web.
2. Keep endpoint deployed but uncoupled from UI.
3. Revert added indexes only if explicitly needed (normally keep additive indexes).

## 11. Notes for Product

This fix closes a core trust gap:
- Users can now “follow productions and roles,” not only primary artists.
- It aligns the product with the stated principle: no dead ends.
