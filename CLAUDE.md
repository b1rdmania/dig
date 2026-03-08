# Dig — Claude Code Project Guide

## What is this?
Dig is a music data layer and search platform built on the Discogs CC0 catalog. REST API + MCP for agents, mobile-first search UI for humans.

Execution authority:
- `docs/operating-implementation-guide.md` (day-to-day operating rules)
- `docs/ops-runbook.md` (incident and deploy procedure)
- `docs/canonical-docs.md` (doc precedence map)

## Architecture
- **Monorepo** (pnpm workspaces): `apps/` and `packages/`
- **Apps**: `apps/api` (Fastify REST), `apps/mcp` (MCP SSE server), `apps/ingest` (XML import workers), `apps/web` (Next.js frontend)
- **Packages**: `packages/db` (Kysely + migrations), `packages/domain` (shared retrieval services)
- All apps import from `@dig/domain` for business logic — no framework code in domain

## Tech Stack (locked)
- Runtime: TypeScript + Node.js (ES2022, Bundler module resolution)
- API: Fastify
- MCP: TypeScript MCP SDK (@modelcontextprotocol/sdk), remote SSE transport via Express
- DB: Postgres + Kysely (no ORM)
- Cache/queues: Redis (ioredis) — Upstash in production
- Search: Postgres FTS + pg_trgm
- XML parsing: saxes (SAX streaming, memory-bounded)
- Test: Vitest
- Package manager: pnpm (v10.27+)
- Hosting: Fly.io (API + MCP + Web + workers), Fly Postgres, Upstash Redis
- Frontend: Next.js on Fly.io (always-on, no cold starts)
- Images: Cover Art Archive first + fallback placeholders

## Live URLs
- **API**: https://dig-api.fly.dev/ (staging alpha)
- **MCP**: https://dig-mcp.fly.dev/sse (staging alpha)
- **Health**: https://dig-api.fly.dev/v1/health
- **Frontend**: https://app.dig.baby (staging alpha, Fly.io — DNS cutover pending from Vercel)
- **Marketing**: https://dig.baby (Vercel)
- **GitHub**: https://github.com/b1rdmania/dig

## Key Commands
- `pnpm dev` — start API server (from root)
- `pnpm dev:web` — start Next.js frontend (port 3002)
- `pnpm test` — run all tests across workspace
- `pnpm typecheck` — typecheck all packages
- `docker compose up -d` — start local Postgres + Redis
- `DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm --filter @dig/db migrate:up` — run migrations
- `pnpm --filter @dig/ingest ingest -- releases --file ./path/to/dump.xml.gz` — run ingest CLI
- `fly deploy --config fly.api.toml --remote-only` — deploy API to Fly
- `fly deploy --config fly.mcp.toml --remote-only` — deploy MCP to Fly
- `fly deploy --config fly.web.toml --remote-only` — deploy frontend to Fly
- `MCP_URL="https://dig-mcp.fly.dev/sse" npx tsx apps/mcp/src/smoke-test.ts` — MCP remote smoke test

## Database
- Schemas: `auth`, `ingest`, `catalog`, `enrich`
- Migrations: `packages/db/migrations/` (001–008)
- Schema types: `packages/db/src/schema.ts`
- Local: `postgresql://dig:dig_local@localhost:5433/dig` (Docker PG 16, port 5433)
- Fly staging: `dig-db` (shared-cpu-2x, 4GB RAM, 300GB disk)
- Fly proxy: `fly proxy 15432:5432 -a dig-db`

## Conventions
- API routes under `/v1/` prefix always
- Cursor-based pagination, not offset
- Every response includes provenance (source, dump_date, discogs_id)
- Error format: `{ error: { code, message, details? } }` — same taxonomy REST + MCP
- Error codes: INVALID_REQUEST, NOT_FOUND, QUERY_TIMEOUT, RATE_LIMITED, INTERNAL_ERROR
- No LLM inference in the retrieval path — structured data only
- Workspace packages export from `src/` directly (not `dist/`) during development
- Two-tier rate limits: anonymous 60/min (IP), keyed 300/min (X-API-Key)

## File Layout
```
apps/api/              — Fastify REST API server (port 3000)
apps/api/src/app.ts    — app factory (rate-limit, CORS, logging, routes)
apps/api/src/server.ts — production entrypoint
apps/mcp/              — MCP SSE server (port 3001)
apps/mcp/src/server.ts — 6 tools wired to @dig/domain
apps/mcp/src/smoke-test.ts — 47-assertion live smoke test
apps/ingest/           — Discogs XML import pipeline (CLI)
packages/db/           — Kysely DB layer, migrations, schema types
packages/domain/       — Shared domain services (health, search, retrieval, traversal)
docs/                  — Implementation plan, specs, strategy docs
docs/LEGAL.md          — Legal notices (Discogs CC0, MusicBrainz, setlist.fm)
docs/phase2-response-contracts.md — Locked JSON response shapes
docs/rate-limit-policy.md — Rate-limit tiers + headers
Dockerfile             — Shared monorepo Docker build (API + MCP)
Dockerfile.web         — Next.js frontend Docker build
fly.api.toml           — Fly config for dig-api
fly.mcp.toml           — Fly config for dig-mcp
fly.web.toml           — Fly config for dig-web (frontend)
docker-compose.yml     — Local Postgres 16 + Redis 7
```

