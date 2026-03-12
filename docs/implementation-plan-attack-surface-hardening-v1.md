# Attack Surface Hardening v1

Date: 2026-03-12  
Owner: API/Platform  
Status: READY_FOR_EXECUTION

## 0) Why this exists

Production incident on 2026-03-12 exposed a real crash path:

- `pg` connection termination triggered unhandled `Client` error events.
- API process crashed.
- Fly had no healthy candidates and returned `503`.
- Web rendered `TIMEOUT`/degraded states.

Immediate mitigation shipped in commit `accb4b5` (`packages/db/src/index.ts`) by attaching `client.on("error")` in the pool connect path.  
This document is the full hardening plan so the platform is resilient, observable, and safe under failure.

---

## 1) Scope

In scope:

1. API runtime reliability and failure containment.
2. DB connectivity and query safety.
3. Web runtime resilience against API instability.
4. Auth/entitlements failure modes (Clerk/Stripe/offline dependencies).
5. MCP and LLM route abuse/timeout controls.
6. Operational safeguards (alerts, runbooks, gates, rollout discipline).

Out of scope (v1):

1. Full WAF/CDN migration.
2. Multi-region DB architecture.
3. Complete SOC2 policy set.

---

## 2) Threat / Failure Model

Primary failure classes:

1. Process crash from unhandled async errors.
2. DB pool saturation or broken connections causing cascading timeouts.
3. Expensive query plans causing brownouts (not full crash, but service unusable).
4. Dependency flaps (Clerk/Stripe/Spotify/third-party API) degrading core flows.
5. Bot/crawler bursts exhausting machine concurrency.
6. Contract drift between routes/UI causing logical dead ends and 404 spikes.

Security/abuse classes:

1. Rate-limit bypass or weak per-route limits on expensive endpoints.
2. Prompt/tool misuse in `/v1/ask` (unexpected tool chains, cost spikes).
3. Oversharing/internal error leakage in API responses.
4. Missing auth boundaries on paid or user-specific routes.

---

## 3) Attack Surface Matrix

## 3.1 Ingress

1. `app.dig.baby` public web traffic.
2. `dig-api.fly.dev` public API traffic.
3. `dig-mcp.fly.dev` MCP traffic (anonymous + keyed).
4. Internal web->API calls from server-rendered pages.

## 3.2 High-risk routes (CPU/DB/complexity)

1. `/v1/search` (FTS + fallback paths).
2. `/v1/artists/:id/catalog_releases`.
3. `/v1/artists/:id/credits`.
4. `/v1/ask` (tool loop, multiple internal queries).
5. `/v1/events` and telemetry endpoints under bot bursts.

## 3.3 Auth/paid routes

1. `/v1/me/*` saved/favorites/mixtapes.
2. `/v1/billing/*` Stripe webhook and status.
3. `/v1/ask` when `ENTITLEMENTS_ENFORCE=true`.

## 3.4 Third-party dependencies

1. Postgres (Fly managed).
2. Redis (rate limit/cache).
3. Clerk (session/JWT).
4. Stripe (billing).
5. Anthropic/OpenAI keys on `/v1/ask`.

---

## 4) Hardening Controls (Implementation)

## 4.1 Runtime crash containment (P0/P1)

1. Keep both pool-level and client-level `pg` error handlers.
2. Add `process.on("unhandledRejection")` and `process.on("uncaughtExceptionMonitor")` structured logging in API bootstrap.
3. Never throw from error handlers.
4. Ensure health endpoint remains responsive even when non-critical routes are failing.

Acceptance:

1. Simulated DB connection drop does not terminate API process.
2. Health endpoint remains `200/503` with structured cause, not process exit.

## 4.2 DB connection resilience

1. Set explicit pool options in `createDb`:
   - `max`
   - `idleTimeoutMillis`
   - `connectionTimeoutMillis`
   - `keepAlive`
2. Add pool telemetry counters:
   - total clients
   - idle clients
   - waiting count
3. Add warning threshold log when waiting count stays elevated.

Acceptance:

1. Under synthetic burst, no uncontrolled pool growth.
2. Elevated waiting count produces logs/alerts before 503 events.

## 4.3 Query envelope and route budgets

1. Keep per-route `statement_timeout` on expensive retrieval/traversal routes.
2. Add route-level latency budgets and degraded fallback behavior:
   - hard fail with explicit degraded response,
   - never block streaming shell paths.
3. Enforce max limits on query params (`limit`, filters, cursor decoding).
4. Add denylist for pathological query patterns if needed.

Acceptance:

1. Heavy requests degrade gracefully without process churn.
2. No route performs unbounded scan under normal inputs.

## 4.4 Rate limiting and concurrency shaping

1. Keep separate anonymous vs keyed limits.
2. Add stricter limits for expensive endpoints:
   - `/v1/ask`
   - `/v1/events`
   - filtered `/v1/search` release queries
3. Add per-IP + per-key burst ceiling.
4. Tune Fly machine concurrency settings for API and web (soft/hard limits).

Acceptance:

1. Bot-like burst does not starve normal search traffic.
2. Key expensive routes return controlled 429, not broad 503.

## 4.5 Web resilience

