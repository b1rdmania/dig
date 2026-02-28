# Dig Ops Runbook (Staging Alpha)

Operational reference for the Fly.io staging deployment. For API/MCP usage, see [quickstart.md](quickstart.md).

## Infrastructure

| Resource | Name | Region | Spec |
|----------|------|--------|------|
| API | dig-api | iad | shared-cpu-1x, 512MB, 2 machines |
| MCP | dig-mcp | iad | shared-cpu-1x, 512MB, 1 machine |
| Postgres | dig-db | iad | shared-cpu-2x, 1GB RAM, 40GB disk |
| Redis | dig-redis | iad | Upstash pay-per-use |

URLs:
- API: https://dig-api.fly.dev/v1/
- MCP SSE: https://dig-mcp.fly.dev/sse
- Health: https://dig-api.fly.dev/v1/health

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

# Check deployment status
fly status -a dig-api
fly status -a dig-mcp

# View recent logs
fly logs -a dig-api
fly logs -a dig-mcp
```

## Rollback

```bash
# List recent releases to find the previous image
fly releases -a dig-api

# Roll back to a specific release
fly deploy --image registry.fly.io/dig-api:<deployment-id> --config fly.api.toml

# Verify health after rollback
curl -s https://dig-api.fly.dev/v1/health | jq
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

## MCP Smoke Test

```bash
# Against remote
MCP_URL="https://dig-mcp.fly.dev/sse" npx tsx apps/mcp/src/smoke-test.ts

# Against local
npx tsx apps/mcp/src/smoke-test.ts
```

Expected: 47/47 assertions passing.

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

## Monitoring Gaps (Alpha)

These are known gaps in the staging alpha. Not blockers for soft launch, but should be addressed before GA:

- No external uptime monitoring (Fly health checks only)
- No alerting pipeline — timeout warnings go to stdout (Fly logs)
- No dashboards — metrics are in structured JSON logs only
- No automated backup verification (Fly Postgres has daily backups, but untested restore)
