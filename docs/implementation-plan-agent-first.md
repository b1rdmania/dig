# Dig Implementation Plan (Agent-First)

Agent-first, data-first implementation plan for `Dig` (`1–2 person team`)

## 0. Principles

- `Preserve everything raw, normalize in layers`
- `Retrieval core is the product`
- `Agent interfaces first, human UI second`
- `Images are mandatory, so image strategy is a gating workstream`
- `No silent data loss`

## 1. Locked Decisions

- Architecture: `modular monolith`
- DB: `Postgres`
- Search v1: `Postgres FTS + pg_trgm`
- Auth v1 (public agent alpha): `no auth`, `IP rate limiting`
- LLM strategy: `no proxying`; Dig serves data, users bring models
- Ingest strategy: `raw payload staging in ingest.raw_entities`
- Non-goals (v1): marketplace, compliance stack, Discogs write-back, open public editing

## 2. Open Decisions (must be resolved early)

- `Image source strategy` (dumps vs API vs other source)
- `Image serving policy` (direct URL / proxy / cache)
- `Phase 1 QA thresholds`
- `Phase 2 traversal scope` (how much credit/company graph in v1)
- `Public alpha rate limits` (exact numbers)

## 3. Current Dataset Findings (from local dump profiling)

- `artists`: rich graph data (`aliases`, `groups`, `members`, `namevariations`, `urls`)
- `labels`: parent/sublabel graph + profiles/urls
- `masters`: `main_release`, genres/styles/year/title, `videos`
- `releases`: strong metadata richness:
  - artists, labels, extraartists, formats, genres/styles, country, released, notes
  - master_id, tracklist
  - identifiers
  - videos
  - companies
  - track-level extraartists (present in many records)
- `images`: no `<images>` seen in samples of first `50,000` releases
  - treat “images from dumps” as unproven / likely unavailable

## 4. Phase 0: Data Profiling + Normalisation Dictionary + Image Strategy

### Goal

Eliminate schema/import ambiguity before writing importer logic.

### Scope

- Profile actual dump structures and edge cases
- Define normalization rules and v1 canonical schema boundaries
- Define image acquisition strategy
- Define QA gates for Phase 1

### Tasks

#### 4.1 Profiling scripts

- `profile_releases.py`
- `profile_artists.py`
- `profile_labels.py`
- `profile_masters.py`
- outputs: counts, field presence, edge-case examples

#### 4.2 Normalization dictionary v1

- field mappings (XML -> canonical)
- raw preservation rules
- normalized value rules
- nullability/fallback behavior
- unresolved/deferred edge cases

#### 4.3 Edge-case deep dives

- `ANV` handling
- track position parsing
- credit role parsing
- master/release linkage
- identifiers taxonomy
- partial dates (`released`)

#### 4.4 Image strategy (mandatory)

- verify dump image absence/presence conclusively enough for planning
- choose source for image metadata/assets
- define serving policy
- define coverage KPI and launch threshold

#### 4.5 Phase 1 QA thresholds

- define pass/fail criteria before importer code starts

### Deliverables

- `Normalization Dictionary v1`
- `Schema v1` (locked for importer)
- `Preserve vs Normalize v1 Matrix`
- `Image Strategy v1`
- `Phase 1 QA Gate Spec`

### Done Criteria

- No unresolved schema-shaping issues
- No ambiguity on ANV / track positions / credits / master-release handling for v1
- QA thresholds documented
- Image strategy chosen (not deferred)
- Team agrees on what is normalized now vs later

### Estimated time

- `1–2 weeks` (can slip to `2–3` if edge cases/images need deeper work)

## 5. Phase 1: Ingestion Foundation + Canonical Database

### Goal

Repeatable import pipeline from Discogs dumps into raw + canonical tables.

### Scope

- Batch tracking
- XML parsing
- Raw payload storage
- Canonical upserts for v1 entities
- QA reports
- Idempotent reruns

### Tasks

#### 5.1 Ingest infra tables

