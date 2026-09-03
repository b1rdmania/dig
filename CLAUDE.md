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
- **Apps**: `apps/api` (Fastify REST), `apps/web` (Next.js frontend), `apps/ingest` (Discogs XML import CLI), `apps/mcp` (live Dig MCP, scale-to-zero)
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
- Hosting: Fly.io (`dig-api`, `dig-web`, `dig-mcp`, `dig-db-scene`) — **all in `lhr`**, co-located so queries don't cross the Atlantic. Upstash Redis
- Prod process: `pnpm --filter <app> serve` (`tsx`), NOT `dev` (`tsx watch`). There is no compiled `dist/` — `@dig/db` and `@dig/domain` export raw `src/*.ts`
- Images: Cover Art Archive + harvested entity images + fallback placeholders

## Live URLs
- **Frontend**: https://app.dig.baby (Fly `dig-web`) — LIVE. `MAINTENANCE_MODE = false` in `apps/web/src/lib/maintenance.ts`
- **API**: https://dig-api.fly.dev/ — LIVE
- **Health**: https://dig-api.fly.dev/v1/health
- **Marketing**: https://dig.baby (Vercel)
- **GitHub**: https://github.com/b1rdmania/dig
- **MCP**: LIVE (revived 2026-07-26) — `https://dig-mcp.fly.dev/sse`, scales to zero when idle; see `apps/mcp/README.md`

## Key Commands
- `pnpm dev` — start API server · `pnpm dev:web` — Next.js frontend (port 3002)
- `pnpm test` / `pnpm typecheck` / `pnpm lint` — all gate CI
- `docker compose up -d` — local Postgres (5433) + Redis
- `DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm --filter @dig/db migrate:up`
- `DATABASE_URL=... pnpm --filter @dig/api test` — includes integration suite (skips without DATABASE_URL)
- `pnpm exec tsx scripts/build-scoped-db.ts` — scoped artifact build (see script header for phases/resume)
- `fly deploy --config fly.api.toml --remote-only` / `fly deploy --config fly.web.toml --remote-only`

## Infra invariants (do not break these)
- **`dig-web` calls the API over its PUBLIC url** (`https://dig-api.fly.dev`), not
  `dig-api.internal`. Private Fly networking bypasses the fly-proxy and will not wake
  a stopped/suspended machine, but `.internal` DNS still hands out its IP — so callers
  hang until they time out. This produced 26–90s label pages (fixed 2026-07-31). If you
  ever reintroduce `.internal`, `dig-api` must have `auto_stop_machines = "off"`.
- **All apps live in `lhr`** with `dig-db-scene`. `primary_region` only governs NEW
  machine placement; moving an app means `fly machine clone <id> --region lhr` then
  destroying the old machine, not a redeploy.
- **`digFetch` has a 5s timeout + one retry** (`apps/web/src/lib/api.ts`). Page fan-out
  multiplies it, so raising it makes slow calls hang renders rather than fail fast.
- **`dig-web` runs TWO machines at 2GB each** (`min_machines_running = 2`). It ran one
  1GB machine until 2026-08-07, which produced a four-hour full outage: the machine
  wedged, its shallow `/api/health` started timing out at 5s, the check went critical,
  and the proxy had nothing else to route to (`PR01 no known healthy instances`). The
  same machine had already been OOM-killed (exit 137) on 2026-08-05. Two machines mean
  the proxy sheds a wedged one instead of the site going down; do not scale back to one.
- **`dig-api` still runs a SINGLE machine** — that redundancy gap is open. Each app has
  a Fly health check (`/v1/health` and `/api/health`); keep the web one shallow so an
  API outage can't cascade into Fly restarting healthy web machines. Note Fly does NOT
  auto-restart on a failing service check — a wedged machine stays wedged until someone
  runs `fly machine restart`.
- **`robots.ts` is load-bearing, not just SEO.** ~80k master pages plus artist and label
  pages are server-rendered per request, so an unthrottled crawler walking entity IDs is
  the cheapest way to take dig-web down. Search and assistant crawlers are allowed (with
  crawl-delay where honoured), bulk extractors are disallowed, everything else is
  throttled. The sitemaps exist so crawlers read the canonical list instead of guessing
  IDs. Caveat: crawler traffic was never confirmed as the 2026-08-07 trigger — Fly proxy
  logs carry no user-agent and the app doesn't log requests. Log user-agents before
  treating the bot theory as diagnosed.

