# Dig — Claude Code Project Guide

## What is this?
Dig is a music data layer and search platform built on the Discogs CC0 catalog. REST API + MCP for agents, mobile-first search UI for humans. See the [implementation plan](docs/implementation-plan-agent-first.md) for the full system plan.

## Architecture
- **Monorepo** (pnpm workspaces): `apps/` and `packages/`
- **Apps**: `apps/api` (Fastify REST), `apps/mcp` (MCP SSE server), `apps/ingest` (XML import workers)
- **Packages**: `packages/db` (Kysely + migrations), `packages/domain` (shared retrieval services)
- All apps import from `@dig/domain` for business logic — no framework code in domain

## Tech Stack (locked)
- Runtime: TypeScript + Node.js (ES2022, Bundler module resolution)
- API: Fastify
- MCP: TypeScript MCP SDK (@modelcontextprotocol/sdk), remote SSE transport via Express
- DB: Postgres + PgBouncer, accessed via Kysely
- Cache/queues: Redis (ioredis) — Upstash in production
- Search: Postgres FTS + pg_trgm
- XML parsing: saxes (SAX streaming, memory-bounded)
- Test: Vitest
- Package manager: pnpm (v10.27+)
- Hosting: Fly.io (API + MCP + workers), Fly Postgres, Upstash Redis
- Frontend (Phase 4): Next.js on Vercel
- Images: Cover Art Archive first + fallback placeholders

## Key Commands
- `pnpm dev` — start API server (from root)
- `pnpm test` — run all tests across workspace
- `pnpm typecheck` — typecheck all packages
- `docker compose up -d` — start local Postgres + Redis
- `DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig pnpm --filter @dig/db migrate:up` — run migrations
- `pnpm --filter @dig/ingest ingest -- releases --file ./path/to/dump.xml.gz` — run ingest CLI

## Database
- Schemas: `auth`, `ingest`, `catalog` (catalog added in Phase 1)
- Migrations live in `packages/db/migrations/` (Kysely FileMigrationProvider)
- Schema types in `packages/db/src/schema.ts` — update this when adding migrations
- Auth tables exist but are not enforced until Phase 5
- Local connection: `postgresql://dig:dig_local@localhost:5433/dig`

## Conventions
- API routes under `/v1/` prefix always
- Cursor-based pagination, not offset
- Every response includes provenance (source, dump_date, discogs_id)
- Error format: `{ error: { code, message, details? } }`
- No LLM inference in the retrieval path — structured data only
- `explain_relationships` returns structured payloads, not generated prose
- Workspace packages export from `src/` directly (not `dist/`) during development

## File Layout
```
apps/api/          — Fastify REST API server (port 3000)
apps/api/src/app.ts — app factory for test injection
apps/api/src/server.ts — production entrypoint
apps/mcp/          — MCP SSE server (port 3001)
apps/ingest/       — Discogs XML import pipeline (CLI)
apps/ingest/src/parser.ts — streaming SAX parser
packages/db/       — Kysely DB layer, migrations, schema types
packages/domain/   — Shared domain services (health, search, retrieval)
docs/              — Implementation plan, specs, strategy docs
docs/OPERATOR.md   — How Claude Code operates on this project
docker-compose.yml — Local Postgres 16 + Redis 7
.env.example       — Required environment variables
```

## Current Phase
Phase 0A — COMPLETE. Scaffold, docker, migrations, CI, hosting all done.
Phase 0B — COMPLETE. Profiling, normalization dictionary, image strategy, QA gates, sizing, legal.
Gate A — PASSED. All 10 checklist items resolved.
Next: Phase 1 — Ingestion Foundation + Canonical Database.

## Phase 1 Starting Points
1. Provision Fly.io staging environment
2. Create ingest infra tables (dump_batches, raw_entities)
3. Build canonical schema migrations (catalog.artists, catalog.releases, etc.)
4. Implement full XML→raw_entities pipeline
5. Implement raw→canonical normalization transforms

## Important References
- [Implementation Plan](docs/implementation-plan-agent-first.md) — canonical build plan (~1000 lines)
- [Operator Guide](docs/OPERATOR.md) — how Claude Code runs this project
- [Weekly Execution Checklist](docs/implementation-plan-agent-first.md#21-phase-0a0b-weekly-execution-checklist-12-person-team) — Section 21 of the plan
- GitHub: [b1rdmania/dig](https://github.com/b1rdmania/dig)
- Live marketing site: [dig.baby](https://dig.baby)
