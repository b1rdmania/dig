# Dig Implementation Plan (Agent-First)

Agent-first, data-first implementation plan for `Dig` (`1–2 person team`)

## 0. Principles

- `Preserve everything raw, normalize in layers`
- `Retrieval core is the product`
- `Agent interfaces first, human UI second`
- `Images are mandatory, so image strategy is a gating workstream`
- `No silent data loss`
- `Ship infrastructure, not inference`

## 1. Locked Decisions

### Architecture
- Architecture: `modular monolith`
- Repository structure: `monorepo` (apps + packages in one repo)
- Runtime: `TypeScript + Node.js`
- API framework: `Fastify`
- MCP: `TypeScript SDK`, remote `SSE transport` (optional stdio wrapper later)
- DB: `Postgres` + `PgBouncer` (connection pooling)
- Cache/queues: `Redis` (job queues, response caching, rate limit counters)
- Search v1: `Postgres FTS + pg_trgm`
- Ingest strategy: `raw payload staging in ingest.raw_entities`
- LLM strategy: `no proxying`; Dig serves data, users bring models

### Access & Auth
- Auth v1 (public agent alpha): `no auth required for reads`, `IP rate limiting`
- API key path: `designed in Phase 0`, `scaffolded in Phase 1`, `activatable without redeploy`
- Auth for editorial (Phase 5): `session-based`, `roles/permissions designed in Phase 0`
- API versioning: `/v1/...` from day one

### Hosting (v1) — locked
- API + MCP + workers: `Fly.io`
- Postgres: `Fly Postgres` (or Neon if Fly Postgres proves painful)
- Redis: `Upstash` (managed, serverless)
- Static site / frontend: `Vercel` (existing)
- Frontend framework (Phase 4): `Next.js`
- Environments: `local` → `staging` → `production`

### Non-goals (v1)
- marketplace
- compliance stack
- Discogs write-back
- open public editing
- LLM inference in the retrieval path
- Spotify/Apple Music/Bandcamp automated matching (see Media Matching Strategy)

## 2. Open Decisions (must be resolved in Phase 0)

### Resolved
- ~~`Hosting provider`~~ → **Fly.io** (API/MCP/workers), **Fly Postgres** or Neon, **Upstash** Redis
- ~~`DB access layer`~~ → **Kysely** + node-postgres
- ~~`Migration tooling`~~ → **Kysely FileMigrationProvider**
- ~~`XML parser library`~~ → **saxes** (SAX streaming, memory-bounded) — benchmark still needed to validate
- ~~`Frontend stack`~~ → **Next.js** on Vercel (Phase 4)
- ~~`Image source strategy`~~ → **Cover Art Archive first** + fallback placeholders. Discogs/other image sources kept as explicit future decision.

### Still open
- `Image serving policy` (direct URL / proxy / cache)
- `Phase 1 QA thresholds` (numeric pass/fail criteria)
- `Phase 2 traversal scope` (how much credit/company graph in v1)
- `Public alpha rate limits` (exact numbers per IP, per key)

## 3. Current Dataset Findings (Feb 2026 dump — full profiling for artists/labels/masters, 500k sample for releases)

- `artists` (9.9M): rich graph data (`aliases` 49%, `groups` 23%, `members` 23%, `namevariations` 48%, `urls` 21%, `profile` 23%, `realname` 7%)
- `labels` (2.3M): parent/sublabel graph (11% have parent) + profiles (32%) + urls (8.6%)
- `masters` (2.5M): `main_release` 100%, genres/styles/year/title, `videos` (56%, avg 2.4 per master)
- `releases` (~18M, 500k sampled): strong metadata richness:
  - artists 100%, labels 100%, formats 100%, genres 100%, styles 97.6%
  - country 99.5%, released 97.7%, notes 70.2%
  - master_id 100%, tracklist 100% (avg 6.5 tracks)
  - extraartists 73.8% (avg 3.9 credits per release)
  - identifiers 69.5%, companies 62%, videos 61%
  - **series** 6.6% (not in original plan — defer to v2)
- `images`: **confirmed absent** across 500k releases — zero `<images>` elements found

### Actual dataset scale (profiled Feb 2026 dump)

| Entity | Actual count | Original estimate | Notes |
|--------|-------------|-------------------|-------|
| artists | 9,917,545 | ~8M | +24% higher than estimated |
| labels | 2,339,067 | ~2M | +17% |
| masters | 2,520,704 | ~1.5M | +68% — significantly higher |
| releases | ~18M | ~18M | Match (extrapolated from 500k sample) |
| tracks | ~120M | ~100M+ | ~6.5 per release |
| credits | ~70M (release) + ~50M (track) | ~200M+ | Lower than estimated |
| identifiers | ~57M | ~50M+ | Match |
| companies | ~30M+ | pressing plants, distributors, etc. |

