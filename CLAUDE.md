# Dig — Claude Code Project Guide

## What is this?
Dig is a music data layer and search platform built on the Discogs CC0 catalog. REST API + MCP for agents, mobile-first search UI for humans. See the [implementation plan](docs/implementation-plan-agent-first.md) for the full system plan.

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
- Hosting: Fly.io (API + MCP + workers), Fly Postgres, Upstash Redis
- Frontend (Phase 4): Next.js on Vercel
- Images: Cover Art Archive first + fallback placeholders

## Live URLs
- **API**: https://dig-api.fly.dev/ (staging alpha)
- **MCP**: https://dig-mcp.fly.dev/sse (staging alpha)
- **Health**: https://dig-api.fly.dev/v1/health
- **Frontend**: https://web-eight-navy-21.vercel.app (staging alpha)
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
- `MCP_URL="https://dig-mcp.fly.dev/sse" npx tsx apps/mcp/src/smoke-test.ts` — MCP remote smoke test

## Database
- Schemas: `auth`, `ingest`, `catalog`, `enrich`
- Migrations: `packages/db/migrations/` (001–007)
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
docs/phase3-gate.md    — Phase 3 gate checklist + evidence
docs/phase2-response-contracts.md — Locked JSON response shapes
docs/rate-limit-policy.md — Rate-limit tiers + headers
Dockerfile             — Shared monorepo Docker build
fly.api.toml           — Fly config for dig-api
fly.mcp.toml           — Fly config for dig-mcp
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
7. [x] **Vercel deploy** — `web-eight-navy-21.vercel.app`, env vars set, search + release pages live
8. [x] pg_prewarm warmup executed + runbook documented
9. [x] **Alpha invite** — `docs/alpha-invite.md` updated, 5 keys issued
10. [x] **Filtered-query concurrency hardening** — migration `007_release_filtered_perf_indexes.ts` + capped fallback path. c100 filtered load now returns 0 timeouts / 0 errors (latency caveat remains under heavy contention)
11. [x] **Search IA + entity pages** — master-first grouped search, duplicate release collapse, new `/master/[id]` + `/artist/[id]` routes, per-track expandable credits on release page
12. See `docs/phase4-prerequisites.md` and `docs/enrichment-implementation-plan.md`

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
- [Implementation Plan](docs/implementation-plan-agent-first.md) — canonical build plan
- [Quickstart](docs/quickstart.md) — API + MCP reference with curl examples
- [Response Contracts](docs/phase2-response-contracts.md) — locked JSON shapes
- [Phase 3 Gate](docs/phase3-gate.md) — deployment checklist + evidence
- [Ops Runbook](docs/ops-runbook.md) — incident triage, deployment, rollback
- [Alpha Invite](docs/alpha-invite.md) — staging limitations, usage policy
- [Phase 4 Prerequisites](docs/phase4-prerequisites.md) — migration, capacity, costs
- [Enrichment Plan](docs/enrichment-implementation-plan.md) — MusicBrainz + Wikidata + Setlist rollout
- [Rate-Limit Policy](docs/rate-limit-policy.md) — tier definitions
- [Operator Guide](docs/OPERATOR.md) — how Claude Code runs this project
