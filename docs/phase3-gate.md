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

- [ ] Define anonymous tier: requests/min, requests/day, max concurrent
- [ ] Define keyed tier: requests/min, requests/day, max concurrent
- [ ] API key generation + storage (auth schema tables already exist in migration 001)
- [ ] Rate-limit middleware (ioredis sliding window or token bucket)
- [ ] Rate-limit headers in response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- [ ] 429 response with `Retry-After` header

### MCP tool contracts

- [ ] Lock MCP tool schemas to current response contracts (including `meta.degraded_reason`)
- [ ] Tools: `search_catalog`, `get_artist`, `get_label`, `get_master`, `get_release`, `explain_relationships`
- [ ] Each tool returns structured JSON matching `docs/phase2-response-contracts.md`
- [ ] Tool descriptions include parameter constraints from `docs/phase2-query-envelope.md`
- [ ] Test with MCP Inspector and Claude Desktop

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

- [ ] Structured logging: request_id, elapsed_ms, status_code, category, degraded_reason
- [ ] `getTimeoutStats()` exposed on `/v1/health` or `/v1/metrics` (internal)
- [ ] Alert threshold: timeout rate > 1% per 15min per category → log warning (already in code)
- [ ] Error tracking: unhandled exceptions → structured log (Fly logs or future Sentry)

## Decision: Go / No-Go

| Criterion | Required | Status |
|-----------|----------|--------|
| Phase 2 SLOs frozen and accepted | Yes | Done |
| Timeout rate guardrail in code | Yes | Done |
| API key + rate-limit middleware | Yes | Pending |
| MCP tools tested with Inspector | Yes | Pending |
| Fly deployment + smoke test | Yes | Pending |
| Production benchmark baseline | Nice-to-have | Pending |
| Rollback runbook documented | Yes | Pending |

**Gate owner:** Project lead signs off after all "Required" items are checked.
