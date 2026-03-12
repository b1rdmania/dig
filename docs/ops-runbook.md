# Dig Ops Runbook (Staging Alpha)

Operational reference for the Fly.io staging deployment. For API/MCP usage, see [quickstart.md](quickstart.md).

## Infrastructure

| Resource | Name | Region | Spec |
|----------|------|--------|------|
| API | dig-api | iad | shared-cpu-1x, 512MB, 2 machines |
| MCP | dig-mcp | iad | shared-cpu-1x, 512MB, 1 machine |
| Postgres | dig-db | iad | shared-cpu-2x, 4GB RAM, 300GB disk |
| Redis | dig-redis | iad | Upstash pay-per-use |
| Frontend | dig-web | iad | shared-cpu-1x, 512MB, 1 machine (Fly) |

URLs:
- API: https://dig-api.fly.dev/v1/
- MCP SSE: https://dig-mcp.fly.dev/sse
- Health: https://dig-api.fly.dev/v1/health
- Frontend: https://app.dig.baby (Fly: dig-web.fly.dev)
- Marketing: https://dig.baby (Vercel)

## Health Checks

```bash
# Quick health check
curl -s https://dig-api.fly.dev/v1/health | jq

# Expected response:
# { "status": "ok", "postgres": true, "timeout_stats": { ... } }
```

The `timeout_stats` object tracks statement timeout rates per category over 15-minute windows. If any category exceeds 1% timeout rate, the API logs a warning.

## Deployment

```bash
# Deploy API
fly deploy --config fly.api.toml --remote-only

# Deploy MCP
fly deploy --config fly.mcp.toml --remote-only

# Deploy Frontend
fly deploy --config fly.web.toml --remote-only

# Check deployment status
fly status -a dig-api
fly status -a dig-mcp
fly status -a dig-web

# View recent logs
fly logs -a dig-api
fly logs -a dig-mcp
```

**Post-deploy checklist:**
1. Verify health: `curl -s https://dig-api.fly.dev/v1/health | jq`
2. If DB was restarted: run `pg_prewarm` (see Search Warmup section below)
3. Fire warm-up queries to populate batch cache on both API machines:
   ```bash
   # Hit each machine (2 requests to cover both via round-robin)
   for i in 1 2; do
     curl -sS "https://dig-api.fly.dev/v1/search?q=test&limit=1" > /dev/null
   done
   ```
4. Verify search returns all entity types: `curl -s "https://dig-api.fly.dev/v1/search?q=radiohead&limit=5" | jq '.results[].type'`

## Rollback

```bash
# List recent releases to find the previous image
fly releases -a dig-api

# Roll back to a specific release
fly deploy --image registry.fly.io/dig-api:<deployment-id> --config fly.api.toml

# Verify health after rollback
curl -s https://dig-api.fly.dev/v1/health | jq
```

### Unified regression smoke (read-only)

Run the cross-surface smoke after deploys or before gate closeout:

```bash
API_URL=https://dig-api.fly.dev \
WEB_URL=https://app.dig.baby \
MCP_URL=https://dig-mcp.fly.dev \
npm run smoke:regression
```

Rollback drill was executed on 2026-02-28 (v2 -> v1 -> latest, health verified at each step).

## Database Access

```bash
# Proxy Fly Postgres to localhost
fly proxy 15432:5432 -a dig-db

# Connect via psql (in another terminal)
psql "postgresql://postgres:<password>@localhost:15432/dig"

# Quick checks
SELECT count(*) FROM catalog.artists;
SELECT count(*) FROM catalog.releases;
SELECT pg_size_pretty(pg_database_size('dig'));
SELECT count(*) FROM pg_stat_activity;
```

## Long-Running Backfill SOP

Use this for `nohup` backfills running directly on `dig-db` machine.

### Monitor

```bash
fly ssh console -a dig-db --machine d8d1009a0702d8 -C "bash -lc 'tail -20 /tmp/q_v2_all.log; echo ---; ps -p 8467 -o pid=,stat=,etime=,cmd='"
```

### Stalled-job rule (required)

Treat backfill as stalled if all are true:
1. Process still exists.
2. No new progress line in log for 60+ minutes.
3. No completion marker (`BACKFILL_V2_COMPLETE`).

