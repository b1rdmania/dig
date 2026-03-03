# EN-C Implementation Checklist (Execution-Only)

Status: ready to execute  
Phase: 4C (Wikidata Context)  
Goal: populate artist context from Wikidata for mapped crosswalks and expose it safely via existing enrichment contracts.

Inputs:
- `docs/enrichment-implementation-plan.md`
- `docs/en-b-api-contract.md`
- `docs/en-b-implementation-checklist.md`
- `docs/en-b-gate-closeout.md`

## 1) Scope Lock

In scope:
1. Populate `enrich.entity_context` for artists with `wikidata_qid` in `enrich.artist_crosswalks`
2. Context types: `bio`, `location`, `timeline_note` (minimal set for v1)
3. Keep `/v1/artists/:id/context` contract additive and stable
4. Add artist page context section (fail-soft)

Out of scope:
1. Release-level context
2. LLM-generated context
3. Canonical catalog field modifications

## 2) Data Pipeline Tasks

## 2.1 Ingest job

File: `apps/ingest/src/wikidata-context-import.ts` (NEW)
1. Input set: `enrich.artist_crosswalks` where `wikidata_qid is not null`
2. Pull context via Wikidata endpoint (batching + backoff + retry)
3. Normalize into deterministic JSON shapes per `context_type`
4. Upsert into `enrich.entity_context` with:
   - `entity_type='artist'`
   - `discogs_id`
   - `context_type`
   - `content_json`
   - `source='wikidata'`
   - `source_id=Q...`
   - `confidence` (deterministic heuristic; default floor `>=0.8`)
   - `match_method='artist_crosswalk'`

## 2.2 Batch tracking

1. Create/update `enrich.ingest_batches` entry:
   - source: `wikidata`
   - source_batch_key: `wikidata-context-YYYY-MM`
   - status transitions: `importing -> active`
2. Store stats in batch `stats` json:
   - total_qids
   - artists_updated
   - context_rows_written
   - errors

## 2.3 Idempotency

1. Re-run should not inflate row counts unexpectedly
2. Upsert keys should avoid duplicates for same `(entity_type, discogs_id, context_type, source, source_id)`

## 3) API / Domain Tasks

File: `packages/domain/src/enrichment.ts`
1. Confirm `getArtistContext()` correctly returns EN-C data from `enrich.entity_context`
2. Enforce `min_confidence` filter
3. Enforce `sources` filter (`wikidata` path)

File: `apps/api/src/routes/v1/enrichment.ts`
1. No contract change required
2. Validate query params remain strict

## 4) Frontend Tasks

File: `apps/web/src/app/artist/[id]/page.tsx`
1. Render context section below “Related Artists”
2. Show only when context exists (fail-soft hidden otherwise)
3. Label provenance (`Source: Wikidata`) in section footer
4. Keep mobile layout readable

## 5) Test Tasks

File: `packages/domain/src/__tests__/enrichment.test.ts`
1. mapped artist returns non-empty context
2. `min_confidence` filtering excludes low-confidence rows
3. source filter (`sources=wikidata`) works

File: `apps/api/src/__tests__/enrichment-routes.test.ts`
1. context endpoint returns expected shape with populated rows
2. invalid params still fail with `400 INVALID_REQUEST`

File: `apps/ingest/src/__tests__/wikidata-context-import.test.ts` (NEW)
1. parser normalization tests
2. upsert/idempotency tests with fixture rows

## 6) Acceptance Criteria (EN-C)

All must pass:
1. `enrich.entity_context` populated for a meaningful mapped subset
2. `/v1/artists/:id/context` returns real context for known artists
3. Existing EN-B endpoints unchanged
4. Typecheck/tests green (`@dig/ingest`, `@dig/domain`, `@dig/api`, `@dig/web`)
5. Context quality sample >= 90% accepted (manual review sample)

## 7) Verification Queries

```sql
SELECT COUNT(*) FROM enrich.entity_context WHERE entity_type = 'artist';
SELECT COUNT(DISTINCT discogs_id) FROM enrich.entity_context WHERE entity_type = 'artist';
SELECT context_type, COUNT(*) FROM enrich.entity_context WHERE entity_type = 'artist' GROUP BY 1 ORDER BY 2 DESC;
SELECT * FROM enrich.entity_context WHERE discogs_id IN (45, 3840, 10263) LIMIT 20;
```

## 8) Live Smoke Checks

1. `GET /v1/artists/3840/context?include_enrichment=true&sources=wikidata`
2. `GET /v1/artists/10263/context?include_enrichment=true&min_confidence=0.9`
3. `GET /v1/artists/3840/context?include_enrichment=true&sources=badsource` -> `400`

## 9) Commit Plan

1. `phase4c: add wikidata context importer and batch tracking`
2. `phase4c: add EN-C context tests and endpoint verification`
3. `phase4c: surface artist context in web UI + docs`