## Current Phase
Phase 3 — COMPLETE. Gate D: GO (unconditional) at `ede193b`.
- API + MCP deployed to Fly.io (iad region)
- Two-tier rate limiting with Upstash Redis
- Structured JSON request logging
- 47/47 MCP smoke tests passing against remote server
- Rollback drill verified
- Staging data: full artists/labels/masters + 50k release sample
- Claude Code + Claude Desktop MCP both verified
- Production benchmark Run 7: 32 queries, 0 errors, p50 117ms (internet round trip)
- Docs pass complete: quickstart, ops runbook, alpha invite, Phase 4 prerequisites

## Current: Phase 4 — Data Load + Enrichment Foundation
1. [x] **Full releases dataset migration** — COMPLETE (~555M rows, 12 tables, verified)
2. [x] ANALYZE + search_vector verification — all populated
3. [x] **Run 8 benchmark** — 0 errors, p50 108ms, 7/7 warm SLOs pass
4. [x] Cleanup dump + scale DB down (shared-cpu-2x, 4GB, 156GB/300GB used)
5. [x] Enrichment foundation (Phase 4A): `enrich.*` schema applied
6. [x] **Next.js frontend scaffold** — `apps/web`, search + release pages, build passes (`2910b1c`)
7. [x] **Fly.io deploy** — `app.dig.baby` (migrated from Vercel to Fly for always-on, no cold starts). DNS cutover pending. Vercel kept as fallback for 24h.
8. [x] pg_prewarm warmup executed + runbook documented
9. [x] **Alpha invite** — `docs/alpha-invite.md` updated, 5 keys issued
10. [x] **Filtered-query concurrency hardening** — migration `007` + capped fallback path. c100 load: 0 timeouts / 0 errors
11. [x] **Search IA + entity pages** — master-first grouped search, duplicate release collapse, `/master/[id]` + `/artist/[id]` routes
12. [x] **Cover Art Archive integration** — MusicBrainz crosswalk import (1,768,376 mappings), cover proxy endpoint (`/v1/releases/:id/cover`), Redis cache (7-day TTL), frontend display with vinyl placeholder fallback
13. [x] **Master page perf fix** — migration `008_release_master_index.ts` for master→releases traversal. Page load: 10.3s → 0.9s
14. **Gate E status**: GO with caveat for soft alpha (5-10 testers). NOT GO for broader/public (filtered p99 still high under heavy contention)
15. See `docs/enrichment-implementation-plan.md`

## Better-Than-Discogs Track (2026-03-08)
- **Item 1 — Data Quality Layer v1**: GO WITH CAVEATS. Artist v2 reclassify complete. Releases v1 backfill running on dig-db (PID 8467, `/tmp/q_v2_all.py`, ~17:00–18:00 UTC complete). Gate not fully closed until ANALYZE + guardrail snapshot committed. `enrich.entity_quality` fully populated: 9.9M artists, 2.3M labels, 2.5M masters, 18.9M releases.
- **Item 2 — No-Dead-Ends v2**: 0 structural dead-ends. Canary rebuilt with 100 verified IDs (`0d605ae`). 79 TIMEOUT = SSR perf issue (P1, separate). CI gate live (`.github/workflows/regression-smoke.yml`). Gate closeout doc pending.
- **Item 3 — Artist Completeness Upgrade**: Not started.
- **P1 open**: SSR timeout hardening (79 entities timing out at 10s ceiling), migration 014 not in kysely_migration table.

## MCP Tools
| Tool | Description |
|------|-------------|
| `search_catalog` | FTS + fuzzy search across 24M+ records |
| `get_artist` | Artist detail by Discogs ID |
| `get_label` | Label detail by Discogs ID |
| `get_master` | Master release detail by Discogs ID |
| `get_release` | Release detail with tracks, credits, formats |
| `traverse_links` | Navigate entity graph (5 link types) |

## Important References
- [Operating Guide](docs/operating-implementation-guide.md) — canonical execution workflow
- [Canonical Docs Map](docs/canonical-docs.md) — doc precedence and usage
- [Implementation Plan](docs/implementation-plan-agent-first.md) — canonical build plan
- [Quickstart](docs/quickstart.md) — API + MCP reference with curl examples
- [Response Contracts](docs/phase2-response-contracts.md) — locked JSON shapes
- [Ops Runbook](docs/ops-runbook.md) — incident triage, deployment, rollback
- [Alpha Invite](docs/alpha-invite.md) — staging limitations, usage policy
- [Enrichment Plan](docs/enrichment-implementation-plan.md) — MusicBrainz + Wikidata + Setlist rollout
- [Rate-Limit Policy](docs/rate-limit-policy.md) — tier definitions
- [Operator Guide](docs/OPERATOR.md) — how Claude Code runs this project