Recovery:
1. Stop stuck process.
2. Restart **release phase only** (do not rerun artist phase unless explicitly required).
3. Confirm new progress line appears within 10 minutes.

### Completion evidence (required)

Before closing the gate, capture:
1. `BACKFILL_V2_COMPLETE` log line.
2. `ANALYZE enrich.entity_quality` completion.
3. Guardrail SQL snapshot:
   - counts by `entity_type, quality_status`
   - top `quality_reason`
   - `quality_version` distribution

## MCP Smoke Test

```bash
# Against remote
MCP_URL="https://dig-mcp.fly.dev/sse" npx tsx apps/mcp/src/smoke-test.ts

# Against local
npx tsx apps/mcp/src/smoke-test.ts
```

Expected: 47/47 assertions passing.

## Search Warmup (`pg_prewarm`)

After a Postgres restart (deploy, OOM, Fly maintenance), search indexes and heap pages are cold. First queries will be slow (3-30s instead of <200ms). Run this procedure to warm them.

**When to run:** After any Postgres restart, after API deploy, or whenever cold-start latency is observed.

**Cold-cache behavior:** The batch resolution cache (60s TTL, in-process) repopulates on first request per API machine. The first search request after deploy may take 1-2s extra for cache population. This is expected and resolves automatically.

### Step 1: Warm indexes + releases table

```bash
# Open proxy in one terminal
fly proxy 15432:5432 -a dig-db

# In another terminal, run pg_prewarm (~3-5 min total)
psql "postgresql://postgres:<password>@localhost:15432/dig" <<'SQL'
-- Releases table heap pages (~5.5GB — may only partially fit in shared_buffers)
SELECT 'catalog.releases' AS tbl, pg_prewarm('catalog.releases') AS blocks;

-- FTS indexes (GIN on search_vector)
SELECT 'idx_releases_search' AS idx, pg_prewarm('catalog.idx_releases_search') AS blocks;
SELECT 'idx_artists_search' AS idx, pg_prewarm('catalog.idx_artists_search') AS blocks;
SELECT 'idx_labels_search' AS idx, pg_prewarm('catalog.idx_labels_search') AS blocks;
SELECT 'idx_masters_search' AS idx, pg_prewarm('catalog.idx_masters_search') AS blocks;

-- trgm indexes (GIN on name/title for fuzzy search)
SELECT 'idx_artists_name_trgm' AS idx, pg_prewarm('catalog.idx_artists_name_trgm') AS blocks;
SELECT 'idx_labels_name_trgm' AS idx, pg_prewarm('catalog.idx_labels_name_trgm') AS blocks;
SELECT 'idx_masters_title_trgm' AS idx, pg_prewarm('catalog.idx_masters_title_trgm') AS blocks;
SELECT 'idx_releases_title_trgm' AS idx, pg_prewarm('catalog.idx_releases_title_trgm') AS blocks;

-- ANALYZE for fresh planner stats
ANALYZE catalog.releases;
ANALYZE catalog.artists;
ANALYZE catalog.masters;
ANALYZE catalog.labels;
SQL
```

Expected: releases table ~709k blocks, indexes ~325k blocks total. Takes 3-5 minutes.

### Index sizes (reference)

| Index | Type | Size |
|-------|------|------|
| idx_releases_title_trgm | trgm | 1650 MB |
| idx_releases_search | FTS | 447 MB |
| idx_masters_title_trgm | trgm | 158 MB |
| idx_labels_name_trgm | trgm | 143 MB |
| idx_masters_search | FTS | 58 MB |
| idx_labels_search | FTS | 58 MB |
| idx_artists_name_trgm | trgm | 18 MB |
| idx_artists_search | FTS | 12 MB |

### Step 2: Verify with query set

