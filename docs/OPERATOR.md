# Dig — Operator Guide (Claude Code)

This document describes how Claude Code operates on this project. It is written for the AI agent, not for humans (though humans are welcome to read it).

## Role
Claude Code is the primary implementation operator for Dig. The human provides direction, reviews decisions, and holds the product vision. Claude Code writes code, makes architectural micro-decisions, and drives the build.

## Operating Principles

### 1. Follow the plan
Execution authority is:
1. `docs/operating-implementation-guide.md`
2. `docs/ops-runbook.md`
3. `docs/canonical-docs.md`

Phase and product strategy context is in `docs/implementation-plan-agent-first.md`. Every piece of work should trace back to a phase, task, or gate. If something isn't in plan/scope, raise it before building it.

### 2. Don't over-build
Ship the minimum that satisfies the current phase's done criteria. No speculative features, no premature abstractions. Three similar lines > one clever helper.

### 3. Preserve raw, normalize in layers
When working on ingest or data code: always store the raw payload first, then derive canonical tables. Never discard data during normalization.

### 4. Test as you go
Every new module gets at least one test. Parser code gets golden fixtures. Retrieval services get contract tests. Don't skip testing to move faster — bad normalization bugs are silent and expensive.

### 5. Keep the monorepo clean
- Shared logic goes in `@dig/domain`
- DB types and migrations go in `@dig/db`
- App-specific code stays in its app
- No circular dependencies between packages
- Dependency boundary rule: app code (`apps/api`, `apps/ingest`, `apps/mcp`, `apps/web`) must import DB helpers (`sql`, `createDb`, `Database`) from `@dig/db`, not directly from `kysely`. Direct `kysely` imports in app packages can compile locally but fail in runtime images where `kysely` is not a direct app dependency.

### 6. Ask when uncertain
If a decision could go either way and isn't covered by the plan, ask the human rather than guessing. Especially for:
- Schema design choices that are hard to reverse
- Third-party service selections
- Anything that affects the public API contract

## Delegation
The operator can spin up sub-agents (Sonnet) for:
- Parallel scaffold work (e.g., apps/ingest and apps/mcp simultaneously)
- Research tasks (e.g., benchmarking XML parsers, checking MCP SDK docs)
- Test writing for existing code

Sub-agents should be given specific, bounded tasks with clear deliverables.

## Resuming Work
When starting a new session:
1. Read `CLAUDE.md` (loaded automatically) for project context
2. Check `git log --oneline -10` to see recent work
3. Read `docs/operating-implementation-guide.md` for current execution rules
4. Read `docs/canonical-docs.md` to avoid doc conflicts
5. Check current phase/gates in `docs/implementation-plan-agent-first.md`
6. Check memory files for decisions and preferences from prior sessions
7. Ask the human what they want to focus on, or propose the next checklist item

## Local Dev Setup
```bash
docker compose up -d                    # Postgres + Redis
cp .env.example .env                    # Create local env
pnpm --filter @dig/db migrate:up        # Run migrations
pnpm dev                                # Start API on :3000
```

## Current State (updated each session)
- Phase 0A: COMPLETE
- Phase 0B: COMPLETE
- Gate A: PASSED (all 10 items checked off)
- Monorepo scaffold: complete, all packages typecheck clean
- Docker-compose: running (Postgres on port 5433, Redis on 6379)
- Migration 001: applied (auth + ingest schemas)
- API: `/v1/health` verified returning `{"status":"ok","postgres":true}`
- MCP: SSE scaffold with stub `search_catalog` tool
- Ingest: CLI skeleton + streaming SAX parser with golden fixture tests (11 passing)
- Tests: 14 passing across all packages (2 domain + 1 api + 11 ingest parser)
- CI: GitHub Actions — typecheck + migrate + test, all green
- Hosting: Fly.io locked (staging provisioning deferred to Phase 1 start)
- Phase 0B deliverables: profiling complete, normalization dictionary, image strategy, QA gates, dataset sizing, legal review
- Next: Phase 1 — Ingestion Foundation + Canonical Database

## Commit Style
- Short, imperative commit messages
- Don't commit unless asked
- Never force-push to main
- Keep commits focused (one concern per commit)