Estimated DB size: `110–125 GB` (validated — see [Dataset Sizing Report](dataset-sizing-report.md)). Raw payloads ~61 GB uncompressed, ~20–35 GB after TOAST. A 256 GB Postgres instance provides comfortable headroom.

---

## 4. Phase 0A: System Foundations

### Goal

Lock the system-level decisions that the data plan depends on. No code runs on vague infra.

### Tasks

#### 4.1 Application stack setup

- Initialize TypeScript **monorepo** (lock this now)
- Fastify scaffold with `/v1/` prefix
- Frontend scaffold decision + bootstrap (Phase 4 app shell only; no UI work yet)
- DB access layer selection + setup
- Migration tooling selection + first migration (empty schema)
- Redis connection + basic health check
- MCP SDK integration scaffold (SSE transport)
- XML parser library benchmark (parse 100k releases from local dump, measure time + memory)
- Linting, formatting, tsconfig locked

#### 4.2 Infrastructure plan

- Select hosting provider
- Provision dev/staging Postgres + Redis
- Estimate monthly cost per phase:
  - Phase 1–3 (dev/staging): `$__/mo`
  - Phase 3 (public alpha): `$__/mo`
  - Phase 4+ (production): `$__/mo`
- CI/CD pipeline: push → test → deploy
- Local dev: docker-compose for Postgres + Redis
- Secrets management approach

#### 4.3 Auth infrastructure design

Design now, enforce later.

- `users` table (id, email, role, created_at)
- `api_keys` table (id, user_id, key_hash, label, rate_limit_tier, active, created_at)
- Roles: `public` (no key), `developer` (free key), `curator`, `admin`
- Session/token choice for editorial UI (likely JWT or session cookie)
- Rate limit tiers: `public` (IP-based, lower), `developer` (key-based, higher)
- Middleware: rate limiter reads key if present, falls back to IP
- **Not enforced in Phase 3 alpha** — but the tables exist and middleware is wired

#### 4.4 Testing strategy

- Parser tests: golden fixtures extracted from real dump XML (at least 20 per entity type, covering edge cases)
- Normalization tests: input XML → expected canonical output, run as unit tests
- Import QA regression: snapshot expected row counts + field presence after sample import
- Retrieval contract tests: known entity ID → expected JSON shape
- Integration tests: Fastify inject for API routes
- MCP tool tests: tool call → expected response shape
- CI runs all tests on push

#### 4.5 Data freshness strategy

- v1: `full monthly re-ingest` from new Discogs dump
  - staleness budget: `up to 30 days`
  - re-ingest is idempotent (Phase 1 design requirement)
  - old batch marked superseded, new batch becomes canonical
- v2 (future): supplement with Discogs API for delta enrichment between dumps
- v3 (future): real-time Discogs API polling for high-interest entities
- Document staleness posture publicly (API response headers, docs)

#### 4.6 Legal/terms review

- [ ] Read Discogs data dump license terms in full
- [ ] Confirm CC0 applies to all dump fields (or identify exceptions)
- [ ] Document image rights posture:
  - album artwork is copyrighted, not CC0
  - if using Discogs API for images: subject to API ToS
  - if using Cover Art Archive: subject to their license (generally permissive)
- [ ] Review Spotify/Apple Music/Bandcamp linking terms (for Phase 5)
- [ ] Document legal posture in a `LEGAL.md` or internal doc

### Deliverables

- Working TypeScript project scaffold with Fastify + DB + Redis + MCP SDK
- Infrastructure provisioned (at least dev/staging)
- Auth schema designed
- Testing scaffold with first fixtures
- Freshness policy documented
- Legal review completed (or blockers identified)
- Cost estimate per phase

### Done Criteria

- `npm run dev` starts API server connected to local Postgres + Redis
- At least one integration test passes in CI
- Auth tables exist in migration (not enforced)
- Team can articulate freshness policy and legal posture

### Estimated time

- `1 week` (parallel with Phase 0B start)

---

## 5. Phase 0B: Data Profiling + Normalisation Dictionary + Image Strategy

### Goal

Eliminate schema/import ambiguity before writing importer logic.

### Scope

- Profile actual dump structures and edge cases
- Define normalization rules and v1 canonical schema boundaries
- Define image acquisition strategy
- Define QA gates for Phase 1

### Tasks

#### 5.1 Profiling scripts

- `profile_releases.ts` (or `.py` — profiling scripts can be any language)
- `profile_artists.ts`
- `profile_labels.ts`
- `profile_masters.ts`
- **Artists, labels, masters**: must run against full dataset
- **Releases**: representative sample (≥500k) sufficient for Gate A; full-dataset profiling validated during Phase 1 import
- Outputs: total counts, field presence rates, cardinality, edge-case examples, size estimates