```bash
# Run these against the API — all should return 200 in <500ms (warm)
curl -s -o /dev/null -w "artist FTS: %{time_total}s\n" \
  "https://dig-api.fly.dev/v1/search?q=radiohead&type=artist" -H "X-API-Key: warmup"
curl -s -o /dev/null -w "release FTS: %{time_total}s\n" \
  "https://dig-api.fly.dev/v1/search?q=miles+davis&type=release" -H "X-API-Key: warmup"
curl -s -o /dev/null -w "label FTS: %{time_total}s\n" \
  "https://dig-api.fly.dev/v1/search?q=warp+records&type=label" -H "X-API-Key: warmup"
curl -s -o /dev/null -w "master FTS: %{time_total}s\n" \
  "https://dig-api.fly.dev/v1/search?q=dark+side+moon&type=master" -H "X-API-Key: warmup"
curl -s -o /dev/null -w "fuzzy artist: %{time_total}s\n" \
  "https://dig-api.fly.dev/v1/search?q=radioheed&type=artist" -H "X-API-Key: warmup"
curl -s -o /dev/null -w "multi-entity: %{time_total}s\n" \
  "https://dig-api.fly.dev/v1/search?q=daft+punk" -H "X-API-Key: warmup"
curl -s -o /dev/null -w "release detail: %{time_total}s\n" \
  "https://dig-api.fly.dev/v1/releases/1" -H "X-API-Key: warmup"
```

Pass criteria: all queries < 500ms except fuzzy label (known ~3s for trgm scan on 2.3M rows).

### First warmup run (2026-03-01)

Executed against Fly Postgres (shared-cpu-2x, 4GB RAM). Results post-prewarm:

| Query | Latency |
|-------|---------|
| artist FTS (radiohead) | 149ms |
| release FTS (miles davis) | 162ms |
| label FTS (warp records) | 148ms |
| master FTS (dark side moon) | 156ms |
| fuzzy artist (radioheed) | 144ms |
| fuzzy label (warrp) | 3,258ms |
| release detail (1) | 170ms |
| multi-entity (daft punk) | 133ms |

All within SLO except fuzzy label (known — trgm scan on full label corpus).

---

## Common Incidents

### 1. Rate-limit spike (429s)

**Symptom:** Elevated 429 responses in logs.

**Diagnosis:**
```bash
# Check logs for 429s — is it one IP or distributed?
fly logs -a dig-api | grep '"status":429'

# Check Redis connectivity
fly ssh console -a dig-api -C "node -e \"const Redis=require('ioredis');const r=new Redis(process.env.REDIS_URL);r.ping().then(p=>{console.log('Redis:',p);r.quit()})\""
```

**Resolution:**
- **Single IP**: A benchmark or bot. Rate limiting is working as designed. No action needed.
- **Distributed**: Organic traffic growth. Consider raising anonymous limit or encouraging API key usage.
- **Redis down**: Rate limiter fails open (by design in alpha) — you'll see *no* 429s, which means no protection. Check Upstash dashboard.

### 2. Timeout rate > 1%

**Symptom:** `timeout_stats` on `/v1/health` shows elevated timeout counts.

**Diagnosis:**
```bash
# Check health endpoint for timeout stats
curl -s https://dig-api.fly.dev/v1/health | jq '.timeout_stats'

# Check Postgres activity
fly pg connect -a dig-db -d dig
SELECT state, count(*) FROM pg_stat_activity GROUP BY state;
SELECT query, state, now() - query_start AS duration FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 5;
```

**Resolution:**
- **Single category spiking**: Likely a new broad query pattern. Check search logs for the query. May need to add to broad-term list in `packages/domain/src/services/search.ts`.
- **All categories**: Postgres under memory pressure. Scale up:
  ```bash
  fly scale vm shared-cpu-4x --memory 2048 -a dig-db
  ```
- **Persistent**: Check if pg_trgm GIN indexes need `pg_prewarm` after a restart.

### 3. MCP SSE disconnects

**Symptom:** MCP clients report connection errors or "No active session".

**Background:** SSE requires sticky sessions. dig-mcp runs on exactly 1 machine. If the machine restarts (deploy, OOM, Fly maintenance), all SSE connections drop. Clients auto-reconnect on the next tool call.

**Diagnosis:**
```bash
# Check machine count — must be exactly 1
fly status -a dig-mcp

# Check for OOM kills
fly logs -a dig-mcp | grep -i "oom\|kill\|exit"
```

**Resolution:**
- **0 machines running**: Fly auto-stop may have stopped it. The next request will auto-start (may take 2-3s cold start).
  ```bash
  # Force start if needed
  fly machines list -a dig-mcp
  fly machines start <machine-id> -a dig-mcp
  ```
- **2+ machines running**: SSE routing will break (POST goes to wrong machine). Destroy the extra:
  ```bash
  fly machines list -a dig-mcp
  fly machines destroy <extra-machine-id> -a dig-mcp
  ```
