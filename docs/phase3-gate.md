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
- [x] 47/47 smoke tests passing against remote Fly MCP server (`dig-mcp.fly.dev`)
- [ ] Test with Claude Desktop (manual — needs user config)
- [ ] Test with Claude Code (manual — needs MCP server config)

### Fly.io deployment runbook

- [x] Fly app creation: `dig-api` (Fastify, port 3000), `dig-mcp` (Express SSE, port 3001)
- [x] Fly Postgres provisioning: shared-cpu-2x, 1GB RAM, 40GB disk, pg_trgm + unaccent enabled
- [x] Data migration: core tables loaded (artists 584k, labels 2.3M, masters 2.5M + children) + 50k release sample
- [x] Upstash Redis provisioned via Fly (`fly-dig-redis.upstash.io`)
- [x] Environment variables: `DATABASE_URL`, `REDIS_URL` set as Fly secrets
- [x] Health check endpoint: `/v1/health` returns `{"status":"ok","postgres":true}` + `timeout_stats`
- [x] Deployment: `fly deploy --config fly.api.toml` / `fly deploy --config fly.mcp.toml`
- [x] **Rollback drill executed:**
  1. Deployed v2 (same image, new release)
  2. Rolled back to v1: `fly deploy --image registry.fly.io/dig-api:deployment-01KJH007EWXMX1J5RQWB1C8AMZ`
  3. Verified health after rollback: `{"status":"ok","postgres":true}`
  4. Redeployed to latest
- [x] Smoke test: 47/47 MCP assertions passing against live `dig-mcp.fly.dev`
- [x] REST smoke: search, artist, label, master, release, traversal all returning 200 + valid JSON

### Staging data summary

| Table | Rows loaded |
|-------|-------------|
| ingest.dump_batches | 1 |
| catalog.artists | 584,000 |
| catalog.artist_aliases | 417,592 |
| catalog.artist_groups | 239,485 |
| catalog.artist_members | 287,026 |
| catalog.artist_name_variations | 763,681 |
| catalog.artist_urls | 236,020 |
| catalog.labels | 2,338,764 |
| catalog.label_urls | 381,986 |
| catalog.masters | 2,520,704 |
| catalog.master_artists | 3,093,338 |
| catalog.master_genres | 3,345,952 |
| catalog.master_styles | 3,945,308 |
| catalog.master_videos | 5,852,117 |
| catalog.releases | 50,000 |
| catalog.release_artists | 55,451 |
| catalog.release_labels | 59,325 |
| catalog.release_formats | 50,501 |
| catalog.release_genres | 53,435 |
| catalog.release_styles | 97,828 |
| catalog.release_credits | 149,252 |
| catalog.release_identifiers | 163,324 |
| catalog.release_companies | 182,262 |
| catalog.release_videos | 154,832 |
| catalog.tracks | 282,592 |
| catalog.track_credits | 193,613 |

Disk usage: 9.5GB / 40GB (26%)

### Production benchmark baseline

- [ ] Run benchmark from remote host (not local) against Fly deployment
- [ ] Record network-inclusive latencies as production baseline
- [ ] Compare against local warm SLOs — adjust targets if needed
- [ ] Document in `docs/phase2-search-benchmark-results.md` as "Run 7 — Production"

### Operational readiness

- [x] Structured logging: request_id, elapsed_ms, status_code, category, api_key (JSON to stdout)
- [x] `getTimeoutStats()` exposed on `/v1/health` response
- [x] Alert threshold: timeout rate > 1% per 15min per category → log warning (in search.ts)
- [x] Error tracking: unhandled exceptions → structured JSON log (Fly logs)
- [x] CORS configured for browser clients (`@fastify/cors`)
- [x] `X-Request-Id` on all responses (UUID, accepts client-provided)

## Fly Infrastructure

| Resource | Name | Region | Config |
|----------|------|--------|--------|
| API app | dig-api | iad | shared-cpu-1x, 512MB, 2 machines |
| MCP app | dig-mcp | iad | shared-cpu-1x, 512MB, 1 machine (SSE sticky) |
| Postgres | dig-db | iad | shared-cpu-2x, 1GB RAM, 40GB disk |
| Redis | dig-redis | iad | Upstash pay-per-use |

URLs:
- API: https://dig-api.fly.dev/
- MCP SSE: https://dig-mcp.fly.dev/sse
- Health: https://dig-api.fly.dev/v1/health

## Decision: Go / No-Go

| Criterion | Required | Status |
|-----------|----------|--------|
| Phase 2 SLOs frozen and accepted | Yes | **Done** |
| Timeout rate guardrail in code | Yes | **Done** |
| API key + rate-limit middleware | Yes | **Done** (two-tier, headers, CORS) |
| Structured logging | Yes | **Done** (JSON, request_id, category) |
| MCP tools wired + contract tested | Yes | **Done** (6 tools, 18 unit + 47 smoke) |
| Fly deployment + smoke test | Yes | **Done** (dig-api + dig-mcp deployed, 47/47 pass) |
| Rollback drill | Yes | **Done** (v2→v1→latest, health verified) |
| Production benchmark baseline | Nice-to-have | Pending (needs remote host) |
| Claude Desktop/Code MCP client test | Nice-to-have | Pending (manual user verification) |

**Gate status: GO** — all required criteria met. Public alpha invite ready pending user MCP client verification.

**Gate owner:** Project lead signs off after MCP client verification.
