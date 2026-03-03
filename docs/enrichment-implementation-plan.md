# Enrichment Implementation Plan (MusicBrainz + Wikidata + Setlist)

Purpose: extend Dig from a deterministic catalog/retrieval layer into an open music knowledge graph while preserving trust and API contract stability.

## 1. Scope and Principles

### Scope (v1 enrichment)

- MusicBrainz: typed relationship graph enrichment
- Wikidata: biographical/historical context enrichment
- Setlist.fm: live performance timeline enrichment
- MCP/API exposure of enrichment with provenance + confidence

### Non-goals (v1 enrichment)

- Replacing Discogs catalog as canonical release spine
- Unbounded LLM-generated facts in retrieval responses
- Writing back to Discogs or other third-party systems
- Auto-accepting low-confidence cross-source matches

### Source trust policy (locked)

- `Discogs CC0`: canonical catalog truth (`source_tier=canonical`)
- `MusicBrainz/Wikidata/Setlist`: additive context (`source_tier=enrichment`)
- Canonical fields are never overwritten by enrichment data
- Every enrichment field/edge must include `source`, `source_id`, `confidence`, and `match_method`

---

## 2. Data Model Changes

Create a dedicated `enrich` schema. Keep `catalog.*` unchanged.

### 2.1 Crosswalk tables

- `enrich.artist_crosswalks`
  - `discogs_artist_id`, `mbid`, `wikidata_qid`, `setlistfm_artist_id`
  - `confidence`, `match_method`, `is_verified`, `created_at`, `updated_at`
- `enrich.label_crosswalks`
  - `discogs_label_id`, `mbid`, `wikidata_qid`
  - same confidence/provenance columns
- `enrich.release_crosswalks`
  - `discogs_release_id`, `mbid`
  - `confidence`, `match_method`, `is_verified`

### 2.2 Graph edge table

- `enrich.relationship_edges`
  - `source_entity_type`, `source_discogs_id`
  - `target_entity_type`, `target_discogs_id` (nullable if no Discogs mapping yet)
  - `edge_type` (typed enum/string, e.g. `member_of`, `produced_by`, `recorded_at`, `influenced_by`)
  - `edge_source` (`musicbrainz` | `wikidata` | `setlistfm`)
  - `edge_source_id`
  - `confidence`, `match_method`, `valid_from`, `valid_to`

### 2.3 Context table

- `enrich.entity_context`
  - `entity_type`, `discogs_id`
  - `context_type` (`bio`, `history`, `scene`, `location`, `timeline_note`)
  - `content_json`
  - `source`, `source_id`, `confidence`
  - `created_at`, `updated_at`

### 2.4 Job/state tables

- `enrich.ingest_batches`
- `enrich.match_review_queue` (low-confidence matches for manual review)
- `enrich.refresh_checkpoints` (incremental update markers)

---

## 3. API and MCP Contract Extensions

### 3.1 Query parameters

- `include_enrichment` (bool, default `false`)
- `min_confidence` (float, default `0.7`)
- `sources` (optional list: `musicbrainz,wikidata,setlistfm`)

### 3.2 Response additions

- Add `source_tier` (`canonical` or `enrichment`) per returned block/edge
- Preserve existing `provenance` and `degraded_reason` semantics
- Add enrichment-specific metadata:
  - `enrichment_included`
  - `enrichment_sources`
  - `enrichment_edge_count`

### 3.3 New MCP tools (v1 enrichment)

- `get_relationship_graph`
- `get_artist_context`
- `get_live_timeline`
- `explain_connection` (structured only, no generated facts)

All tools must return structured payloads aligned with `phase2-response-contracts.md` conventions.

API contract draft for EN-B implementation:
- [EN-B API Contract](en-b-api-contract.md)

---

## 4. Rollout Plan (Phased)

## 4A. Foundation (Schema + Matching Policy)