- **Frequent OOM**: Scale up memory:
  ```bash
  fly scale vm shared-cpu-1x --memory 1024 -a dig-mcp
  ```

### 4. Postgres connection exhaustion

**Symptom:** API returns 500 errors with "too many clients" or connection timeout messages.

**Background:** Fly Postgres shared-cpu-2x supports ~25 connections. dig-api (2 machines) + dig-mcp (1 machine) = 3 connection pools.

**Diagnosis:**
```bash
fly pg connect -a dig-db -d dig
SELECT count(*) FROM pg_stat_activity;
SELECT usename, state, count(*) FROM pg_stat_activity GROUP BY usename, state;
```

**Resolution:**
- **Near limit (20+)**: Check for idle connections from crashed processes. Terminate idle ones:
  ```sql
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '10 minutes';
  ```
- **Persistent**: Scale Postgres to increase connection limit:
  ```bash
  fly scale vm shared-cpu-4x --memory 2048 -a dig-db
  ```
- **App-side**: Reduce pool size in Kysely config (currently defaults).

---

### 5. Batch mismatch (entity types 404 / empty search)

**Symptom:** Masters, releases, or labels return 404 or empty search results, while artists work fine (or vice versa). Mixed search returns only some entity types.

**Root cause (2026-03-05 incident):** Different entity types were ingested in different batches. A generic "latest batch" lookup returned the artist batch, making masters/releases/labels invisible.

**Prevention:** All routes now use `getBatchForTable()` from `@dig/domain` which resolves the correct batch per table. Results cached 60s in-memory. Import boundary rule: always import `sql` from `@dig/db`, never directly from `kysely`.

**Diagnosis:**
```bash
# Check which batches have data
fly proxy 15432:5432 -a dig-db
psql "postgresql://postgres:<password>@localhost:15432/dig" -c "
  SELECT b.id, b.status, b.created_at::date,
    EXISTS(SELECT 1 FROM catalog.artists WHERE batch_id=b.id LIMIT 1) as has_artists,
    EXISTS(SELECT 1 FROM catalog.masters WHERE batch_id=b.id LIMIT 1) as has_masters,
    EXISTS(SELECT 1 FROM catalog.releases WHERE batch_id=b.id LIMIT 1) as has_releases
  FROM ingest.dump_batches b WHERE status IN ('active','qa') ORDER BY created_at DESC;
"
```

**Resolution:** If a new ingest batch doesn't contain all entity types, this is expected — `getBatchForTable` handles it. If search or entity routes return empty despite data existing, check API logs for batch resolution errors.

---

---

## Monitoring and Alert Patterns

All API events emit structured JSON to stdout. `fly logs -a dig-api` is the primary log stream. Commands below can be run in any terminal with `flyctl` installed.

### Live log tailing by event code

```bash
# Process-level crashes (fatal — page immediately)
fly logs -a dig-api | grep -E '"code":"UNCAUGHT_EXCEPTION|UNHANDLED_REJECTION"'

# DB pool waiting threshold breach (>= 3 waiting connections)
fly logs -a dig-api | grep '"code":"POOL_WAITING_HIGH"'

# DB client / pool errors (PG connection drops)
fly logs -a dig-api | grep -E '"code":"POOL_ERROR|PG_CLIENT_ERROR"'

# Auth provider unavailable (Clerk network failure, not bad tokens)
fly logs -a dig-api | grep '"code":"AUTH_PROVIDER_UNAVAILABLE"'

# Route-level query timeouts
fly logs -a dig-api | grep '"code":"QUERY_TIMEOUT"'

# All 5xx responses
fly logs -a dig-api | grep '"status":5'
```

### Snapshot queries (non-tailing, last N minutes)

```bash
# 5xx count by route in last 100 log lines
fly logs -a dig-api --no-tail | grep '"status":5' | jq -r .route | sort | uniq -c | sort -rn

# Timeout count by route
fly logs -a dig-api --no-tail | grep '"code":"QUERY_TIMEOUT"' | jq -r .route | sort | uniq -c | sort -rn

# Pool waiting events in last 100 lines
fly logs -a dig-api --no-tail | grep '"code":"POOL_WAITING_HIGH"' | jq '{pool_total,pool_idle,pool_waiting,ts}'
```

### Alert thresholds (treat as actionable)

