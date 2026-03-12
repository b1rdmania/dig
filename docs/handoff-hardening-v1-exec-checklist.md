# Handoff: Hardening v1 Execution Checklist

Date: 2026-03-12  
Use this to execute the remaining hardening tasks in production safely (no staging exists).

## 0) Preconditions

1. Read:
   - `docs/operating-implementation-guide.md`
   - `docs/ops-runbook.md`
   - `docs/gate-closeout-hardening-v1.md`
2. Confirm deploy state:
   - `fly status -a dig-api`
   - `fly status -a dig-web`
3. Keep rollback ready:
   - latest known-good commit hash
   - `fly deploy --config fly.api.toml --remote-only` from known-good commit

---

## 1) Run Drills A/B/C (live, controlled window)

Run during low traffic and capture outputs/summaries into `docs/gate-closeout-hardening-v1.md`.

## Drill A: API crash containment

Goal: verify API does not enter crash loop and health recovers.

Commands:

```bash
fly logs -a dig-api --no-tail | rg "PG_CLIENT_ERROR|POOL_ERROR|unhandledRejection|uncaughtExceptionMonitor|could not find a good candidate"
curl -sS -w "\nHTTP:%{http_code}\n" https://dig-api.fly.dev/v1/health
for i in 1 2 3 4 5; do curl -sS -o /tmp/drillA_$i.json -w "health[$i]=%{http_code}\n" https://dig-api.fly.dev/v1/health; done
```

Pass criteria:

1. No repeated process crash signatures.
2. Health returns 200 repeatedly.
3. No sustained proxy "no known healthy instances".

## Drill B: DB connection exhaustion / pool pressure

Goal: verify pool telemetry and graceful degradation under pressure.

Commands:

```bash
curl -sS https://dig-api.fly.dev/v1/usage | jq '.pool_stats // .windows // .lifetime'
fly logs -a dig-api --no-tail | rg "POOL_WAITING_HIGH|QUERY_TIMEOUT|/v1/search|/v1/artists/:discogs_id/catalog_releases|/v1/artists/:discogs_id/credits"
```

Optional DB inspection (if needed):

```bash
fly ssh console -a dig-db -C "psql -U postgres -d dig -c \"select now(), state, count(*) from pg_stat_activity group by 1,2 order by 3 desc;\""
```

Pass criteria:

1. No API machine unhealthy churn.
2. Query timeouts return 504 contract, not 500 crashes.
3. Pool waiting warnings are visible if pressured; service remains available.

## Drill C: Clerk/Auth dependency behavior

Goal: anonymous routes fail-open; paid/auth routes fail-closed with explicit codes.

Commands:

```bash
curl -sS -o /tmp/drillC_search.json -w "search=%{http_code}\n" "https://dig-api.fly.dev/v1/search?q=radiohead&limit=5"
curl -sS -o /tmp/drillC_saved.json -w "saved=%{http_code}\n" "https://dig-api.fly.dev/v1/me/saved"
curl -sS -o /tmp/drillC_billing.json -w "billing=%{http_code}\n" "https://dig-api.fly.dev/v1/billing/status"
fly logs -a dig-api --no-tail | rg "AUTH_PROVIDER_UNAVAILABLE|AUTH_VERIFY_FAILED|AUTH_RESOLUTION_FAILED"
```

Pass criteria:

1. Public search stays available (`200`).
2. Auth routes reject cleanly (`401/403/503` as expected by config), no broad outage.

---

## 2) External Uptime Monitoring (required pre-GA)

Create checks in Betterstack/UptimeRobot/etc for:

1. `https://app.dig.baby/`
2. `https://dig-api.fly.dev/v1/health`
3. Synthetic search:
   - `https://dig-api.fly.dev/v1/search?q=radiohead&type=artist&limit=3`

Alert policy:

1. Page when 2 consecutive failures.
2. Notify Slack/email.
3. Add weekly status summary to ops review.

Record provider + check IDs in `docs/ops-runbook.md`.

---

## 3) Configure Fly Log Drain (required pre-GA)

Pick Logtail/Papertrail/etc and wire Fly log drain.

Checklist:

1. Confirm logs from `dig-api`, `dig-web`, `dig-mcp` arriving.
2. Retention >= 30 days.
3. Saved queries for:
   - `PG_CLIENT_ERROR`
   - `POOL_ERROR`
   - `QUERY_TIMEOUT`
   - `AUTH_PROVIDER_UNAVAILABLE`
   - `could not find a good candidate`

Add destination details to `docs/ops-runbook.md`.

---

## 4) Burst Test + Baseline Capture

Goal: validate hardening under controlled concurrency and capture current baseline.

Command:

```bash
cd /Users/andy/Documents/New\ project/dig-baby-mvp
npm run benchmark:search
```

Capture in `docs/gate-closeout-hardening-v1.md`:

1. p50/p95/p99 latency
2. 4xx/5xx rate
3. timeout/degraded ratio
4. machine health during run (`fly status -a dig-api`)

---

## 5) Migration 014 Parity Fix

If not already present in live `kysely_migration`, insert record once.

Command pattern:

```bash
fly ssh console -a dig-db -C "psql -U postgres -d dig -c \"select name from kysely_migration where name='014_artist_credits_indexes';\""
```

If missing:

```bash
fly ssh console -a dig-db -C "psql -U postgres -d dig -c \"insert into kysely_migration(name, timestamp) values ('014_artist_credits_indexes', now()) on conflict do nothing;\""
```

Re-check:

```bash
fly ssh console -a dig-db -C "psql -U postgres -d dig -c \"select name, timestamp from kysely_migration where name='014_artist_credits_indexes';\""
```

---

## 6) Billing Activation (after Stripe KYC)

1. Set/confirm secrets for Stripe + Clerk on `dig-api` and `dig-web`.
2. Flip:

```bash
fly secrets set -a dig-api ENTITLEMENTS_ENFORCE=true
```

3. Deploy API and run smoke:

```bash
fly deploy --config fly.api.toml --remote-only
curl -sS -o /tmp/ent_free_saved.json -w "free_saved=%{http_code}\n" https://dig-api.fly.dev/v1/me/saved
curl -sS -o /tmp/ent_search.json -w "search=%{http_code}\n" "https://dig-api.fly.dev/v1/search?q=radiohead&limit=3"
curl -sS -o /tmp/ent_ask.json -w "ask=%{http_code}\n" https://dig-api.fly.dev/v1/ask
```

Expected:

1. Search stays open for anonymous users.
2. Paid features enforce entitlement/quotas with correct status codes.

---

## 7) Gate Closeout Update

Update:

1. `docs/gate-closeout-hardening-v1.md`
2. `docs/ops-runbook.md` (monitoring/drain IDs + final drill notes)

Status labels:

1. `GO` only if all drills + monitoring + burst test complete.
2. `GO-WITH-CAVEATS` if non-critical pre-GA items remain.
3. `NO-GO` if any P0/P1 signal unresolved.
