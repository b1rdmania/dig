# Dig — Claude Code Project Guide

## What is this?
Dig is a **scene browser for house & techno (1985–2008)** built on the Discogs CC0 catalog: a scoped, master-first discovery product. Search and browse artists, labels, masters, and curated scenes; deep pressing detail links out to Discogs. Public REST API + Next.js frontend. No LLM inference in the retrieval path — deterministic, structured data only.

It is deliberately **not** a full Discogs mirror. The full-catalog posture was retired (see `docs/executive-summary-master-first-reset.md`); release/version pages are gone, release URLs 301/410 to masters.

Execution authority:
- `docs/operating-implementation-guide.md` (day-to-day operating rules)
- `docs/ops-runbook.md` (incident and deploy procedure)
- `docs/canonical-docs.md` (doc precedence map)

## Architecture
- **Monorepo** (pnpm workspaces): `apps/` and `packages/`
- **Apps**: `apps/api` (Fastify REST), `apps/web` (Next.js frontend), `apps/ingest` (Discogs XML import CLI), `apps/mcp` (MCP SSE server — ARCHIVED, source frozen)
- **Packages**: `packages/db` (Kysely + migrations), `packages/domain` (shared retrieval services)
- All apps import from `@dig/domain` for business logic — no framework code in domain

### Data pipeline (the part that matters)
The production database is a **scoped artifact**, rebuilt offline per Discogs dump cycle:

```
Discogs XML dump (monthly)
  → apps/ingest CLIs → full staging catalog (LOCAL Docker PG only — never deployed)
  → scripts/build-scoped-db.ts + packages/db/scope-manifests/*.json
  → scoped scene DB (masters/artists/labels + release_shadow + credit layer)
  → restore to dig-db-scene (Fly, LHR) + search_vector backfill + ANALYZE
```

Scope manifests (`packages/db/scope-manifests/`) are the product's most important config: style allowlists, era bounds, tier-1 labels. The 15 curated scenes live in `packages/db/seeds/scenes_v1.json`.

Entity model: `artist | label | master` are the only public entities. `release_shadow` is internal plumbing (release→master redirects, cover art, notable versions). There is no release-level search and no release pages.

## Tech Stack (locked)
- Runtime: TypeScript + Node.js (ES2022, Bundler module resolution)
- API: Fastify · DB: Postgres + Kysely (no ORM) · Cache: Redis (ioredis), Upstash in prod
- Search: Postgres FTS + pg_trgm (weighted tsvectors; master-first ranking in `packages/domain/src/search.ts`)
- XML parsing: saxes (SAX streaming, memory-bounded)
- Test: Vitest · Lint: ESLint flat config at root (`pnpm lint`) · Package manager: pnpm v10.27+
- Hosting: Fly.io (`dig-api`, `dig-web`, `dig-db-scene`), Upstash Redis
- Images: Cover Art Archive + harvested entity images + fallback placeholders

## Live URLs
- **Frontend**: https://app.dig.baby (Fly `dig-web`) — currently in maintenance gate (`apps/web/src/lib/maintenance.ts`)
- **API**: https://dig-api.fly.dev/ — suspended during maintenance
- **Health**: https://dig-api.fly.dev/v1/health
- **Marketing**: https://dig.baby (Vercel)
- **GitHub**: https://github.com/b1rdmania/dig
- **MCP**: ARCHIVED 2026-04-16 — source in `apps/mcp/`, revival notes in `apps/mcp/README.md`

## Key Commands
- `pnpm dev` — start API server · `pnpm dev:web` — Next.js frontend (port 3002)
- `pnpm test` / `pnpm typecheck` / `pnpm lint` — all gate CI
- `docker compose up -d` — local Postgres (5433) + Redis
- `DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm --filter @dig/db migrate:up`
- `DATABASE_URL=... pnpm --filter @dig/api test` — includes integration suite (skips without DATABASE_URL)
- `pnpm exec tsx scripts/build-scoped-db.ts` — scoped artifact build (see script header for phases/resume)
- `fly deploy --config fly.api.toml --remote-only` / `fly deploy --config fly.web.toml --remote-only`

## Database
- Schemas: `auth`, `ingest`, `catalog`, `enrich`
- Migrations: `packages/db/migrations/` (001–032), CI-gated by `scripts/migration-parity-audit.ts`
- Schema types: `packages/db/src/schema.ts`
- Local: `postgresql://dig:dig_local@localhost:5433/dig` (Docker PG, port 5433)
- Production: `dig-db-scene` (Fly LHR, shared-cpu-2x/2GB, 10GB volume)
- `dig-db` (old 300GB full-catalog instance) is decommissioned — full catalog is rebuilt locally from dumps when needed
- Fly proxy: `fly proxy 15432:5432 -a dig-db-scene`
- Batch model: every catalog row carries `batch_id`; `getBatchForTable` resolves the active batch (60s cache). Re-ingests must use a fresh batch_id (child tables are insert-only, `onConflict doNothing`)