| Signal | Threshold | Severity |
|--------|-----------|----------|
| `UNCAUGHT_EXCEPTION` or `UNHANDLED_REJECTION` | Any occurrence | P0 — investigate immediately |
| `POOL_ERROR` or `PG_CLIENT_ERROR` | Any occurrence | P1 — check DB connectivity |
| `POOL_WAITING_HIGH` | ≥ 3 occurrences within 5 min | P1 — DB under pressure |
| `AUTH_PROVIDER_UNAVAILABLE` | ≥ 3 occurrences within 5 min | P1 — Clerk outage likely |
| 5xx on any single route | ≥ 5 in 10 min | P2 — investigate route |
| `QUERY_TIMEOUT` across all routes | > 5% of requests | P2 — DB or query plan issue |

### Usage/health snapshot

```bash
# Health + pool stats + timeout rates
curl -s https://dig-api.fly.dev/v1/health | jq '{status, postgres, timeout_stats}'

# Pool stats from usage endpoint
curl -s https://dig-api.fly.dev/v1/usage | jq '.pool'

# Machine restart count (check for crash loops)
fly status -a dig-api
```

---

## Incident Drills

### Drill A — API process crash

**Trigger signals:**
- `UNCAUGHT_EXCEPTION` or `UNHANDLED_REJECTION` in logs
- Fly health check fails, machine restarts
- Web renders degraded/fallback states

**Diagnosis steps:**
```bash
# 1. Check machine state
fly status -a dig-api

# 2. Find the crash log
fly logs -a dig-api | grep -E '"code":"UNCAUGHT_EXCEPTION|UNHANDLED_REJECTION"' | jq '{ts,code,message,stack}'

# 3. Check if both machines are healthy (one may still serve)
fly machines list -a dig-api

# 4. Verify health endpoint is reachable (Fly restarts automatically)
curl -s https://dig-api.fly.dev/v1/health | jq .status
```

**Recovery:**
- Fly auto-restarts crashed machines. If health returns `ok` within 60s: no action needed.
- If crash repeats (> 2 restarts in 10 min):
  ```bash
  # Roll back to last known-good image
  fly releases -a dig-api
  fly deploy --image registry.fly.io/dig-api:<previous-id> --config fly.api.toml
  ```
- Capture `message` + `stack` from `UNCAUGHT_EXCEPTION` log — file as P0 bug before next deploy.

**Gate criteria for drill:** Log a crash (kill -9 or forced exit), confirm Fly restarts machine within 60s, confirm health returns ok, confirm `UNCAUGHT_EXCEPTION` appears in logs.

---

### Drill B — DB connection exhaustion

**Trigger signals:**
- `POOL_WAITING_HIGH` recurring in logs
- `POOL_ERROR` or `PG_CLIENT_ERROR` events
- API 500s with "connection timeout" or "too many clients" in internal logs
- `pool.waiting > 0` in `/v1/usage` response

**Diagnosis steps:**
```bash
# 1. Check pool stats live
curl -s https://dig-api.fly.dev/v1/usage | jq '.pool'
# Expected healthy: { total: <=10, idle: >0, waiting: 0 }
# Unhealthy: waiting > 0 sustained, or total = max with idle = 0

# 2. Check POOL_WAITING_HIGH frequency
fly logs -a dig-api --no-tail | grep 'POOL_WAITING_HIGH' | wc -l

# 3. Check actual PG connections
fly ssh console -a dig-db -C "psql -U postgres dig -c \"SELECT state, count(*) FROM pg_stat_activity GROUP BY state;\""

# 4. Find long-running queries holding connections
fly ssh console -a dig-db -C "psql -U postgres dig -c \"SELECT pid, state, now() - query_start AS duration, left(query, 80) FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC LIMIT 10;\""
```

**Recovery:**
- **Idle connections piling up:** Terminate stale idle connections:
  ```bash
  fly ssh console -a dig-db -C "psql -U postgres dig -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND query_start < now() - interval '5 minutes';\""
  ```
- **Active connections at limit:** A long-running query is blocking the pool. Kill it:
  ```bash
  fly ssh console -a dig-db -C "psql -U postgres dig -c \"SELECT pg_cancel_backend(<pid>);\""
  ```
- **Sustained exhaustion:** Scale Postgres VM:
  ```bash
  fly scale vm shared-cpu-4x --memory 2048 -a dig-db
  ```