- Add `enrich.*` migrations
- Lock deterministic matching rules and confidence thresholds
- Implement low-confidence review queue
- Implement DDL per [EN-A Migration Spec](enrichment-migration-spec-en-a.md)

Done criteria:
- Migrations apply cleanly
- Crosswalk insert/update idempotent
- Matching policy documented and tested

## 4B. MusicBrainz Relationships

- Ingest MB relationship data
- Build Discogs↔MB crosswalks for artists/labels/releases
- Expose edges in traversal/API/MCP with provenance

Done criteria:
- `traverse_links` returns typed enrichment edges when requested
- No canonical overwrite regressions
- Coverage/precision checks pass thresholds

## 4C. Wikidata Context

- Ingest mapped Wikidata context for entities with stable crosswalks
- Add contextual blocks (bio/history/scene/location)
- Enforce source tagging and confidence floor

Done criteria:
- Context blocks available for mapped entities
- Low-confidence context excluded by default
- API/MCP response contracts unchanged except additive fields

## 4D. Setlist Timeline

- Integrate setlist timeline data for mapped artists
- Keep timeline as separate contextual dimension
- Add temporal traversal/read endpoints

Done criteria:
- Timeline query works for mapped artists
- Clear source/terms attribution present
- No effect on canonical release search correctness

---

## 5. Quality Gates

### Gate EN-A (after 4A)

- [ ] Matching policy locked (`exact > deterministic fallback > review queue`)
- [ ] `enrich.*` schema deployed
- [ ] Contract test scaffolds in place

### Gate EN-B (after 4B)

- [ ] MB edge ingest repeatable
- [ ] Crosswalk precision sample meets target (>= 95% on reviewed sample)
- [ ] Traversal latency impact acceptable (p95 delta <= 20% with enrichment enabled)

Gate closeout format:
- [EN-B Gate Closeout Template](en-b-gate-closeout-template.md)

### Gate EN-C (after 4C)

- [ ] Wikidata context provenance complete
- [ ] Context quality sample meets target (>= 90% accepted)
- [ ] No canonical field conflicts introduced

Execution checklist:
- [EN-C Implementation Checklist](en-c-implementation-checklist.md)

Gate closeout format:
- [EN-C Gate Closeout Template](en-c-gate-closeout-template.md)

### Gate EN-D (after 4D)

- [ ] Setlist timeline integrated with source attribution
- [ ] End-to-end MCP enrichment tools validated in two clients
- [ ] Alpha docs updated with enrichment semantics and caveats

---

## 6. Legal and Compliance Checks

- Confirm current usage terms for:
  - MusicBrainz data dumps/API
  - Wikidata dumps/API
  - Setlist.fm API/data usage
- Document attribution requirements by source
- Add source-specific kill switch flags in config for fast disable

---

## 7. Risks and Mitigations

- Identity mismatch risk
  - Mitigation: strict confidence thresholds + review queue + no canonical overwrite
- Latency inflation from enrichment joins
  - Mitigation: optional `include_enrichment`, indexed crosswalk tables, cached graph reads
- Data drift/quality inconsistency
  - Mitigation: batch/versioning + periodic precision sampling
- Terms/licensing changes
  - Mitigation: source feature flags + attribution docs + emergency disable path

---

## 8. Success Metrics

- `% mapped artists` (Discogs → MBID → Wikidata/Setlist)
- `% traversal responses with enrichment edges when requested`
- Enrichment precision (review sample acceptance rate)
- P95 latency delta with enrichment enabled
- MCP enrichment tool success/error rate

---

## 9. Immediate Execution Order (No-Guess Path)

1. Ship `enrich.*` migrations and crosswalk schema
2. Implement Discogs↔MusicBrainz matching and edge ingest on sample
3. Add `include_enrichment` + `min_confidence` to API/MCP contracts
4. Run quality sampling and lock Gate EN-B
5. Add Wikidata context for mapped entities
6. Add Setlist timeline as separate enrichment stream