## Conventions
- API routes under `/v1/` prefix always
- Search types: `artist | label | master` only — anything else 400s at the route edge
- Cursor-based pagination, not offset
- Every response includes provenance (source, dump_date, discogs_id)
- Error format: `{ error: { code, message, details? } }`
- Error codes: INVALID_REQUEST, NOT_FOUND, GONE, QUERY_TIMEOUT, RATE_LIMITED, UNAUTHORIZED, INTERNAL_ERROR
- No LLM inference in the retrieval path — structured data only
- Workspace packages export from `src/` directly (not `dist/`) during development
- Rate limits: anonymous 180/min (IP), keyed 1000/min — `apps/api/src/app.ts` `RATE_LIMITS` is the source of truth; keys validated against the `API_KEYS` env (unknown keys silently downgrade to anonymous)
- Ops endpoints (`/v1/usage/internal`, `/v1/seo/cohort`) require a valid API key; `/v1/ask` requires `LLM_BETA_KEYS` and fails closed
- Shared route helpers (parseDiscogsId, withTimeout, timeout replies): `apps/api/src/routes/v1/util.ts`

## File Layout
```
apps/api/                  — Fastify REST API server (port 3000)
apps/api/src/app.ts        — app factory (rate-limit, CORS, logging, routes)
apps/api/src/auth.ts       — API key validation (API_KEYS env)
apps/api/src/routes/v1/ask/ — in-product Claude chat (auth/tools/binding/loop)
apps/web/                  — Next.js frontend (maintenance gate in src/lib/maintenance.ts)
apps/ingest/               — Discogs XML import pipeline (CLI, local staging only)
apps/mcp/                  — MCP SSE server (ARCHIVED)
packages/db/               — Kysely DB layer, migrations, schema, scope manifests, seeds
packages/domain/           — Shared domain services (search, retrieval, traversal, credits, scenes)
scripts/build-scoped-db.ts — scoped artifact builder (the real production pipeline)
scripts/                   — CI gates (migration parity, regression smoke, no-dead-ends), harvesters
docs/                      — strategy, runbooks, gate closeouts (see canonical-docs.md)
eslint.config.mjs          — workspace lint config
fly.api.toml / fly.web.toml — Fly configs (fly.mcp.toml retained but archived)
docker-compose.yml         — local Postgres + Redis
```

## Current State (2026-06)
- Product repositioned as the house & techno scene browser; maintenance gate live until relaunch
- Scoped catalog: 1985–2008, 15 curated scenes, close-collaborators v2, label essentials, entity images
- Full-catalog cutover COMPLETE in code: release search type, heavy-lane machinery, and dead response fields removed; release URLs resolve via `release_shadow` → 301/410
- Security hardening landed: validated API keys, fail-closed rate limiting and ops endpoints, credential scrub
- Old full-catalog infra (`dig-db`, 300GB) decommissioned; `dig-db-scene` (10GB, LHR) is the only production DB
- Known follow-ups: search v2 (simple-config name vectors, prefix/typeahead lane), telemetry-driven ranking review, MCP revival decision

## MCP Tools (frozen at archive — `apps/mcp/src/server.ts`)
`search_catalog`, `get_artist`, `get_label`, `get_master`, `get_release`, `traverse_links`.
The in-product chat (`apps/api/src/routes/v1/ask/`) wraps the same tools plus `list_scenes`, `get_scene`, `get_label_essentials` (never ported to MCP before archive).

## Important References
- [Operating Guide](docs/operating-implementation-guide.md) — canonical execution workflow
- [Canonical Docs Map](docs/canonical-docs.md) — doc precedence and usage
- [Master-First Reset](docs/executive-summary-master-first-reset.md) — why the scoped pivot happened
- [Quickstart](docs/quickstart.md) — API reference with curl examples
- [Response Contracts](docs/phase2-response-contracts.md) — locked JSON shapes
- [Ops Runbook](docs/ops-runbook.md) — incident triage, deployment, rollback
- [Rate-Limit Policy](docs/rate-limit-policy.md) — tier definitions
- [Operator Guide](docs/OPERATOR.md) — how Claude Code runs this project