- **App-side:** Pool is capped at `max: 10`. If 2 API machines × 10 = 20 connections is hitting DB limit, reduce to `max: 8` in `packages/db/src/index.ts` and redeploy.

**Gate criteria for drill:** Observe `POOL_WAITING_HIGH` log at least once (can simulate by temporarily reducing `max` to 2 in a local test), verify warning fires, verify pool stats in `/v1/usage` show the count.

---

### Drill C — Auth provider outage (Clerk)

**Trigger signals:**
- `AUTH_PROVIDER_UNAVAILABLE` in logs (≥ 3 occurrences in 5 min)
- Signed-in users can't access `/account` or saved items
- Anonymous search and entity pages continue to work normally

**Diagnosis steps:**
```bash
# 1. Check for AUTH_PROVIDER_UNAVAILABLE logs
fly logs -a dig-api | grep '"code":"AUTH_PROVIDER_UNAVAILABLE"' | jq '{ts,detail}'

# 2. Verify anonymous search still works (must be unaffected)
curl -s "https://dig-api.fly.dev/v1/search?q=radiohead&limit=3" | jq '.results | length'

# 3. Verify Clerk status (external)
# Check: https://status.clerk.com

# 4. Check web fallback — signed-in pages should show auth error, not crash
curl -s https://app.dig.baby/account -o /dev/null -w "%{http_code}"
```

**Recovery:**
- **Clerk outage confirmed:** No action needed on our side. Anonymous search continues. Auth routes return 401. Users see "Sign in required." This is the correct fail-closed behavior.
- **False positive (our CLERK_SECRET_KEY rotated):** Update secret:
  ```bash
  fly secrets set -a dig-api CLERK_SECRET_KEY=sk_live_...
  fly secrets set -a dig-web CLERK_SECRET_KEY=sk_live_...
  ```
- **Partial Clerk degradation:** If JWT verification works but `clerk.users.getUser()` fails, `resolveUser` returns null and paid routes fail closed. Acceptable degradation — no escalation needed unless outage > 30 min.

**Gate criteria for drill:** Set `CLERK_SECRET_KEY` to a garbage value temporarily, confirm `AUTH_PROVIDER_UNAVAILABLE` or `AUTH_VERIFY_FAILED` appears in logs, confirm anonymous search returns 200, confirm `/v1/me/saved` returns 401, restore correct key.

---

## Rollback Playbooks (Type B/C changes)

### Route budget changes (statement_timeout values)

**File:** `apps/api/src/routes/v1/entities.ts`, `traversal.ts`

**Risk:** Lowering a timeout could cause legitimate slow queries to 504 that previously succeeded.

**Rollback:**
```bash
# Revert timeout constants and redeploy
fly releases -a dig-api
fly deploy --image registry.fly.io/dig-api:<previous-id> --config fly.api.toml
```

**Signal to rollback:** Spike in 504 `QUERY_TIMEOUT` on routes that were previously stable.

### Rate limit changes

**File:** `apps/api/src/app.ts`, individual route configs

**Risk:** Too-tight limits on legitimate API key holders.

**Rollback:**
```bash
# Bump ANON_RATE_LIMIT or remove route-level override, redeploy
fly deploy --config fly.api.toml --remote-only
```

**Signal to rollback:** API key holders consistently hitting 429 on non-burst traffic.

### Pool config changes

**File:** `packages/db/src/index.ts` — `POOL_CONFIG`

**Risk:** Reducing `max` could increase `POOL_WAITING_HIGH` frequency; increasing `max` could exhaust DB connections.

**Rollback:** Revert `max` value in `POOL_CONFIG` and redeploy API.

**Signal to rollback:** `POOL_WAITING_HIGH` frequency increases, or `pg_stat_activity` shows connection count near DB limit.

---

## Monitoring Gaps (Remaining)

Closed in hardening v1:
- ~~No structured crash logging~~ → `UNCAUGHT_EXCEPTION` / `UNHANDLED_REJECTION` in server.ts
- ~~No pool telemetry~~ → `POOL_WAITING_HIGH` log + pool stats in `/v1/usage`
- ~~No auth error visibility~~ → `AUTH_PROVIDER_UNAVAILABLE` / `AUTH_VERIFY_FAILED` codes
- ~~No route-level timeouts on traversal~~ → all routes now have bounded `SET LOCAL` timeouts