#### 5.2 Full dataset sizing

From profiling output:
- Actual row counts per entity type (validate estimates in §3)
- Estimated disk size: data, indexes, raw JSON payloads, FTS indexes
- **Raw payload storage sizing**: estimate `ingest.raw_entities` footprint separately (JSONB size, compression assumptions, retention policy impact)
- FTS index size estimate for releases + artists
- Benchmark: representative search queries against sample dataset (target: `< 200ms p95`)

#### 5.3 Normalization dictionary v1

- field mappings (XML → canonical)
- raw preservation rules
- normalized value rules
- nullability/fallback behavior
- unresolved/deferred edge cases

#### 5.4 Edge-case deep dives

- `ANV` handling
- track position parsing (vinyl sides, CD tracks, bonus tracks, hidden tracks)
- credit role parsing (free-text roles → structured role + detail)
- master/release linkage (orphan releases, multi-master)
- identifiers taxonomy (barcode, catno, matrix, ISRC, etc.)
- partial dates (`released` field: year-only, month-only, malformed)

#### 5.5 Image strategy (mandatory)

- Verify dump image absence/presence conclusively (scan full dataset, not just first 50k)
- Evaluate sources:
  - Discogs API (rate limited: 60 req/min with auth)
  - MusicBrainz / Cover Art Archive (generally permissive, variable coverage)
  - Other sources
- Define serving policy (direct URL / proxy / CDN cache)
- Define coverage KPI and launch threshold
- **Document legal posture for chosen source**
- Estimate time to backfill images for full catalog

#### 5.6 Phase 1 QA thresholds

Define numeric pass/fail criteria before importer code starts:
- Minimum entity counts (e.g., releases > 17M)
- Maximum malformed field rate (e.g., < 0.1% for required fields)
- Maximum orphan reference rate
- Required field presence rates

### Deliverables

- `Normalization Dictionary v1`
- `Schema v1` (locked for importer, as SQL migrations)
- `Preserve vs Normalize v1 Matrix`
- `Image Strategy v1`
- `Phase 1 QA Gate Spec` (with numeric thresholds)
- `Dataset Sizing Report`

### Done Criteria

- No unresolved schema-shaping issues
- No ambiguity on ANV / track positions / credits / master-release handling for v1
- QA thresholds documented with specific numbers
- Image strategy chosen (not deferred), legal posture documented
- Team agrees on what is normalized now vs later
- FTS performance benchmark run on representative sample

### Estimated time

- `1–2 weeks` (can slip to `2–3` if edge cases/images need deeper work)
- Overlaps with Phase 0A

---

## 6. Phase Gate A (after Phase 0A + 0B)

- [x] TypeScript project scaffold working end-to-end
- [x] Local/CI infrastructure provisioned (local dev: Docker Postgres + Redis; CI: GitHub Actions). Staging is deferred to Phase 1 start.
- [x] Schema and normalization dictionary stable enough to code importer (see normalization-dictionary-v1.md)
- [x] Image strategy chosen with legal posture (see image-strategy-v1.md, LEGAL.md)
- [x] QA thresholds defined with numbers (see qa-gate-spec-phase1.md)
- [x] Dataset sizing validated (full for artists/labels/masters; ≥500k sample for releases, full validated in Phase 1)
- [x] Auth schema designed (migration 001 creates auth.users + auth.api_keys)
- [x] Testing scaffold with parser fixtures (20 golden XML fixtures, 11 parser tests)
- [x] Freshness policy documented (monthly dump cadence, see implementation plan §4)
- [x] Legal review draft completed (see docs/LEGAL.md). Human sign-off still required before publication.

**If any of these are unresolved, do not proceed to Phase 1.**

---

## 7. Phase 1: Ingestion Foundation + Canonical Database

### Goal

Repeatable import pipeline from Discogs dumps into raw + canonical tables.

### Scope

- Batch tracking
- XML stream parsing
- Raw payload storage
- Canonical upserts for v1 entities
- QA reports
- Idempotent reruns

### Tasks

#### 7.1 Ingest infra tables

- `ingest.dump_batches` (batch_id, dump_date, status, started_at, completed_at, stats)
- `ingest.raw_entities` (batch_id, entity_type, discogs_id, raw_payload JSONB)
- Import run metadata/logging
- Auth scaffold tables (`users`, `api_keys`) — created but not enforced

#### 7.2 Stream parser

