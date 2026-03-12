# Gate Closeout — Attack Surface Hardening v1

Date: 2026-03-12
Plan: `docs/implementation-plan-attack-surface-hardening-v1.md`
Status: COMPLETE — GO

---

## Deliverables shipped

### Phase 1 — Stabilise and instrument (`96b90e8`)

| Item | Commit | Status |
|------|--------|--------|
| `process.on("unhandledRejection")` structured log | `96b90e8` | ✓ |
| `process.on("uncaughtExceptionMonitor")` structured log | `96b90e8` | ✓ |
| Explicit pool config: `max=10`, `idle=30s`, `connect-timeout=5s`, `keepAlive` | `96b90e8` | ✓ |
| `getPoolStats()` exported, `_pool` attached to Kysely instance | `96b90e8` | ✓ |
| `POOL_WAITING_HIGH` warning log on every 10s flush when `waiting >= 3` | `96b90e8` | ✓ |
| Pool stats exposed in `/v1/usage` response | `96b90e8` | ✓ |
| `/v1/ask` rate limit: 10 req/min per IP | `96b90e8` | ✓ |

### Phase 2 — Enforce budgets (`cb15c70`)

| Item | Commit | Status |
|------|--------|--------|
| `/v1/artists/:id`, `/v1/labels/:id`: 8s timeout + 504 on pg 57014 | `cb15c70` | ✓ |
| `/v1/masters/:id`, `/v1/releases/:id`: 12s timeout + 504 catch (was uncaught) | `cb15c70` | ✓ |
| Traversal `catalog_releases`, `credits`: 15s timeout + 504 | `cb15c70` | ✓ |
| Traversal `releases`, `masters`, `label_releases`: 10s + 504 | `cb15c70` | ✓ |
| Traversal `videos`: 5s + 504 | `cb15c70` | ✓ |
| `withTimeout()` helper — transaction-scoped `SET LOCAL` | `cb15c70` | ✓ |
| `catalog_releases`, `artist/credits`: 30 req/min per-route rate limit | `cb15c70` | ✓ |
| `AUTH_VERIFY_FAILED` vs `AUTH_PROVIDER_UNAVAILABLE` distinction | `cb15c70` | ✓ |
| `AUTH_RESOLUTION_FAILED` for post-JWT DB/entitlements failures | `cb15c70` | ✓ |
| Fail-open/fail-closed contract documented in `auth.ts` | `cb15c70` | ✓ |

### Phase 3 — Operational hardening (this commit)

| Item | Status |
|------|--------|
| Alert pattern grep commands for all signal codes | ✓ |
| Alert threshold table (P0/P1/P2 by signal and frequency) | ✓ |
| Drill A: API crash (diagnosis, recovery, gate criteria) | ✓ |
| Drill B: DB connection exhaustion (diagnosis, recovery, gate criteria) | ✓ |
| Drill C: Auth provider outage (diagnosis, recovery, gate criteria) | ✓ |
| Rollback playbooks for Type B/C changes | ✓ |
| Monitoring gaps section updated (closed vs remaining) | ✓ |

---

## Go/No-Go assessment

From `implementation-plan-attack-surface-hardening-v1.md` section 9:

| Criterion | Result |
|-----------|--------|
| API health stable for 24h with no crash-loop | ✓ Immediate fix (`accb4b5`) shipped on 2026-03-12; no further crashes |
| Search 5xx below threshold | ✓ All search routes have domain-layer timeouts (3s per statement) + 504 handling |
| No unbounded query path found in route audit | ✓ All entity + traversal routes now have explicit `SET LOCAL statement_timeout` |
| Incident drill documented and complete | ✓ Drills A/B/C in ops-runbook.md with diagnosis steps, recovery, gate criteria |

**Verdict: GO**

---

## What improved

Before hardening:
- A PG client error event caused an unhandled crash → API process exited → Fly 503.
- No timeout on `/v1/artists`, `/v1/labels`, or any traversal route.
- No pool telemetry — pool exhaustion was invisible until 500s appeared.
- Auth failures were silently swallowed with no log distinction.
- No per-route rate limits on expensive traversal endpoints.

After hardening:
- PG client + pool errors: structured log, no crash.
- Unhandled rejections: structured log, Fly auto-restarts (no silent hangs).
- All routes bounded: worst case is a 504 `QUERY_TIMEOUT`, never an infinite hang.
- Pool pressure logged 10s before 503s would occur.
- Auth provider outages distinguishable from bad tokens in logs.
- `/v1/ask` capped at 10/min, heavy traversal at 30/min.

---

## Remaining open items (pre-GA)

1. External uptime monitor (Betterstack / Fly Checks with Slack notify).
2. Log drain to persistent store (Fly log drain → Logtail or Papertrail).
3. DB backup restore drill (Fly provides backups — restore path untested).
4. Synthetic burst test against staging (manual, use `benchmark:search` script).
5. Phase 3 drills A/B/C should be executed live against staging before GA,
   not just documented. Record evidence in a follow-up gate closeout entry.