## Database
- Schemas: `auth`, `ingest`, `catalog`, `enrich`
- Migrations: `packages/db/migrations/` (001–033), CI-gated by `scripts/migration-parity-audit.ts`
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
- Ops endpoints (`/v1/usage/internal`, `/v1/seo/cohort`) require a valid API key; `/v1/ask` accepts private beta keys and admits capped keyless Record Bore traffic only when `ASK_PUBLIC=on`
- Shared route helpers (parseDiscogsId, withTimeout, timeout replies): `apps/api/src/routes/v1/util.ts`

## File Layout
```
apps/api/                  — Fastify REST API server (port 3000)
apps/api/src/app.ts        — app factory (rate-limit, CORS, logging, routes)
apps/api/src/auth.ts       — API key validation (API_KEYS env)
apps/api/src/routes/v1/ask/ — provider-switchable grounded chat (auth/tools/binding/loop)
apps/web/                  — Next.js frontend (maintenance gate in src/lib/maintenance.ts)
apps/ingest/               — Discogs XML import pipeline (CLI, local staging only)
apps/mcp/                  — live Dig MCP (Streamable HTTP + legacy SSE)
packages/db/               — Kysely DB layer, migrations, schema, scope manifests, seeds
packages/domain/           — Shared domain services (search, retrieval, traversal, credits, scenes)
scripts/build-scoped-db.ts — scoped artifact builder (the real production pipeline)
scripts/                   — CI gates (migration parity, regression smoke, no-dead-ends), harvesters
docs/                      — strategy, runbooks, gate closeouts (see canonical-docs.md)
eslint.config.mjs          — workspace lint config
fly.api.toml / fly.web.toml / fly.mcp.toml — Fly configs
docker-compose.yml         — local Postgres + Redis
```

## Current State (2026-06)
- Product repositioned as the house & techno scene browser; maintenance gate live until relaunch
- Scoped catalog: 1985–2008, 15 curated scenes, close-collaborators v2, label essentials, entity images
- Full-catalog cutover COMPLETE in code: release search type, heavy-lane machinery, and dead response fields removed; release URLs resolve via `release_shadow` → 301/410
- Security hardening landed: validated API keys, fail-closed rate limiting and ops endpoints, credential scrub
- Old full-catalog infra (`dig-db`, 300GB) decommissioned; `dig-db-scene` (10GB, LHR) is the only production DB
- Search v2 LIVE (migration 033, applied to dig-db-scene): 'simple'-config vectors (stop-word names like "Them" searchable), prefix-matched last token for typeahead, lower(trim(name)) top-match indexes, exact cursor pagination
- Search telemetry loop: `/v1/events` rolls search_submitted/search_result_clicked into `enrich.search_quality_daily`; run `scripts/search-quality-report.ts` to get zero-result rate + CTR before re-tuning ranking constants
- Known follow-ups: telemetry-driven ranking review once relaunch traffic accrues, MCP revival decision

## MCP Tools (`apps/mcp/src/server.ts`, revived 2026-07-26)
`search_catalog`, `get_artist`, `get_label`, `get_master`, `get_release_shadow`, `traverse_links`, `list_scenes`, `get_scene`, `get_label_essentials` (+ deprecated `get_release` → GONE).
The in-product chat (`apps/api/src/routes/v1/ask/`) wraps the same domain layer; its LLM is provider-switchable — server-side OpenRouter (Kimi, `OPENROUTER_API_KEY` + `LLM_MODEL`) or BYO-Anthropic-key fallback.

## Important References
- [Operating Guide](docs/operating-implementation-guide.md) — canonical execution workflow
- [Canonical Docs Map](docs/canonical-docs.md) — doc precedence and usage
- [Master-First Reset](docs/executive-summary-master-first-reset.md) — why the scoped pivot happened
- [Quickstart](docs/quickstart.md) — API reference with curl examples
- [Response Contracts](docs/phase2-response-contracts.md) — locked JSON shapes
- [Ops Runbook](docs/ops-runbook.md) — incident triage, deployment, rollback
- [Rate-Limit Policy](docs/rate-limit-policy.md) — tier definitions
- [Operator Guide](docs/OPERATOR.md) — how Claude Code runs this project
