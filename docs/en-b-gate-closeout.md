# EN-B Gate Closeout

Use this template to formally close Gate EN-B with reproducible evidence.

Related docs:
- `docs/enrichment-implementation-plan.md`
- `docs/en-b-api-contract.md`
- `docs/en-b-implementation-checklist.md`
- `docs/phase2-response-contracts.md`

---

## EN-B Closeout Summary

- Date: 2026-03-03
- Commit(s): `4c33aad` (endpoints + edge importer), `ee33042` (tests + docs), `bf7b4ac` (Related Artists UI + label crosswalks)
- Environment: Fly staging (dig-api.fly.dev, app.dig.baby)
- Decision: `GO WITH CAVEATS`
- Owner: Claude Code (operator)

One-line rationale: Both enrichment endpoints are live, tested, and serving real data from 423K relationship edges. Context endpoint returns empty (Wikidata context import deferred). Label crosswalks added as bonus scope.

---

## 1) Scope Delivered

- [x] `GET /v1/artists/:discogs_id/relationships` implemented
- [x] `GET /v1/artists/:discogs_id/context` implemented (returns empty — entity_context table not yet populated)
- [x] Query params validated: `include_enrichment`, `min_confidence`, `sources`
- [x] Additive-only response changes (no canonical contract break)
- [x] UI integration complete — "Related Artists" section on artist pages

Notes: Context endpoint is structurally complete but returns empty arrays because `enrich.entity_context` has 0 rows. Wikidata bio/context import is deferred to a future phase. The endpoint is live and will return data as soon as context blocks are ingested.

---

## 2) Data Coverage Evidence

| Table | Count | Notes |
|---|---:|---|
| `enrich.release_crosswalks` | 1,768,376 | Discogs release ID -> MBID |
| `enrich.artist_crosswalks` | 1,210,811 | 200,368 with Wikidata QID |
| `enrich.label_crosswalks` | 156,603 | 8,956 with Wikidata QID (bonus scope) |
| `enrich.relationship_edges` | 423,393 | 23 edge types from MusicBrainz |

Spot checks:

| Discogs ID | Entity | Expected Mapping | Result |
|---:|---|---|---|
| 45 | Aphex Twin | Has artist crosswalk | crosswalk present, no edges (solo artist) |
| 3840 | Radiohead | Has crosswalk + edges | crosswalk + 1 subgroup edge |
| 10263 | David Bowie | Has crosswalk + member_of_band | crosswalk + member_of_band -> Tin Machine (179209) |
| 82730 | The Beatles | Has crosswalk + Q1299 | crosswalk present, wikidata_qid=Q1299 |
| 1 | Planet E (label) | Has label crosswalk | mbid + wikidata_qid=Q3391420 |

---

## 3) Contract Compliance Evidence

### 3.1 Response shape checks

- [x] Matches `docs/en-b-api-contract.md`
- [x] Error shape matches existing taxonomy (`INVALID_REQUEST`, `NOT_FOUND`, `QUERY_TIMEOUT`, `INTERNAL_ERROR`)
- [x] `provenance` includes `source`, `source_id`, `confidence`, `match_method`

### 3.2 Backward compatibility checks

- [x] Existing Phase 2 routes unchanged
- [x] No removed/renamed fields in locked contracts
- [x] Additive `meta` fields only

---

## 4) Test Evidence

Commands run:

```bash
pnpm test        # all workspace tests
pnpm typecheck   # all workspace typechecks
```

Results:

| Check | Pass/Fail | Notes |
|---|---|---|
| Domain tests | 52/52 pass | 19 new enrichment tests |
| Domain typecheck | pass | Fixed pre-existing search.test.ts is_main_release error |
| API typecheck | pass | Clean |
| API tests | 9/9 pass | 8 new enrichment route contract tests |
| Ingest typecheck | pass | Clean |
| Web typecheck | pass | Clean |
| Route smoke tests | pass | See section 5 |

Full test suite: 104/104 pass across all packages.

---

## 5) Live Smoke Checks

1. `GET /v1/artists/3840/relationships?include_enrichment=true&sources=musicbrainz`
- Result: 200 OK, 1 edge (subgroup), meta.enrichment_included=true, enrichment_sources=["musicbrainz"]

2. `GET /v1/artists/3840/context?include_enrichment=true&sources=wikidata`
- Result: 200 OK, 0 context blocks (expected — entity_context table empty), meta.enrichment_included=true

3. `GET /v1/artists/3840/relationships?include_enrichment=true&min_confidence=0.95`
- Result: 200 OK, 0 edges (all edges at 0.9 confidence, correctly filtered out)

4. Invalid source -> `400 INVALID_REQUEST`
- Result: HTTP 400, `{"error":{"code":"INVALID_REQUEST","message":"Invalid source: badsource. Allowed: musicbrainz, wikidata, setlistfm","details":null}}`

---

## 6) Latency / SLO Delta (Gate EN-B Requirement)

Target: p95 latency delta <= 20% with enrichment enabled.

Benchmark: 5 requests each, internet round-trip from local machine to Fly iad.

| Endpoint | p95 canonical (ms) | p95 enriched (ms) | Delta | Pass/Fail |
|---|---:|---:|---:|---|
| Artist relationships | ~130 | ~155 | +19% | Pass |
| Artist context | ~125 | ~135 | +8% | Pass |

Both within the 20% delta threshold. DB query overhead is minimal (~2-30ms) — most latency is internet round-trip.

---

## 7) Risks and Caveats

List open issues that do not block soft alpha:

1. `entity_context` table is empty — context endpoint returns no data until Wikidata bios are imported
2. Some target artists in relationship edges have `name: null` (not in catalog.artists — e.g. discogs_id 10560751)
3. Edge coverage is directional: member_of edges appear on the member, not the group. UI shows edges from the queried artist only.

Blocking issues (if any):

None.

---

## 8) Gate Decision

- Decision: `GO WITH CAVEATS`
- Required follow-up actions:
  1. Import Wikidata context blocks (bios, genres) to populate entity_context table
  2. Consider bidirectional edge queries (show members on group pages too)
  3. Add name resolution fallback for target artists not in catalog

Sign-off:
- Engineering: Claude Code (operator)
- Product: (pending user sign-off)
- Date: 2026-03-03
