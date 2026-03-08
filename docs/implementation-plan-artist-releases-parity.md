# Implementation Plan: Artist Releases Parity + Section Order Fix

Date: 2026-03-08
Owner: API/Web agent
Priority: P0 data correctness + UX
Status: Ready for execution

## 1) Problem Summary
Kasra V (`artist/4506398`) highlights a structural gap:
- `masters`: 1
- `release_artists` (primary releases): 12
- `release_credits`: 8
- `track_credits`: 5

Current behavior:
- Artist page "Releases" uses masters-only path (`/v1/artists/:id/masters`) and undercounts artists with sparse master-linking.
- "Credits" can appear richer than "Releases," causing confusion.
- Section order currently places Credits above Releases.

Target behavior:
1. "Releases" = main-artist catalog view (masters + release-primary fallback).
2. "Credits & Appearances" = separate secondary section.
3. Releases section appears before Credits on artist page.

## 2) Non-negotiables
1. No destructive DB changes.
2. Keep canonical concept (`release` page for masters, `version` for pressings).
3. Release list must not claim empty when release-primary evidence exists.
4. LLM and web should share same releases semantics.

## 3) API Contract Changes

## 3.1 New traversal endpoint (recommended)
Add:
- `GET /v1/artists/:discogs_id/catalog_releases`

Query params:
- `limit` (default 30, max 100)
- `cursor`
- `sort` (`newest|oldest`, default `newest`)
- `release_type` (`album|single_ep|compilation|other|all`, default `all`)

Response shape:
- compatible with `TraversalResponse.links[]` plus:
  - `source: "master" | "release_primary"`
  - `master_discogs_id: number | null`

## 3.2 Backward compatibility
Do not change existing `/masters` semantics.
Use new endpoint for UI and LLM `get_artist_releases` tool behavior.

## 4) Domain Logic (core)
Implement in `packages/domain/src/traversal.ts` as `getArtistCatalogReleases(...)`.

Inputs:
- artist id, batch id, dump date, limit, cursor, sort, release_type

Data sources:
1. master path:
- `catalog.master_artists` -> `catalog.masters`
- classify release type via existing format classifier
2. primary release fallback path:
- `catalog.release_artists` -> `catalog.releases`
- constrain to primary role rows
- infer type via release formats/title rules

Merge rules:
1. Build candidate set from both sources.
2. Deduplicate by canonical key:
- if `master_discogs_id` available, key on master
- else key on `release_discogs_id`
3. Prefer `source=master` when both exist.
4. Keep `release_primary` rows where no master exists.
5. Sort by year + id according to requested sort.
6. Paginate after merge.

Output link type:
- masters emit `type: "master"`
- release-primary emit `type: "release"`

## 5) Web Changes
File:
- `apps/web/src/app/artist/[id]/page.tsx`

Changes:
1. `ArtistReleases` should fetch new endpoint (`/catalog_releases`) instead of `/masters`.
2. Section order:
- About
- Releases
- Credits & Appearances
- Connections
3. Keep filter chips on Releases.
4. Ensure link routing uses existing helper:
- master -> `/release/:id`
- release-primary -> `/version/:id`
5. Display source badge only if needed for debug/admin (optional, not user-facing by default).

## 6) LLM Tooling Changes
File:
- `apps/api/src/routes/v1/ask.ts`

Update `get_artist_releases` tool implementation:
1. Use catalog_releases logic (not masters-only).
2. Return `dig_url` for each item based on type:
- master => `/release/:id`
- release => `/version/:id`
3. Preserve rule: if still thin after catalog_releases, then call `get_artist_credits`.

## 7) SQL Validation (must run)
For canary artist IDs (include 4506398):
1. Count masters rows
2. Count release_artists rows
3. Count merged output rows
4. Ensure merged >= masters and <= masters + release_primary unique

Required check for Kasra:
- merged output should be > 1 and include Window/Flood/VSION records where present.

## 8) Tests

## 8.1 Domain tests
Add tests for `getArtistCatalogReleases`:
- masters-only artist
- release-primary-only artist
- mixed artist with overlap
- dedupe precedence (master wins)
- filtering by `release_type`

## 8.2 API tests
- `/v1/artists/:id/catalog_releases` returns expected shape + pagination

## 8.3 Web tests/smoke
- Artist page Releases section populated for Kasra
- Releases appears before Credits in DOM
- Links route correctly to `/release` or `/version`

## 8.4 LLM regression
Replay Kasra prompts; expected:
- no "not catalogued"
- releases list includes more than Akasa
- credits still available

## 9) Rollout Order
1. Domain function + tests
2. API endpoint + tests
3. Web section order + endpoint switch
4. LLM tool switch
5. Deploy API
6. Deploy web
7. Run canary checks + Kasra validation

## 10) Commands
```bash
git checkout -b codex/artist-releases-parity
npx -y pnpm@10.27.0 --filter @dig/domain test
npx -y pnpm@10.27.0 --filter @dig/api typecheck
npx -y pnpm@10.27.0 --filter @dig/web typecheck
npx -y pnpm@10.27.0 --filter @dig/web build
fly deploy --config fly.api.toml --remote-only
fly deploy --config fly.web.toml --remote-only
```

## 11) Acceptance Criteria
1. `artist/4506398` Releases section shows >1 release and precedes Credits section.
2. No regression for artist pages that are masters-rich.
3. LLM no longer reports "not catalogued" when release-primary data exists.
4. Routing contract remains correct (`release` master, `version` pressing).

## 12) Risks + Mitigations
Risk: duplicate/noisy release list.
Mitigation: deterministic merge key + dedupe + pagination after merge.

Risk: query cost increase.
Mitigation: cap + indexed joins + reuse existing filters; monitor p95.

Risk: route confusion.
Mitigation: always route via helper (`hrefForTraversalLink`).

## 13) Done Definition
Feature is complete when artist releases represent main-artist catalog reality (not masters-only), releases are shown before credits, and Kasra canary validates end-to-end across API/web/LLM.