- `ingest.dump_batches`
- `ingest.raw_entities`
- import run metadata/logging

#### 5.2 Stream parser

- per-dump parser for artists/labels/masters/releases
- error capture/logging

#### 5.3 Canonical v1 upserts

- artists
- labels
- masters
- releases
- tracks
- release extraartists / track extraartists
- identifiers
- companies
- videos
- formats + format descriptions

#### 5.4 Preserve long-tail fields

- raw payload always
- optional JSON storage for deferred fields

#### 5.5 QA/reconciliation

- row counts by entity
- malformed field counts
- missing reference counts
- unknown enum/type buckets

#### 5.6 Idempotency

- rerun same batch safely
- re-derive canonical from raw payloads

### Deliverables

- Repeatable sample import run
- Canonical DB populated
- QA report generated per run

### Done Criteria

- End-to-end import completes on sample dataset
- Required entities queryable
- QA metrics meet Phase 0 thresholds
- No silent drops of required fields
- Rerun does not duplicate/corrupt data

### Estimated time

- `2–4 weeks`

## 6. Phase 2: Retrieval Core (Internal)

### Goal

Build deterministic search + entity retrieval + scoped traversal.

### Scope

- Search and retrieval only (no public API yet)
- Stable JSON contracts for downstream API/MCP/UI
- Scoped graph traversal

### Tasks

#### 6.1 Search v1

- `tsvector` indexes
- `pg_trgm`
- search ranking heuristics (exact/prefix/fuzzy)

#### 6.2 Entity retrieval services

- artist
- label
- master
- release

#### 6.3 Traversal v1 scope

- artist -> releases/masters
- label -> releases/masters
- release/master -> credits
- credit/person -> linked releases (direct links only)
- release -> companies

#### 6.4 Response shape

- provenance fields
- confidence/relevance where applicable
- stable JSON schemas

#### 6.5 Ops hooks

- request timing
- query logging
- rate limit middleware hooks

### Explicit v1 deferrals

- advanced semantic graph ranking
- inferred entity resolution beyond deterministic mappings
- complex role ontology expansion beyond parsed/raw support

### Deliverables

- Internal retrieval module/service
- Stable JSON contracts
- Search latency baseline

### Done Criteria

- Deterministic results for repeated queries
- Entity retrieval can power UI and MCP without extra logic
- Traversal scope documented and tested
- Performance acceptable on sample/working dataset

### Estimated time

- `2–3 weeks`

## 7. Phase 3: REST API + MCP Public Alpha (Agent-First)

### Goal

Ship agent-usable public utility before the human UI.

### Decision (locked)

- `No auth`
- `IP rate limiting + logging` from day one

### Tasks

#### 7.1 REST endpoints v1

- `GET /search`
- `GET /artists/:id`
- `GET /labels/:id`
- `GET /masters/:id`
- `GET /releases/:id`
- `GET /releases/:id/media-links` (can be limited/empty initially)

#### 7.2 MCP tools v1

- `search_catalog`
- `get_release`
- `get_master_release`
- `get_artist`
- `get_label`
- `get_related_releases`
- `explain_relationships`
- `create_crate_draft` (draft/read-only semantics)

#### 7.3 Public alpha protections

- IP rate limits
- request logging
- abuse visibility

#### 7.4 Docs and examples

- curl
- MCP config examples
- examples for Claude/ChatGPT/tool-calling flows

#### 7.5 Error/contract quality

- stable error format
- response examples with provenance/confidence

### Deliverables

- Public REST alpha
- Open MCP alpha
- Docs/examples

### Done Criteria

- External user can self-serve usage from docs
- MCP connection works in common tooling
- Rate limits active and observable
- Response schemas stable enough for client integration

### Estimated time

- `1–2 weeks`

## 8. Phase 4: Human Search UI (Mobile-First)

### Goal

Ship the human experience on top of the same retrieval core.

### Scope

- Search/browse only
- No marketplace
- Mobile-first interaction quality

