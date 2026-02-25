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

### Hosting (v1)
- API + workers: `single container host` (Fly.io / Railway / Render — pick one, stick to it)
- Postgres: `managed instance` (provider-native or Neon/Supabase)
- Redis: `managed instance` (provider-native or Upstash)
- Static site: `Vercel` (existing)
- Environments: `local` → `staging` → `production`

### Non-goals (v1)
- marketplace
- compliance stack
- Discogs write-back
- open public editing
- LLM inference in the retrieval path
- Spotify/Apple Music/Bandcamp automated matching (see Media Matching Strategy)

## 2. Open Decisions (must be resolved in Phase 0)

- `Image source strategy` (dumps vs API vs Cover Art Archive vs other)
- `Image serving policy` (direct URL / proxy / cache)
- `Phase 1 QA thresholds` (numeric pass/fail criteria)
- `Phase 2 traversal scope` (how much credit/company graph in v1)
- `Public alpha rate limits` (exact numbers per IP, per key)
- `Hosting provider` (final selection from shortlist above)
- `XML parser library` (fast-xml-parser / sax-js / custom stream — benchmark needed)
- `DB access layer` (Kysely / Drizzle / raw pg — decide before schema work)
- `Migration tooling` (node-pg-migrate / Drizzle migrations / dbmate)

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
  - treat "images from dumps" as unproven / likely unavailable

### Estimated dataset scale

| Entity | Estimated rows | Notes |
|--------|---------------|-------|
| releases | ~18M | richest entity, most joins |
| artists | ~8M | includes ANVs, aliases |
| labels | ~2M | includes sublabels |
| masters | ~1.5M | links to releases |
| tracks | ~100M+ | per-release tracklists |
| credits | ~200M+ | release + track extraartists |
| identifiers | ~50M+ | barcodes, catalog numbers, matrix |
| companies | ~30M+ | pressing plants, distributors, etc. |

Estimated DB size: `200–400 GB` (data + indexes + raw payloads + FTS indexes). Needs validation in Phase 0 profiling.

---

## 4. Phase 0A: System Foundations

### Goal

Lock the system-level decisions that the data plan depends on. No code runs on vague infra.

### Tasks

#### 4.1 Application stack setup

- Initialize TypeScript project (monorepo or single package — decide)
- Fastify scaffold with `/v1/` prefix
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
- **Must run against full dataset**, not just samples
- Outputs: total counts, field presence rates, cardinality, edge-case examples, size estimates

#### 5.2 Full dataset sizing

From profiling output:
- Actual row counts per entity type (validate estimates in §3)
- Estimated disk size: data, indexes, raw JSON payloads, FTS indexes
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

- [ ] TypeScript project scaffold working end-to-end
- [ ] Infrastructure provisioned
- [ ] Schema and normalization dictionary stable enough to code importer
- [ ] Image strategy chosen with legal posture
- [ ] QA thresholds defined with numbers
- [ ] Dataset sizing validated against full dumps
- [ ] Auth schema designed
- [ ] Testing scaffold with parser fixtures
- [ ] Freshness policy documented
- [ ] Legal review completed

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
- Required entities queryable
- QA metrics meet Phase 0B thresholds
- No silent drops of required fields
- Rerun does not duplicate/corrupt data
- FTS search returns results in `< 200ms p95` for representative queries
- Import completes in reasonable time (target: `< 24 hours` for full dataset)

### Estimated time

- `2–4 weeks`

---

## 8. Phase Gate B (after Phase 1)

- [ ] Import pipeline repeatable on full dataset
- [ ] QA thresholds met (specific numbers from Phase 0B)
- [ ] No silent drops of required fields
- [ ] FTS performance acceptable
- [ ] Import time acceptable
- [ ] Auth scaffold tables present

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
