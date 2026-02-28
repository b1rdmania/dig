# Phase 3 Day 4 — Docs & Closeout Checklist

Companion to the [Phase 3 gate](phase3-gate.md). Gate D is unconditional GO at `33f8e31`. This checklist covers the remaining Day 4-5 deliverables before soft alpha invite.

---

## 1. API + MCP Quickstart (`docs/quickstart.md`)

### Structure

```
# Dig API Quickstart

## Base URLs
## Authentication (API keys)
## Rate Limits
## Search
## Entity Detail
## Traversal
## MCP Setup
## Error Handling
## Examples
```

### Content to include

**Base URLs:**
- REST: `https://dig-api.fly.dev/v1/`
- MCP SSE: `https://dig-mcp.fly.dev/sse`
- Health: `GET /v1/health`

**Auth modes:**
- Anonymous: no header, 60 req/min per IP
- Keyed: `X-API-Key: dig_<32hex>` header, 300 req/min
- Keys are for rate-limit tiering only — no authz on reads

**Rate-limit headers** (on every response):
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- 429 response includes `Retry-After` header

**Search** (`GET /v1/search`):
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `q` | string | yes | 2-200 chars |
| `type` | enum | no | `artist`, `label`, `master`, `release` |
| `genre` | string | no | e.g. "Electronic" |
| `style` | string | no | e.g. "Techno" |
| `year` | int | no | exact year |
| `year_min` / `year_max` | int | no | year range |
| `country` | string | no | e.g. "US" |
| `limit` | int | no | 1-50, default 20 |
| `cursor` | string | no | opaque, from previous response |

curl examples:
```bash
# Basic search
curl "https://dig-api.fly.dev/v1/search?q=radiohead&type=artist"

# Filtered search
curl "https://dig-api.fly.dev/v1/search?q=ambient&type=release&genre=Electronic&year_min=1990&year_max=1999"

# With API key
curl -H "X-API-Key: dig_your_key_here" \
  "https://dig-api.fly.dev/v1/search?q=kraftwerk"
```

**Entity detail** (4 routes):
```bash
curl "https://dig-api.fly.dev/v1/artists/3840"    # Radiohead
curl "https://dig-api.fly.dev/v1/labels/1"         # Planet E
curl "https://dig-api.fly.dev/v1/masters/384323"   # OK Computer
curl "https://dig-api.fly.dev/v1/releases/1"       # Stockholm
```

**Traversal** (5 routes):
```bash
curl "https://dig-api.fly.dev/v1/artists/3840/releases?limit=5"
curl "https://dig-api.fly.dev/v1/artists/3840/masters?limit=5"
curl "https://dig-api.fly.dev/v1/labels/1/releases?limit=10"
curl "https://dig-api.fly.dev/v1/masters/384323/releases"
curl "https://dig-api.fly.dev/v1/releases/1/credits"
```

**Error codes** (same for REST + MCP):
| Code | HTTP | When |
|------|------|------|
| `INVALID_REQUEST` | 400 | Missing/invalid params |
| `NOT_FOUND` | 404 | No entity with that discogs_id |
| `QUERY_TIMEOUT` | 408 | Statement timeout exceeded (3s) |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

**MCP setup — Claude Code:**
```bash
claude mcp add --transport sse --scope user dig-catalog "https://dig-mcp.fly.dev/sse"
```

**MCP setup — Claude Desktop:**
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "dig-catalog": {
      "url": "https://dig-mcp.fly.dev/sse"
    }
  }
}
```

**MCP tools** (6 tools, mirror REST exactly):
| Tool | Equivalent REST | Key params |
|------|----------------|-----------|
| `search_catalog` | `GET /v1/search` | `query`, `type?`, `genre?`, `style?`, `year?`, `limit?`, `cursor?` |
| `get_artist` | `GET /v1/artists/:id` | `discogs_id` |
| `get_label` | `GET /v1/labels/:id` | `discogs_id` |
| `get_master` | `GET /v1/masters/:id` | `discogs_id` |
| `get_release` | `GET /v1/releases/:id` | `discogs_id` |
| `traverse_links` | `GET /v1/{entity}/:id/{link}` | `link_type`, `discogs_id`, `limit?`, `cursor?` |

**Key response fields to document:**
- `meta.degraded` (boolean) — true when results are unranked (broad query, timeout, filtered)
- `meta.degraded_reason` — one of: `broad_query`, `empty_tsquery`, `filtered`, `filtered_capped`, `statement_timeout`
- `meta.hint` — human-readable suggestion to refine query
- `meta.elapsed_ms` — server-side query time
- `provenance.source` — always `"discogs"`
- `provenance.dump_date` — e.g. `"2026-02-01"`
- `pagination.cursor` — pass to next request for pagination

---

## 2. Ops Runbook Section (`docs/ops-runbook.md`)

### Structure

```
# Dig Ops Runbook (Staging Alpha)

