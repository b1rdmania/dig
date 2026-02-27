# Phase 3 Go/No-Go Gate — Execution Checklist

Companion to Section 10.1 of the [implementation plan](implementation-plan-agent-first.md#101-phase-3-gonogo-gate-locked-from-run-6). That section defines the hard go/no-go criteria. This doc is the detailed execution checklist for Phase 3 kickoff work.

## Prerequisites (from Phase 2)

- [x] Two-path release search strategy implemented and benchmarked
- [x] Stop-word empty tsquery short-circuit
- [x] `degraded_reason` tracked in `meta` for all code paths
- [x] Warm/cold SLO policy frozen in `docs/phase2-search-benchmark-results.md`
- [x] Timeout rate guardrail in code (`trackRequest` + `getTimeoutStats`)
- [x] Benchmark Run 6: 0 errors / 96 queries
- [x] Fuzzy threshold tuned (labels/masters 0.5, cap 5)
- [x] v1 tradeoffs explicitly documented and accepted

## Phase 3 Kickoff Checklist

### API key + rate-limit policy

- [x] Define anonymous tier: 60 req/min per IP
- [x] Define keyed tier: 300 req/min per API key (`X-API-Key` header)
- [ ] API key generation + storage (auth schema tables already exist in migration 001)
- [x] Rate-limit middleware (`@fastify/rate-limit` + ioredis sliding window)
- [x] Rate-limit headers in response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- [x] 429 response with `Retry-After` header
- [x] Rate-limit policy documented in `docs/rate-limit-policy.md`

### MCP tool contracts

- [x] Lock MCP tool schemas to current response contracts (including `meta.degraded_reason`)
- [x] Tools: `search_catalog`, `get_artist`, `get_label`, `get_master`, `get_release`, `traverse_links`
- [x] Each tool returns structured JSON matching `docs/phase2-response-contracts.md`
- [x] Tool descriptions include parameter constraints from `docs/phase2-query-envelope.md`
- [x] 18 contract tests passing (`apps/mcp/src/__tests__/tools-contract.test.ts`)
- [x] 47-assertion smoke test passing against live MCP server (`apps/mcp/src/smoke-test.ts`)
- [x] Error taxonomy: INVALID_REQUEST, NOT_FOUND, QUERY_TIMEOUT, INTERNAL_ERROR (same as REST)
- [ ] Test with Claude Desktop (requires Fly deployment or local tunnel)
- [ ] Test with Claude Code (requires MCP server config)

### Fly.io deployment runbook

- [ ] Fly app creation: `dig-api` (Fastify, port 3000), `dig-mcp` (Express SSE, port 3001)
- [ ] Fly Postgres provisioning: 256MB+ shared_buffers, pg_trgm + unaccent extensions enabled
- [ ] Data migration plan: pg_dump/pg_restore from local → Fly Postgres
- [ ] Upstash Redis provisioning (rate limiting, future caching)
- [ ] Environment variables: `DATABASE_URL`, `REDIS_URL`, `API_SECRET` (for key generation)
- [ ] Health check endpoints: `/health` (API), readiness probe for PG + Redis
- [ ] Deployment: `fly deploy` from CI or manual
- [ ] **Rollback steps:**
  1. `fly releases` to identify last good release
  2. `fly deploy --image <previous-image>` to rollback app code
  3. Postgres: no auto-migration on deploy (migrations run manually)
  4. If migration needs rollback: run `migrate:down` manually, then redeploy previous image
- [ ] Smoke test script: hit 5 key endpoints post-deploy, verify 200 + valid JSON

### Production benchmark baseline

- [ ] Run benchmark from remote host (not local) against Fly deployment
- [ ] Record network-inclusive latencies as production baseline
- [ ] Compare against local warm SLOs — adjust targets if needed
- [ ] Document in `docs/phase2-search-benchmark-results.md` as "Run 7 — Production"

### Operational readiness

- [x] Structured logging: request_id, elapsed_ms, status_code, category, api_key (JSON to stdout)
- [x] `getTimeoutStats()` exposed on `/v1/health` response
- [x] Alert threshold: timeout rate > 1% per 15min per category → log warning (in search.ts)
- [ ] Error tracking: unhandled exceptions → structured log (Fly logs or future Sentry)
- [x] CORS configured for browser clients (`@fastify/cors`)
- [x] `X-Request-Id` on all responses (UUID, accepts client-provided)

## Decision: Go / No-Go

| Criterion | Required | Status |
|-----------|----------|--------|
| Phase 2 SLOs frozen and accepted | Yes | Done |
| Timeout rate guardrail in code | Yes | Done |
| API key + rate-limit middleware | Yes | **Done** (two-tier, headers, CORS) |
| Structured logging | Yes | **Done** (JSON, request_id, category) |
| MCP tools wired + contract tested | Yes | **Done** (6 tools, 18 unit + 47 smoke) |
| Fly deployment + smoke test | Yes | Pending |
| Production benchmark baseline | Nice-to-have | Pending |
| Rollback runbook documented | Yes | Pending |

**Gate owner:** Project lead signs off after all "Required" items are checked.