- Per-dump streaming XML parser for artists/labels/masters/releases
- Memory-bounded (must handle 10GB+ releases file without loading into memory)
- Error capture/logging per entity (don't abort on single malformed record)
- Progress reporting (entities/sec, % complete)

#### 7.3 Canonical v1 upserts

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

#### 7.4 Preserve long-tail fields

- raw payload always stored in `ingest.raw_entities`
- optional JSONB column on canonical tables for deferred fields

#### 7.5 QA/reconciliation

- Row counts by entity (vs QA thresholds from Phase 0B)
- Malformed field counts
- Missing reference counts (e.g., release references nonexistent master)
- Unknown enum/type buckets
- QA report generated automatically after each import run

#### 7.6 Idempotency

- Rerun same batch safely (upsert, not insert)
- Re-derive canonical from raw payloads
- New monthly batch supersedes previous (old batch retained, not deleted)

#### 7.6A Rollback / recovery strategy

- Import runs are staged by `batch_id`; a batch is not promoted to "active" until QA passes
- Keep previous successful batch marked as `active_fallback`
- If import QA fails or canonical validation fails, do **not** promote new batch
- If post-promotion issues are discovered, flip active batch pointer back to previous batch (metadata-level rollback) and re-run downstream index rebuild
- Document rollback runbook (commands + verification checks)

#### 7.7 FTS index build

- `tsvector` columns populated during canonical upsert
- `pg_trgm` indexes created
- Verify FTS query performance against Phase 0B benchmarks

### Deliverables

- Repeatable full import run (not just sample)
- Canonical DB populated with full Discogs catalog
- QA report generated per run
- FTS indexes built and queryable

### Done Criteria

- End-to-end import completes on full dataset
- Full releases profiling validated against actual import counts (closes deferred Gate A item)
- Required entities queryable
- QA metrics meet Phase 0B thresholds
- No silent drops of required fields
- Rerun does not duplicate/corrupt data
- FTS search returns results in `< 200ms p95` for representative queries
- Import completes in reasonable time (target: `< 24 hours` for full dataset)

### Estimated time

- `2–4 weeks`
- Includes rollback path implementation + runbook validation on at least one simulated failed import

---

## 8. Phase Gate B (after Phase 1)

**Status: CLOSED WITH CAVEATS (2026-02-27)**
See [Phase 1 Handoff Snapshot](phase1-handoff-snapshot.md) for full evidence.

- [x] Import pipeline repeatable on full dataset (idempotency verified, cursor-based resume)
- [x] QA thresholds met — hard failures pass; estimate-derived targets recalibrated with evidence
- [x] No silent drops of required fields (100% raw→canonical coverage all 4 entities)
- [x] FTS performance acceptable (all queries under target on Docker for Mac)
- [x] Import time acceptable (~4 hours total, well under 24h hard limit)
- [x] Auth scaffold tables present (migration 001)

**Caveat tags:**
- `CAVEAT:partial-artists` — 289k of ~9.9M artists (partial dump). Pipeline correct; data incomplete.
- `CAVEAT:recalibrated-estimates` — Identifier/company/country thresholds adjusted to match actual Discogs data. Zero data loss confirmed via random sampling (Appendix A.1).

---

## 9. Phase 2: Retrieval Core (Internal)

### Goal

Build deterministic search + entity retrieval + scoped traversal.

### Scope

- Search and retrieval only (no public API yet)
- Stable JSON contracts for downstream API/MCP/UI
- Scoped graph traversal (direct links only in v1)

### Tasks

#### 9.1 Search v1

- `tsvector` indexes (built in Phase 1)
- `pg_trgm` for fuzzy matching
- Search ranking heuristics (exact > prefix > fuzzy)
- Multi-entity search (releases, artists, labels, masters)
- Filter support (genre, style, year, country, format, label)
- Pagination (cursor-based, not offset)
- Lock and benchmark against `docs/phase2-search-benchmark-suite.md` before exposing endpoints

#### 9.2 Entity retrieval services

- artist (with aliases, groups, members, name variations)
- label (with parent/sublabel hierarchy)
- master (with linked releases)
- release (with tracks, credits, formats, identifiers, companies, videos)

#### 9.3 Traversal v1 scope

Direct graph links only:
- artist → releases/masters
- label → releases/masters
- release/master → credits (extraartists)
- credit/person → linked releases (direct links only)
- release → companies
- release → master (and reverse)
- **Deferred**: multi-hop traversal, inferred connections

#### 9.4 Response shape

- Provenance fields (source: discogs, dump_date, discogs_id)
- Confidence/relevance scores on search results
- Stable JSON schemas (documented, versioned)
- Consistent error format across all endpoints

#### 9.5 Ops hooks

- Request timing (per-route latency)
- Query logging (what people search for)
- Rate limit middleware (reads API key if present, falls back to IP)
- Redis-backed rate limit counters

### Explicit v1 deferrals

- Advanced semantic graph ranking
- Inferred entity resolution beyond deterministic mappings
- Complex role ontology expansion beyond parsed/raw support
- Multi-hop relationship traversal

### Deliverables

- Internal retrieval module/service
- Stable JSON contracts (documented)
- Search latency baseline on full dataset
- Rate limit middleware wired (not enforced on public yet)
- Phase 2 benchmark results recorded (latency + query envelope decisions)

### Done Criteria

- Deterministic results for repeated queries
- Entity retrieval can power UI and MCP without extra logic
- Traversal scope documented and tested
- Search p95 latency `< 200ms` on full dataset
- Rate limit middleware works (tested with API key + IP fallback)

### Estimated time

- `2–3 weeks`

---

## 10. Phase Gate C (after Phase 2)

- [ ] Retrieval contracts stable and documented
- [ ] Traversal scope constrained and working
- [ ] Search latency acceptable on full dataset
- [ ] Rate limit middleware functional
- [ ] JSON response schemas documented

---

## 11. Phase 3: REST API + MCP Public Alpha (Agent-First)

### Goal

Ship agent-usable public utility before the human UI.

### Decisions (locked)

- No auth required for reads
- IP rate limiting + optional API key from day one
- All endpoints under `/v1/`
- MCP server: remote SSE transport

### Tasks

#### 11.1 REST endpoints v1

- `GET /v1/search`
- `GET /v1/artists/:id`
- `GET /v1/labels/:id`
- `GET /v1/masters/:id`
- `GET /v1/releases/:id`
- `GET /v1/releases/:id/media-links` (Discogs videos + curated links only in v1)

#### 11.2 MCP server (SSE transport)

- Remote SSE server using TypeScript MCP SDK
- MCP tools backed by same retrieval services as REST:
  - `search_catalog`
  - `get_release`
  - `get_master_release`
  - `get_artist`
  - `get_label`
  - `get_related_releases`
  - `explain_relationships` — **structured payload only** (shared labels, shared credits, shared companies, style overlap, lineage paths — no LLM text generation)
  - `create_crate_draft` (draft/read-only semantics)
- Connection lifecycle: SSE keepalive, timeout after inactivity, max concurrent connections
- MCP and REST hit the same domain services — no divergence

#### 11.3 Public alpha protections

- IP rate limits (default tier)
- Optional API key for higher tier
- Request logging (route, latency, status, IP/key)
- Abuse visibility (dashboard or log query)
- `X-RateLimit-*` response headers

#### 11.4 Docs and examples

- curl examples for every endpoint
- MCP config examples (Claude Desktop, Claude Code, generic)
- Response schema documentation
- Error format documentation
- Staleness/freshness disclosure in docs

#### 11.5 Error/contract quality

- Stable error format: `{ error: { code, message, details? } }`
- Response examples with provenance/confidence
- `X-Dig-Dump-Date` header on every response (data freshness signal)

### Deliverables

- Public REST alpha at `/v1/`
- Open MCP alpha (SSE)
- Docs/examples
- Rate limiting active

### Done Criteria

- External user can self-serve usage from docs
- MCP connection works in Claude Desktop and Claude Code
- Rate limits active and observable
- Response schemas stable enough for client integration
- Staleness disclosed (header + docs)

### Estimated time

- `1–2 weeks`

---

## 12. Phase Gate D (after Phase 3)

- [ ] Public alpha operable without manual babysitting
- [ ] Rate limiting/logging functioning
- [ ] Docs usable (external user can self-serve)
- [ ] MCP works in at least two agent environments
- [ ] Staleness disclosure in place

---

## 13. Phase 4: Human Search UI (Mobile-First)

### Goal

Ship the human experience on top of the same retrieval core.

### Scope

- Search/browse only
- No marketplace
- Mobile-first interaction quality

### Tasks

#### 13.1 Search UI

- Query entry
- Filters / chips (genre, style, year, country, format, label)
- Result grouping (releases, artists, labels)
- "Why matched" cues if feasible
- Recent/popular searches (anonymous, from query logs)

#### 13.2 Entity pages

- Release (tracklist, credits, formats, identifiers, companies, videos)
- Master (linked releases/pressings)
- Artist (bio, discography, aliases, group membership)
- Label (catalog, sublabels, parent)

#### 13.3 Cross-linked navigation

- Click artists/labels/credits/companies and traverse
- Breadcrumb or back-path for deep traversal

#### 13.4 Images (mandatory)

- Integrate chosen image strategy
- Placeholders/fallbacks for missing images
- Coverage monitoring (% of displayed entities with images)

#### 13.5 Performance/caching

- Payload trimming (list views vs detail views)
- Redis response caching
- Mobile tuning (image sizes, lazy loading, minimal JS)

### Deliverables

- Mobile-first human search product
- Cross-linked record/entity browsing

### Done Criteria

- Search → record page → deeper traversal works reliably
- UI uses `/v1/` API responses directly (no duplicated business logic)
- Images display per coverage strategy
- Mobile UX meets internal quality bar
- Page load `< 2s` on 3G (key pages)

### Estimated time

- `2–4 weeks`

---

## 14. Phase Gate E (after Phase 4)

- [ ] Human UI is clearly useful and mobile-friendly
- [ ] API/UI parity maintained
- [ ] Image coverage meets threshold
- [ ] Performance targets met

---

## 15. Phase 5: Curation / Crates / Editorial

### Goal

Add differentiated human and agent-compounding layer.

### Scope

- Approved contributors only (auth enforced)
- Curation + context + linkouts
- No open wiki edits in v1

### Tasks

#### 15.1 Auth enforcement

- Enable auth for write operations
- Curator/admin login flow
- API key management UI for developers

#### 15.2 Curator profiles

#### 15.3 Crate/list pages

- Record lists with intent/description
- Ordered, linkable, shareable
- Exposed via API + MCP

#### 15.4 Editorial notes with provenance

- Per-entity notes from approved contributors
- Attribution (who wrote it, when)
- Versioning (edit history)

#### 15.5 Approved contributor workflow

- Invite/approval flow
- Moderation queue
- Publishing workflow (draft → review → published)

#### 15.6 Linkouts (v1: manual/curated only)

- Discogs (direct, always available via discogs_id)
- Embedded videos (from Discogs video data)
- Spotify / Apple Music / Bandcamp: **curated/manual links only in v1**
- Display with "where available" qualifier

#### 15.7 Minimal editorial tooling

- Create/edit/publish crate
- Create/edit/publish editorial note
- Moderation/approval dashboard

### Deliverables

- Curated crates (browsable + API/MCP accessible)
- Editorial notes with provenance
- Contributor workflow
- Auth enforced for writes

### Done Criteria

- Approved contributor can publish crate + notes + links
- Users can navigate curated content
- Provenance visible/retained for editorial entries
- Crates accessible via MCP (`get_crate`, `list_crates`)

### Estimated time

- `2–4+ weeks`

---

## 16. Cross-Cutting Workstreams

### 16.1 Image Strategy (Mandatory)

Parallel planning/build track spanning Phases 0–4.

Must define:
- Source of image metadata/assets
- Serving policy (direct/proxy/CDN cache)
- Refresh/validation behavior
- **Legal/terms posture** (images are copyrighted, not CC0)
- Launch coverage threshold
- Backfill timeline estimate

Metrics:
- `% releases with valid primary image`
- Image fetch failure rate
- Placeholder rate on top queries

### 16.2 Media Matching Strategy

Separate workstream, not on the critical path for v1.

- **v1**: Discogs videos (from dump data) + manual/curated links
- **v2** (future): automated matching pipeline
  - ISRC codes as primary key (where available in identifiers)
  - Title + artist fuzzy match as fallback
  - MusicBrainz as bridge dataset
  - Confidence scoring per match
  - Coverage monitoring
- **Marketing alignment**: site should say "where available / confidence-scored" not promise universal coverage

### 16.3 Preserve vs Normalize Matrix

For each field/group:
- Preserve raw: `yes/no`
- Canonicalize v1: `yes/no`
- Defer normalization: `yes/no`
- Notes/rationale

Prevents over-normalization while protecting future feature optionality.

### 16.4 Observability

From Phase 1 onward:
- Import job logs (duration, entity counts, errors)
- Parser errors (per-entity, not just per-run)
- API request/error logs (route, latency, status, IP/key)
- Rate-limit events
- Query latency (p50, p95, p99)
- Search query logs (what people look for — anonymized)
- Image fetch failures (later)
- MCP connection lifecycle (connects, disconnects, errors)

### 16.5 Monitoring & Alerts

- Uptime monitoring for API + MCP endpoints
- Alert on error rate spike
- Alert on latency degradation
- Alert on rate limit exhaustion patterns
- Disk space monitoring (Postgres + images)

### 16.6 Compatibility & Evolution Policy

Future-proofing depends on stable contracts and controlled schema evolution.

#### API / MCP contract policy

- Public API is versioned from day one: `/v1/...`
- MCP tool names and response schemas are treated as versioned contracts
- Additive changes are preferred (new optional fields over breaking changes)
- Breaking changes require:
  - new API version (`/v2`)
  - MCP tool version suffix or new tool name
  - migration notes in docs
- Responses must keep provenance/confidence fields stable in meaning across patch releases

#### Canonical schema evolution policy

- Canonical schema may evolve as normalization improves, but:
  - raw payloads remain the source of re-derivation
  - migrations are required for schema changes
  - normalization rule changes must be documented in `Normalization Dictionary`
- Ambiguous fields should preserve both:
  - raw value
  - normalized helper value (when introduced)
- Schema changes that alter retrieval semantics require:
  - QA rerun on representative sample
  - retrieval contract regression check

#### Import batch compatibility policy

- Imports are batch-versioned (`batch_id`) and promotable only after QA pass
- New import logic must support re-running prior dumps during debugging
- Rollback path must remain operational after schema changes (tested during Phase 1 hardening)

---

## 17. Phase Gates (Summary)

| Gate | After | Key criteria |
|------|-------|-------------|
| A | Phase 0A + 0B | System scaffold working, schema stable, image strategy chosen, legal reviewed |
| B | Phase 1 | Import repeatable on full dataset, QA thresholds met |
| C | Phase 2 | Retrieval contracts stable, search latency acceptable |
| D | Phase 3 | Public alpha operable, docs usable, MCP working |
| E | Phase 4 | Human UI useful and mobile-friendly |

---

## 18. Timeline (1–2 Person Team)

### System foundations + data profiling (Phase 0A + 0B)

- `1–3 weeks` (run in parallel where possible)

### Agent alpha (through Phase 3)

- `7–12 weeks` best case
- `9–16 weeks` safer planning

### Human search MVP (through Phase 4)

- `9–16 weeks` best case
- `11–20 weeks` safer planning

### Curation/editorial layer (through Phase 5)

- `11–24+ weeks` total depending on polish and image/linkout complexity

### Most schedule risk sits in

- `Phase 0B` (normalization + image strategy + legal)
- `Phase 1` (import/QA on full dataset)
- `Image backfill` (depends on source and rate limits)

---

## 19. Marketing-to-Scope Alignment

The marketing site currently promises some things that aren't scoped until later phases. This is acceptable for vision-setting, but the following should be qualified on the site before public alpha:

| Site promise | Actual scope | Recommendation |
|-------------|-------------|----------------|
| "Stream it on Spotify. Buy it on Discogs. Pay the artist on Bandcamp." | v1: Discogs videos + curated links only. Automated matching is v2+. | Add "where available" qualifier |
| Record page images | Depends on image strategy. Coverage may be partial at launch. | Acceptable if placeholder strategy is solid |
| "Fully open MCP. No keys, no signup." | True for v1 alpha. Key path designed but not required. | Accurate — keep |
| Crates from "selectors, label heads, radio hosts" | Phase 5. Requires auth + editorial tooling. | Fine as vision. Not available at alpha. |
| "Confidence scores" on streaming links | Requires automated matching pipeline (v2+). | Soften to "where available, confidence-scored" |

---

## 20. Immediate Next Work (Recommended Order)

### Phase 0A (system)
1. Initialize TypeScript project with Fastify scaffold
2. Set up docker-compose for local Postgres + Redis
3. Select and configure DB access layer + migrations
4. Design auth schema (tables + roles)
5. Set up CI with test runner
6. Select hosting provider, provision staging

### Phase 0B (data) — can start in parallel
1. Write profiling scripts (run against full dataset)
2. Write `Preserve vs Normalize v1 Matrix`
3. Draft `Image Strategy v1` (with legal posture)
4. Run profiling and finalize `Normalization Dictionary v1`
5. Run FTS benchmark on representative sample
6. Finalize `Phase 1 QA Gate Spec` with numeric thresholds
7. Complete legal/terms review

---

## 21. Phase 0A/0B Weekly Execution Checklist (1–2 Person Team)

This is the execution version of Phase 0. It is designed to produce a `go/no-go` decision for Phase 1 (full importer implementation).

### Owner model

- `Owner A` = backend/system lead (API scaffold, infra, DB, Redis, CI)
- `Owner B` = data/profiling lead (dump profiling, normalization dictionary, image strategy)
- `Solo mode` = do `Owner A` items first in each week, then `Owner B` items, and cut optional tasks if blocked

### Week 1 (Foundations boot + profiling setup)

#### Owner A (system)
- [ ] Initialize TypeScript monorepo (`apps/api`, `apps/mcp`, `packages/domain`, `packages/db`)
- [ ] Fastify API scaffold with `/v1/health`
- [ ] Local `docker-compose` for Postgres + Redis
- [ ] Choose DB layer + migration tool and create first migration
- [ ] Add CI pipeline (lint + typecheck + tests)
- [ ] Add basic test runner and one passing smoke test

#### Owner B (data)
- [ ] Create profiling script skeletons for `artists`, `labels`, `masters`, `releases`
- [ ] Define profiling output format (JSON + markdown summary)
- [ ] Run small sanity profiles on each dump type (field presence + sample records)
- [ ] Start `Preserve vs Normalize v1 Matrix` template
- [ ] Start `Normalization Dictionary v1` template (headers only)

#### Shared checkpoints (end of week)
- [ ] Repo boots locally (`npm run dev`) with Postgres + Redis connected
- [ ] Profiling scripts run on all dump types (even if only partial outputs)
- [ ] Monorepo/package boundaries accepted (no churn into Week 2)

### Week 2 (System decisions + full profiling pass)

#### Owner A (system)
- [ ] Finalize hosting provider choice (API/workers, Postgres, Redis)
- [ ] Provision staging services
- [ ] Add environment config/secrets handling
- [ ] MCP SDK scaffold with SSE transport and one dummy tool
- [ ] Define auth schema (`users`, `api_keys`) and create migrations
- [ ] Write initial integration test (Fastify route via inject)

#### Owner B (data)
- [ ] Run profiling scripts against full dumps (or resumable segmented runs)
- [ ] Produce first `Dataset Sizing Report` (rows + storage estimates)
- [ ] Benchmark XML parser candidates on release dump segment (time + memory)
- [ ] Profile image field presence/absence across full releases dump
- [ ] Extract edge-case samples for ANV, credits, track positions, identifiers

#### Shared checkpoints (end of week)
- [ ] Hosting and runtime stack are locked
- [ ] Auth scaffolding decision is documented
- [ ] Full-dataset profiling outputs exist (not just samples)
- [ ] Image source question is narrowed to concrete options

### Week 3 (Normalization decisions + image/legal strategy)

#### Owner A (system)
- [ ] Add rate limiting middleware scaffold (IP + optional API key path)
- [ ] Add request logging + basic metrics hooks
- [ ] Create parser fixture test harness (golden XML fixtures)
- [ ] Document freshness strategy and batch supersession model
- [ ] Draft rollback metadata design for import batches (to support Phase 1 rollback)

#### Owner B (data)
- [ ] Draft `Normalization Dictionary v1` using profiled edge cases
- [ ] Finalize `Preserve vs Normalize v1 Matrix`
- [ ] Draft `Image Strategy v1`:
  - [ ] source
  - [ ] serving policy
  - [ ] legal posture
  - [ ] coverage KPI / launch threshold
  - [ ] backfill estimate
- [ ] Draft `Phase 1 QA Gate Spec` with numeric thresholds
- [ ] Run FTS benchmark on representative sample and record p95

#### Shared checkpoints (end of week)
- [ ] Phase 0 artifacts exist in draft form
- [ ] QA thresholds are numeric, not qualitative
- [ ] Image strategy is chosen or escalated as blocker
- [ ] Legal/terms review status is explicit (`complete` / `blocked` / `needs counsel`)

### Week 4 (Phase Gate A closeout / go-no-go)

#### Owner A (system)
- [ ] Harden scaffolds (API, MCP, DB, Redis) enough for importer work to begin
- [ ] Validate CI runs parser + integration tests
- [ ] Finalize infra cost estimates by phase
- [ ] Finalize local/staging runbooks (setup + deploy + rollback outlines)

#### Owner B (data)
- [ ] Finalize `Normalization Dictionary v1`
- [ ] Finalize `Dataset Sizing Report`
- [ ] Finalize `Image Strategy v1`
- [ ] Finalize `Phase 1 QA Gate Spec`
- [ ] Finalize `Preserve vs Normalize v1 Matrix`

#### Shared Gate A review (must pass before Phase 1)
- [ ] `Phase 0A` done criteria all pass
- [ ] `Phase 0B` done criteria all pass
- [ ] Open decisions section is reduced to Phase 1+ deferrals only
- [ ] Risks register updated with Phase 1 import/QA risks
- [ ] Decide `GO / NO-GO` for full importer implementation

### Solo mode compression (if one person, 2–4 weeks)

- Week 1: System scaffold + profiling skeletons
- Week 2: Full profiling + stack/hosting/auth decisions
- Week 3: Normalization dictionary + image strategy + QA thresholds
- Week 4: FTS benchmark + legal review + Gate A closeout

If constrained, cut in this order:
1. Optional MCP dummy tool polish (keep scaffold only)
2. Non-critical metrics/alerting setup (keep basic logging)
3. Cost estimate precision (keep ballpark by phase)

Do **not** cut:
- full-dataset profiling
- normalization dictionary
- image strategy
- QA thresholds
- rollback design metadata for Phase 1