## Infrastructure
## Health Checks
## Common Incidents
## Deployment
## Rollback
## Database Access
## Monitoring
```

### Incidents to cover

**429 spike triage:**
- Check: is it one IP or distributed? (`fly logs -a dig-api | grep 429`)
- If single IP: likely a benchmark or bot. Rate limiting working as designed
- If distributed: check Redis connectivity (`fly ssh console -a dig-api`, then `redis-cli ping`)
- If Redis down: rate limiter fails open (by design in alpha) — no 429s but no protection

**Timeout rate >1%:**
- Check `/v1/health` → `timeout_stats` object
- If one category spiking: likely a new broad query pattern. Check search logs for the query
- If all categories: Postgres under pressure. Check `fly ssh console -a dig-db` → `pg_stat_activity`
- Mitigation: scale Postgres (`fly scale vm shared-cpu-4x -a dig-db`) or add to broad-term list

**MCP SSE disconnects:**
- SSE requires sticky sessions — only 1 machine for dig-mcp
- If machine restarts (deploy, OOM), all SSE connections drop
- Clients auto-reconnect on next tool call
- Check: `fly status -a dig-mcp` — should show exactly 1 machine running
- If 0 machines: `fly machines start` or deploy
- If 2+ machines: destroy extras (SSE POST/GET routing breaks)

**Postgres connection exhaustion:**
- Fly Postgres shared-cpu-2x has ~25 connection limit
- dig-api (2 machines) + dig-mcp (1 machine) = 3 connection pools
- Check: `fly pg connect -a dig-db` → `SELECT count(*) FROM pg_stat_activity;`
- If near limit: reduce pool size in app config or scale Postgres

### Deployment commands
```bash
# Deploy API
fly deploy --config fly.api.toml --remote-only

# Deploy MCP
fly deploy --config fly.mcp.toml --remote-only

# Rollback API to previous release
fly releases -a dig-api  # find previous image
fly deploy --image registry.fly.io/dig-api:<deployment-id> --config fly.api.toml

# Check health
curl https://dig-api.fly.dev/v1/health | jq

# Run MCP smoke test
MCP_URL="https://dig-mcp.fly.dev/sse" npx tsx apps/mcp/src/smoke-test.ts

# DB access via proxy
fly proxy 15432:5432 -a dig-db
psql "postgresql://postgres:<password>@localhost:15432/dig"
```

---

## 3. Alpha Invite Prep (`docs/alpha-invite.md`)

### Content to draft

**Who:** 5-10 initial testers — music data nerds, agent builders, Discogs power users

**What they get:**
- API key (`dig_` prefix, 300 req/min)
- Quickstart doc link
- MCP setup instructions
- Direct feedback channel (GitHub issues or Discord)

**What to be explicit about:**
- **Staging dataset**: full artists (584k), labels (2.3M), masters (2.5M), but only **50k releases** (out of 18.9M). If a release isn't found, it's likely not in the sample
- **No SLA**: this is a $3/mo VM, not production
- **Rate limits enforced**: 300/min keyed, 60/min anonymous
- **Data freshness**: February 2026 Discogs dump, no live sync
- **Known limitations**: fuzzy search slow on labels/masters at p95, cross-entity broad queries (e.g. "music") can take 6s, release fuzzy disabled

**Usage policy:**
- CC0 data — no restrictions on downstream use
- API abuse (scraping full catalog, sustained >300 req/min) will get key revoked
- No commercial SLA until Phase 5

---

## 4. Phase 4 Prerequisites (`docs/phase4-prerequisites.md`)

### Content to draft

**Full releases dataset migration:**
- 18,876,362 releases + 11 child tables
- Estimated disk: ~120GB (catalog) + existing 9.5GB = ~130GB total
- Current Fly volume: 40GB → needs upgrade to 200GB+
- Migration approach: pg_dump table-by-table via fly proxy, or COPY from local
- Estimated time: 4-8 hours depending on network

**Full-corpus benchmark rerun:**
- Run 7 was against 50k release sample — not representative of release FTS/filtered performance
- Need Run 8 against full 18.9M releases on Fly
- Expected regressions: release FTS p95, filtered multi-filter, cross-entity
- May need Postgres RAM upgrade (shared-cpu-4x, 2GB+)

**DB capacity plan:**
| Resource | Current (staging) | Needed (full) | Cost estimate |
|----------|------------------|---------------|---------------|
| Disk | 40GB (9.5GB used) | 200GB | ~$18/mo |
| RAM | 1GB (shared-cpu-2x) | 2-4GB | ~$30-60/mo |
| Connections | ~25 | ~50 | Included with scale-up |

**Other Phase 4 prereqs:**
- Next.js frontend scaffold (Vercel)
- Cover Art Archive integration (image URLs per release)
- Search warmup on deploy (pg_prewarm for GIN indexes)
- Multi-filter composite index for genre+year queries
- Enrichment prerequisites for Phase 4A (`docs/enrichment-implementation-plan.md`)

---

## 5. Execution Order

| # | Task | Output file | Est. effort |
|---|------|------------|-------------|
| 1 | Write quickstart doc | `docs/quickstart.md` | 30 min |
| 2 | Write ops runbook | `docs/ops-runbook.md` | 20 min |
| 3 | Write alpha invite doc | `docs/alpha-invite.md` | 15 min |
| 4 | Write Phase 4 prereqs | `docs/phase4-prerequisites.md` | 15 min |
| 5 | Generate first API key | `auth.api_keys` table | 5 min |
| 6 | Test key-authenticated requests | Manual | 5 min |
| 7 | Update progress.html | `progress.html` | 10 min |
| 8 | Final commit + push | — | 5 min |
| 9 | Add enrichment implementation plan linkage | `docs/enrichment-implementation-plan.md` + Phase 4 docs | 10 min |

**Total: ~2h10 of focused work.**

---

## Acceptance Criteria

- [ ] `docs/quickstart.md` exists with curl examples that work against live API
- [ ] `docs/ops-runbook.md` covers the 4 incident types above
- [ ] `docs/alpha-invite.md` has explicit staging limitations
- [ ] `docs/phase4-prerequisites.md` has disk/RAM/cost estimates
- [ ] `docs/enrichment-implementation-plan.md` linked from Phase 4 docs
- [ ] At least 1 API key generated and tested at 300 req/min tier
- [ ] All docs committed and pushed
- [ ] progress.html updated with Day 4 status
