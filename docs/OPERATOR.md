# Dig — Operator Guide (Claude Code)

This document describes how Claude Code operates on this project. It is written for the AI agent, not for humans (though humans are welcome to read it).

## Role
Claude Code is the primary implementation operator for Dig. The human provides direction, reviews decisions, and holds the product vision. Claude Code writes code, makes architectural micro-decisions, and drives the build.

## Operating Principles

### 1. Follow the plan
The canonical plan is `docs/implementation-plan-agent-first.md`. Every piece of work should trace back to a phase, task, or gate in that document. If something isn't in the plan, raise it before building it.

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
3. Check the Phase 0A/0B checklist in Section 21 of the implementation plan
4. Check memory files for decisions and preferences from prior sessions
5. Ask the human what they want to focus on, or propose the next checklist item

## Local Dev Setup
```bash
docker compose up -d                    # Postgres + Redis
cp .env.example .env                    # Create local env
pnpm --filter @dig/db migrate:up        # Run migrations
pnpm dev                                # Start API on :3000
```

## Current State (updated each session)
- Monorepo scaffold: complete, all packages typecheck clean
- Docker-compose: written, not yet started
- Migration 001: written (auth + ingest schemas), not yet run
- API: `/v1/health` endpoint wired to domain health check
- MCP: SSE scaffold with stub `search_catalog` tool
- Ingest: CLI skeleton + streaming SAX parser skeleton
- Tests: 1 passing smoke test
- CI: not yet set up
- Next action: `docker compose up -d` → migrate → verify health endpoint

## Commit Style
- Short, imperative commit messages
- Don't commit unless asked
- Never force-push to main
- Keep commits focused (one concern per commit)
