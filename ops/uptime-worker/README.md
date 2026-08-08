# dig uptime watchdog

Cloudflare Worker, cron-triggered, that restarts wedged Fly machines for `dig-web` and `dig-api`.

## Why it isn't a Fly health check

Fly already has health checks on both apps and they work — on 2026-08-07 `dig-web`'s check went critical within seconds of the machine wedging. It then stayed critical for four hours, because **Fly health checks only steer the load balancer**. Machine restarts fire on process exit codes via the `[[restart]]` policy; there is no `fly.toml` setting for "restart when unhealthy".

So the restart has to come from outside. Not from inside the container either: a watchdog on the wedged machine shares the failure domain of the thing it's watching — a blocked event loop or GC thrash at the memory ceiling can take the watchdog with it. This runs off Fly, polls the URL a real visitor hits, and restarts through the Machines API.

## What it does

Every 2 minutes, per target:

1. `GET` the public health URL through the Fly proxy, 10s timeout.
2. Count consecutive failures in KV. Below 3, do nothing — one slow response isn't an outage.
3. At 3 (so ~6 minutes of sustained failure), ask the Machines API which machines are unhealthy and restart **only those**.
4. Apply the caps.

### The caps matter more than the interval

- **30 min cooldown** between restarts of the same app.
- **2 restarts per hour, maximum.** Then it stops, marks itself escalated, and reports. If two restarts didn't fix it, a third won't — it just hides the real problem behind a crash loop.
- **Restarts only started machines with non-passing checks.** If the public URL is failing but every machine reports healthy, the fault is upstream (proxy, DNS, certs) and restarting is noise. It reports `no_action` instead.

## Targets

| App | Health URL | Notes |
| --- | --- | --- |
| `dig-web` | `https://app.dig.baby/api/health` | 2 machines — a restart is invisible to users |
| `dig-api` | `https://dig-api.fly.dev/v1/health` | single machine, so a restart IS a brief outage |

## Deploy

```sh
cd ops/uptime-worker
pnpm install

# 1. KV namespace for failure counts and the restart ledger
wrangler kv namespace create STATE
# paste the returned id into wrangler.toml

# 2. Fly token. Org-scoped is simplest:
fly tokens create org -o personal
wrangler secret put FLY_API_TOKEN

#    Least-privilege alternative — app-scoped, and the worker prefers these:
#      fly tokens create deploy -a dig-web  → wrangler secret put FLY_TOKEN_DIG_WEB
#      fly tokens create deploy -a dig-api  → wrangler secret put FLY_TOKEN_DIG_API
#    A deploy token can restart machines for its app and nothing else. Worth
#    doing: an org token in a Worker can destroy every app on the account.

# 3. Optional: somewhere to send events
wrangler secret put NOTIFY_WEBHOOK

wrangler deploy
```

## Verify without waiting for cron

The Worker also answers HTTP:

- `GET /` — thresholds, live health probe per target, current KV state
- `GET /run` — force one full check cycle now

```sh
curl https://dig-uptime-watchdog.<subdomain>.workers.dev/ | jq
wrangler tail
```

To prove it actually restarts something, stop a `dig-web` machine and hit `/run` three times:

```sh
fly machine stop <id> -a dig-web
```

Two machines means this is safe to test on `dig-web`. Don't rehearse it on `dig-api` while anyone's using the site.

## Events

Logged as JSON, and POSTed to `NOTIFY_WEBHOOK` if set.

| Event | Meaning |
| --- | --- |
| `restarted` | Machines were restarted, with ids and the failure detail |
| `recovered` | Health came back after failures |
| `no_action` | Public URL failing but machines all report healthy — look upstream |
| `giving_up` | Restart cap hit, needs a human |
| `error` | Machines API or restart call failed |

## Known gaps

- The health URLs are the same shallow endpoints Fly probes. They catch a wedged process, not a site serving broken pages — if `dig-api` dies, `dig-web`'s `/api/health` still returns ok by design, so the watchdog sees `dig-api` fail and leaves `dig-web` alone. That's correct, but it means "watchdog is quiet" doesn't mean "site is good".
- Restarting is the only remedy. It cures a wedge; it does nothing for a bad deploy, and the caps exist so it stops pretending otherwise.
- No alerting destination is configured by default. Without `NOTIFY_WEBHOOK` the events go to Workers logs only, which nobody reads at 3am.
