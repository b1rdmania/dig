# SSR Stream Fault Watch — 48h Checklist

Date: 2026-03-16  
Scope: `dig-web` only  
Goal: confirm containment, isolate remaining `transformAlgorithm` route source, and avoid repeat OOM.

## Current baseline

- Design Lab is disabled via redirect: `/design-lab* -> /`
- Web capacity pinned in config:
  - 2 machines
  - 1024MB each
  - concurrency soft/hard: 90/120
- Telemetry shipped:
  - `ssr_render_error` (server-side via `onRequestError`)
  - `error_boundary` (client-side route/global error boundaries)

## Cadence (every 6 hours for 48 hours)

Run this at T+0h, +6h, +12h, +18h, +24h, +30h, +36h, +42h, +48h.

## Step 1 — quick health + capacity

```bash
fly status -a dig-web
fly scale show -a dig-web
```

Expected:
- both machines `started`
- count remains `2`
- memory remains `1024 MB`

If not:
- restore desired state immediately:
```bash
fly scale count 2 -a dig-web
fly scale memory 1024 -a dig-web
```

## Step 2 — route sanity

```bash
for p in / /release/21004 /version/9 /usage /design-lab; do
  code=$(curl -m 20 -sS -o /tmp/resp.out -w "%{http_code}" "https://app.dig.baby$p")
  echo "$p $code"
done
```

Expected:
- `/`, `/release/21004`, `/version/9`, `/usage` -> `200`
- `/design-lab` -> `307`

Escalate if:
- any core route is `5xx` or times out
- `/design-lab` is not redirecting

## Step 3 — SSR fault telemetry scan

```bash
fly logs -a dig-web --no-tail | rg "ssr_render_error|controller\\[kState\\]\\.transformAlgorithm|error_boundary"
```

For each `ssr_render_error`, capture:
- `timestamp`
- `digest`
- `path`
- `route_path`
- `request_id`
- `user_agent`

## Step 4 — group by offender

From captured lines, group by:
- `(digest, route_path)` count
- `(route_path)` total

Prioritize the top offender by frequency.

## Step 5 — CI gate check

Trigger:
```bash
gh workflow run "Regression Smoke"
```

Check:
```bash
gh run list --workflow "Regression Smoke" --limit 1
gh run view <RUN_ID>
```

Expected:
- `smoke` pass
- `route-404-sweep` pass
- `no-dead-ends` pass

If `no-dead-ends` fails:
- inspect with:
```bash
GH_PAGER=cat gh run view <RUN_ID> --log-failed
```
- confirm if failures are real dead-ends or transient stream faults.

## Alert thresholds

### P0 (immediate incident response)
- OOM event on `dig-web`
- repeating 503/timeout on `/` or `/release/*`
- sustained concurrency saturation logs (`hard limit reached`) with user impact

Actions:
1. keep Design Lab disabled (do not re-enable)
2. verify machine count/memory
3. rollback latest web deploy if newly introduced regression suspected

### P1 (same-day fix)
- `ssr_render_error` repeats on same `(digest, route_path)` more than 20 times in 6h
- Regression Smoke fails 2 consecutive runs

Actions:
1. patch top offending route/component first
2. redeploy web
3. re-run smoke

### P2 (observe)
- isolated telemetry lines without user-visible failures

## 48h exit criteria (close this watch)

All must be true:
1. No OOM events for 48h.
2. No P0 incidents.
3. At least 2 consecutive green `Regression Smoke` runs.
4. `ssr_render_error` trend is flat/down and no single route dominates.

If not met, keep watch open for another 24h.

## Reporting template (paste into handoff)

```text
SSR Watch Window: <start> -> <end>
Machines: <status/count/memory>
Route checks: </=..., /release/...=..., /version/...=..., /usage=..., /design-lab=...>
Telemetry totals:
- ssr_render_error: <count>
- error_boundary: <count>
Top offenders:
1) digest=<...> route_path=<...> count=<...>
2) digest=<...> route_path=<...> count=<...>
Regression Smoke:
- run <id>: <pass/fail summary>
- run <id>: <pass/fail summary>
Incidents:
- P0: <none|details>
- P1: <none|details>
Decision: <close watch|extend 24h|open incident>
```
