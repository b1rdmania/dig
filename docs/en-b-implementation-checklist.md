# EN-B Implementation Checklist (Execution-Only)

Status: ready to execute  
Inputs:
- `docs/en-b-api-contract.md`
- `docs/enrichment-implementation-plan.md`
- `docs/phase2-response-contracts.md`

Goal: implement EN-B artist relationship/context APIs using existing `enrich.*` tables without changing canonical contracts.

## 1. Scope Lock

In scope:
1. `GET /v1/artists/:discogs_id/relationships`
2. `GET /v1/artists/:discogs_id/context`
3. Query params: `include_enrichment`, `min_confidence`, `sources`, `limit`, `cursor`
4. Additive `meta` fields only

Out of scope:
1. Canonical field modifications
2. Label/release enrichment endpoints
3. LLM-generated explanations

## 2. File-by-File Tasks

## 2.1 Domain layer

File: `packages/domain/src/enrichment.ts` (NEW)
1. Add `getArtistRelationships(...)`
2. Add `getArtistContext(...)`
3. Enforce filters:
   - `include_enrichment`
   - `min_confidence`
   - `sources`
4. Return deterministic shapes from `docs/en-b-api-contract.md`

File: `packages/domain/src/index.ts`
1. Export new enrichment functions + types

## 2.2 API routes

File: `apps/api/src/routes/v1/enrichment.ts` (NEW)
1. Register:
   - `/v1/artists/:discogs_id/relationships`
   - `/v1/artists/:discogs_id/context`
2. Validate query params and return existing error taxonomy:
   - `INVALID_REQUEST`
   - `NOT_FOUND`
   - `QUERY_TIMEOUT`
   - `INTERNAL_ERROR`

File: `apps/api/src/server.ts` (or route registration file in use)
1. Register enrichment route module

## 2.3 Contracts/docs

File: `docs/phase2-response-contracts.md`
1. Add EN-B additive endpoint sections
2. Add enrichment `meta` field definitions

File: `docs/quickstart.md`
1. Add curl examples for both new endpoints
2. Add query-param examples for `sources` + `min_confidence`

File: `docs/enrichment-implementation-plan.md`
1. Mark EN-B API contract + implementation checklist linked

## 2.4 Tests

File: `packages/domain/src/__tests__/enrichment.test.ts` (NEW)
1. mapped artist returns edges/context
2. unmapped artist returns empty arrays + 200 behavior
3. `min_confidence` filters correctly
4. invalid source filter rejected at API layer

File: `apps/api/src/__tests__/enrichment-routes.test.ts` (NEW or existing route tests)
1. happy path for both endpoints
2. invalid params -> `400 INVALID_REQUEST`
3. confidence bounds -> `400 INVALID_REQUEST`
4. include_enrichment=false -> empty enrichment payload with canonical-safe meta

## 3. SQL/Data Access Rules

1. Read only from `enrich.*` + canonical lookup tables as needed for names.
2. Do not write to `catalog.*`.
3. Do not backfill crosswalk data in this implementation step.
4. Enforce deterministic ordering for cursor pagination.

## 4. Acceptance Criteria

All must pass:
1. Endpoint responses match `docs/en-b-api-contract.md`
2. Existing canonical endpoints unchanged
3. Typecheck/tests green for `@dig/domain` and `@dig/api`
4. p95 latency delta <= 20% on enrichment-enabled paths (sample benchmark)
5. Docs updated (`response-contracts`, `quickstart`, `progress.html`)

## 5. Run Sequence

1. Implement domain module and exports
2. Implement API routes + validation
3. Add tests
4. Update docs
5. Run:
   - `pnpm --filter @dig/domain test`
   - `pnpm --filter @dig/domain typecheck`
   - `pnpm --filter @dig/api typecheck`
6. Deploy API
7. Run live curl smoke checks

## 6. Live Smoke Checks

1. `GET /v1/artists/3840/relationships?include_enrichment=true&sources=musicbrainz`
2. `GET /v1/artists/3840/context?include_enrichment=true&sources=wikidata`
3. `GET /v1/artists/3840/relationships?include_enrichment=true&min_confidence=0.95`
4. `GET /v1/artists/3840/relationships?include_enrichment=true&sources=badsource` -> `400`

## 7. Commit Plan

1. `phase4a: add EN-B domain enrichment services`
2. `phase4a: add EN-B API endpoints and validation`
3. `phase4a: add EN-B tests and docs`