1. Maintain Suspense + fallback copy on slow routes.
2. Keep design lab surfaces isolated and non-blocking.
3. Ensure middleware no-op path is fast when keys are absent.
4. Add explicit 404 recovery component with search entrypoint and typed route hints.

Acceptance:

1. API brownout shows fallback states, not blank/broken page.
2. No client-side infinite retry loop on failed fetch.

## 4.6 Auth and entitlement fail-safe

1. Auth dependencies must fail open for public search/retrieval.
2. Auth dependencies must fail closed for paid features (`/v1/ask` gated mode, premium actions).
3. Add structured `AUTH_PROVIDER_UNAVAILABLE` errors for visibility.
4. Cache minimal entitlement checks for short TTL to reduce auth backend chatter.

Acceptance:

1. Clerk outage does not take down anonymous search.
2. Paid routes retain predictable behavior and errors.

## 4.7 LLM endpoint guardrails

1. Keep hard caps:
   - max tool rounds
   - per-tool timeout
   - total request timeout
2. Enforce output modes (`grounded_success`, `grounded_empty`, etc.).
3. Ensure evidence binding invariant for media/results.
4. Add cost guardrails:
   - request token cap,
   - per-user monthly quota enforcement.

Acceptance:

1. `/v1/ask` cannot run unbounded loops.
2. Media cannot leak unbound IDs.

## 4.8 Observability and alerting

Required metrics:

1. API 5xx rate by route.
2. p50/p95/p99 latency by route.
3. DB pool waiting count.
4. `PG_CLIENT_ERROR` and `POOL_ERROR` count/min.
5. Fly machine restart count.
6. 404 count by route type + referrer.

Required alerts:

1. 5xx > threshold for 5 minutes.
2. Zero healthy API machines.
3. Error-event spike (`PG_CLIENT_ERROR`/`POOL_ERROR`).
4. Search timeout/degraded ratio spike.

Acceptance:

1. Alerts fire before user-visible outage persists >10 minutes.

---

## 5) Rollout Plan (Type-Ship Sequence)

Type Ship definitions:

1. Type A: Safe additive changes (logging, metrics, handlers).
2. Type B: Runtime behavior changes (timeouts, rate limits, gating).
3. Type C: Infra scaling and policy changes.

Execution order:

1. Type A first (low-risk observability and crash guards).
2. Type B second behind flags/tunable constants.
3. Type C last with measured baselines.

## Phase 1 (1-2 days): Stabilize and instrument

1. Verify `accb4b5` in all deploy targets.
2. Add process-level error monitors.
3. Add DB pool telemetry.
4. Add 404 route/referrer logging.
5. Publish dashboard query snippets in `docs/ops-runbook.md`.

Gate:

1. 24h with no API crash loop.

## Phase 2 (2-3 days): Enforce budgets

1. Route-level timeout/budget audit and standardization.
2. Per-endpoint rate-limit shaping.
3. Add stricter guardrails on `/v1/ask`.
4. Validate fail-open/fail-closed auth behavior.

Gate:

1. Synthetic burst test passes.
2. No healthy-instance depletion during controlled load.

## Phase 3 (2-4 days): Operational hardening

1. Alert rules live and tested.
2. Runbook incident drills:
   - API crash
   - DB connection exhaustion
   - auth provider outage
3. Finalize rollback playbooks for each Type B/C change.

Gate:

1. Drill completion evidence recorded in gate closeout.

---

## 6) Validation Matrix

Functional:

1. Search returns 200 under nominal load.
2. Artist/release/version pages render with fallback under degraded API.
3. Auth and billing routes behave by entitlement state.

Failure injection:

1. Simulate DB disconnect while API live.
2. Simulate dependency timeout (Clerk/Stripe stub failure).
3. Simulate burst on `/v1/search` and `/v1/events`.

Regression:

1. Existing smoke tests.
2. No-dead-ends checker.
3. Canary for timeout/fallback-rate split.

---

## 7) Ownership and Deliverables

Platform/API agent:

1. Runtime handlers, pool tuning, route budgets.
2. Rate limit shaping.
3. LLM guardrails.

Web agent:

1. Fallback UX polish.
2. 404 recovery and telemetry hooks.

Ops agent:

1. Alert thresholds and dashboards.
2. Incident drill execution.
3. Runbook updates.

Required docs updates:

1. `docs/ops-runbook.md` (new monitoring + drill commands).
2. `docs/gate-closeout-template.md` (hardening evidence section).
3. `docs/full-catalog-rollout-ledger.md` entry for hardening phases.

---

## 8) Immediate next command list (for the executing agent)

1. Add process error monitors in API startup and structured logs.
2. Add explicit pool config and expose pool metrics.
3. Implement 404 structured logging and daily report script.
4. Add per-endpoint rate-limit overrides for `/v1/ask` and `/v1/events`.
5. Run smoke + canary + burst checks.
6. Deploy API then web.
7. Produce gate closeout report with:
   - before/after 5xx
   - restart count
   - timeout/degraded ratio
   - observed pool errors.

---

## 9) Go/No-Go Criteria

GO only if all are true:

1. API health stable for 24h with no crash-loop.
2. Search 5xx below threshold.
3. No unbounded query path found in route audit.
4. Incident drill completed and documented.

Otherwise: GO-WITH-CAVEATS or NO-GO with explicit blocker list.