Still open (pre-GA):
- No external uptime monitoring (Fly health checks only — no PagerDuty/Betterstack)
- No dashboards — all metrics are structured JSON logs, no time-series aggregation
- No automated backup verification (Fly Postgres has daily backups, restore untested)
- No log drain — logs are ephemeral in Fly, lost after 7 days unless forwarded

---

## Performance Protect Mode

Activate when: sustained p99 > 2s, 5xx > 1%, POOL_WAITING_HIGH repeated, or `LOAD_SHED` events spiking.

### Signals

```bash
# LOAD_SHED events (heavy lane or traversal at concurrency cap)
fly logs -a dig-api | grep LOAD_SHED

# Timeout rate per search category (15-min window)
curl -s https://dig-api.fly.dev/v1/health | jq '.timeout_stats'

# Pool pressure
curl -s https://dig-api.fly.dev/v1/usage | jq '.pool'

# 5xx rate from logs
fly logs -a dig-api | grep '"statusCode":5' | wc -l
```

### Triage decision tree

```
Is pool.waiting >= 3?
  YES → DB is the bottleneck
        → Check active queries: fly proxy 15432:5432 -a dig-db && psql -c "SELECT pid, now()-pg_stat_activity.query_start AS elapsed, query FROM pg_stat_activity WHERE state='active' ORDER BY elapsed DESC LIMIT 10;"
        → Kill long-running queries: SELECT pg_terminate_backend(pid) WHERE elapsed > '30s'
        → Tighten heavy lane: restart API with HEAVY_LANE_CONCURRENCY=4 (fly secrets set then deploy)

Is LOAD_SHED spiking but pool healthy?
  YES → Heavy lane at capacity, core lane protected
        → Monitor: if core lane still degraded, scale API machines (see Scale Up below)
        → If acceptable: no action (load shedding is working as designed)

Is it a single route causing timeouts?
  YES → Check SCOPE_TIMEOUT_MS in traversal.ts — reduce timeout for that route
        → Or temporarily disable route via feature flag / emergency 503

Is it multi-entity search (no type filter)?
  YES → Consider enforcing type= requirement temporarily via API response hint
        → This is the known 24s worst case (4 serial DB calls on cold cache)
```

### Actions by severity

**P0 — Active brownout (users seeing errors now)**

1. Scale API machines immediately:
   ```bash
   fly scale count 3 -a dig-api
   ```
2. Reduce heavy-lane concurrency (env var — restart required):
   ```bash
   # In traversal.ts/search.ts, HEAVY_LANE_CONCURRENCY and TRAVERSAL_HEAVY_CONCURRENCY are
   # compile-time constants. For immediate relief, scale API machines instead.
   ```
3. If DB overwhelmed, kill slow queries:
   ```bash
   fly proxy 15432:5432 -a dig-db
   psql postgresql://postgres@localhost:15432/dig \
     -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '10 seconds';"
   ```
4. Restore machines after incident clears:
   ```bash
   fly scale count 2 -a dig-api
   ```

**P1 — Degraded performance (elevated latency, no hard errors)**

1. Run warmup queries to repopulate DB shared_buffers:
   ```bash
   curl -s "https://dig-api.fly.dev/v1/search?q=radiohead&type=artist" > /dev/null
   curl -s "https://dig-api.fly.dev/v1/search?q=dark+side+moon&type=master" > /dev/null
   curl -s "https://dig-api.fly.dev/v1/artists/3840/catalog_releases?limit=20" > /dev/null
   ```
2. Check for missing index after migration: run `EXPLAIN ANALYZE` on slow query.
3. If fuzzy search is slow: pg_trgm stats may be stale — `ANALYZE catalog.artists;`

**P2 — Elevated LOAD_SHED rate but no user impact**

1. Monitor for 15 minutes — if LOAD_SHED clears, no action needed.
2. If sustained, review which clients are hammering filtered release search.
3. Consider tightening `HEAVY_RATE_LIMIT` from 30/min to 15/min for that route.

### Gate criteria to exit Protect Mode

- LOAD_SHED events < 1% of search requests over 15 minutes
- pool.waiting = 0 for 5 consecutive `/v1/usage` checks
- timeout_stats shows no category at > 1% rate
- `/v1/health` returning 200 on both machines