### Tasks

#### 8.1 Search UI

- query entry
- filters / chips
- result grouping
- “why matched” cues if feasible

#### 8.2 Entity pages

- release
- master
- artist
- label

#### 8.3 Cross-linked navigation

- click artists/labels/credits/companies and traverse

#### 8.4 Images (mandatory)

- integrate chosen image strategy
- placeholders/fallbacks
- coverage monitoring

#### 8.5 Performance/caching

- payload trimming
- API response caching
- mobile tuning

### Deliverables

- Mobile-first human search product
- Cross-linked record/entity browsing

### Done Criteria

- Search -> record page -> deeper traversal works reliably
- UI uses API responses directly (no duplicated business logic)
- Images display per coverage strategy
- Mobile UX meets internal quality bar

### Estimated time

- `2–4 weeks`

## 9. Phase 5: Curation / Crates / Editorial

### Goal

Add differentiated human and agent-compounding layer.

### Scope

- Approved contributors only
- Curation + context + linkouts
- No open wiki edits in v1

### Tasks

#### 9.1 Curator profiles

#### 9.2 Crate/list pages

#### 9.3 Editorial notes with provenance

#### 9.4 Approved contributor workflow

#### 9.5 Linkouts

- Spotify
- Apple Music
- Bandcamp
- Discogs

#### 9.6 Minimal editorial tooling

- create/edit/publish
- moderation/approval

### Deliverables

- Curated crates
- Editorial notes
- Contributor workflow

### Done Criteria

- Approved contributor can publish crate + notes + links
- Users can navigate curated content
- Provenance visible/retained for editorial entries

### Estimated time

- `2–4+ weeks`

## 10. Cross-Cutting Workstreams

### 10.1 Image Strategy (Mandatory)

This is a parallel planning/build track spanning Phases 0–4.

Must define:

- source of image metadata/assets
- serving policy (direct/proxy/cache)
- refresh/validation behavior
- legal/terms posture
- launch coverage threshold

Metrics:

- `% releases with valid primary image`
- image fetch failure rate
- placeholder rate on top queries

### 10.2 Preserve vs Normalize Matrix

For each field/group:

- preserve raw: `yes/no`
- canonicalize v1: `yes/no`
- defer normalization: `yes/no`
- notes/rationale

This prevents over-normalization while protecting future feature optionality.

### 10.3 Observability

From Phase 1 onward:

- import job logs
- parser errors
- API request/error logs
- rate-limit events
- query latency
- image fetch failures (later)

## 11. Phase Gates (Go / No-Go)

### Gate A (after Phase 0)

- Schema and normalization dictionary stable enough to code importer
- Image strategy chosen
- QA thresholds defined

### Gate B (after Phase 1)

- Import pipeline repeatable
- QA thresholds met
- No silent drops of required fields

### Gate C (after Phase 2)

- Retrieval contracts stable
- Traversal scope constrained and working
- Search latency acceptable

### Gate D (after Phase 3)

- Public alpha operable without manual babysitting
- Rate limiting/logging functioning
- Docs usable

### Gate E (after Phase 4)

- Human UI is clearly useful and mobile-friendly
- API/UI parity maintained

## 12. Timeline (1–2 Person Team)

### Agent alpha (through Phase 3)

- `6–11 weeks` best case
- `8–14 weeks` safer planning

### Human search MVP (through Phase 4)

- `8–15 weeks`

### Curation/editorial layer (through Phase 5)

- `10–20+ weeks` total depending polish and image/linkout complexity

Most schedule risk sits in:

- `Phase 0` (normalization + image strategy)
- `Phase 1` (import/QA)

## 13. Immediate Next Work (Recommended Order)

1. Write `Phase 0 Profiling Checklist`
2. Write `Preserve vs Normalize v1 Matrix`
3. Draft `Image Strategy v1`
4. Build profiling scripts for the actual dumps
5. Run profiling and finalize `Normalization Dictionary v1`

