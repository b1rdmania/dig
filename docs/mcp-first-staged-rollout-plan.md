# MCP-First Staged Rollout Plan

## Objective
Launch Dig safely by rolling out MCP first, stabilizing contracts and operations under real usage, then opening REST API later.

## Rollout principle
- MCP is the initial public interface.
- REST API remains available internally/limited until MCP gates are passed.
- Contract stability and operational reliability are required before API broad launch.

---

## 1) Stage Map

## Stage 0 — Internal Validation (Current baseline)

Purpose:
- Verify deploy, smoke tests, and core tool correctness.

Entry criteria:
- MCP server deployable and healthy.
- Tool contract tests passing in CI.
- Basic ops runbook in place.

Exit criteria:
- 0 P0 correctness issues in internal test set.
- p95 latency and timeout rate known for each tool category.

---

## Stage 1 — Private MCP Alpha (10–30 users)

Purpose:
- Validate tool contracts, degraded behavior, and support workflow with controlled users.

Scope:
- Invite-only keys.
- MCP endpoint only.
- No broad API announcement.

Requirements:
1. Stable tool list published (`search_catalog`, `get_artist`, `get_label`, `get_master`, `get_release`, `traverse_links`).
2. Error taxonomy fixed and documented.
3. Rate limiting active by key and IP.
4. Request logging with tool name, latency, status, request_id.
5. Incident handling runbook tested once.

SLO targets (alpha):
- Success rate >= 99%
- Timeout rate < 1%
- p95 latency by tool category within current accepted envelope

Exit criteria:
- 2 consecutive weeks with no P0 contract break.
- Known P1 issues documented with mitigation.
- Positive signal from at least 5 active users.

---

## Stage 2 — Public MCP Beta

Purpose:
- Open MCP to broader audience while keeping controlled compatibility.

Scope:
- Public docs + onboarding examples.
- Increased key issuance.
- MCP remains primary external surface.

Requirements:
1. Versioned contract docs (`v1`) with additive-change policy.
2. Changelog process for tool/response changes.
3. Dashboard for latency/error/timeout/rate-limit metrics.
4. Cold-start/warmup operational procedure codified.
5. Fallback/degraded semantics visible and consistent.

Guardrails:
- Breaking changes only behind `vNext`/beta tools, never silent in `v1`.
- Additive fields only in `v1` without migration notice.

Exit criteria:
- 30-day stability window:
  - no P0 incidents
  - no unannounced contract break
  - support load manageable

---

## Stage 3 — REST API Launch (after MCP stabilizes)

Purpose:
- Open API to wider integrations with confidence that retrieval contracts are stable.

Scope:
- Public API docs + key issuance model.
- MCP + API parity maintained on core resources.

Requirements:
1. API contract frozen to same semantics as MCP where overlapping.
2. Versioning/deprecation policy published.
3. Auth/rate-limit posture validated at expected traffic.
4. Post-fix validation suite green on release candidate.
5. Runbook includes API-specific incidents and rollback.

Exit criteria:
- API launch checklist complete and approved.
- One rollback drill completed in last 30 days.

---

## 2) Versioning and Change Policy

1. MCP v1:
- Additive-only changes by default.
- No field removals/renames without version bump.

2. Breaking changes:
- Ship in `vNext` tool contract or separate endpoint.
- Announce migration window before default switch.

3. Changelog:
- Every release includes:
  - changed tools/fields
  - behavior changes
  - operational notes

---

## 3) Operational Requirements (All Stages)

1. Observability
- request_id on all responses
- per-tool latency and error counters
- timeout stats surfaced in health endpoint

2. Abuse protection
- key-based + IP-based limits
- 429 behavior documented

3. Reliability
- deploy health checks
- warmup runbook (`pg_prewarm`, cache warmup)
- rollback procedure tested

4. Contract safety
- CI contract tests required for merge
- smoke tests against live MCP before major rollout changes

---

## 4) Documentation Deliverables

Before Stage 1:
- MCP quickstart
- error taxonomy
- alpha usage policy

Before Stage 2:
- public MCP docs with examples
- changelog page/process
- SLO dashboard references

Before Stage 3:
- full API docs
- versioning/deprecation policy
- migration guide from MCP-only workflows

---

## 5) Recommended immediate next steps

1. Lock Stage 1 checklist in one gate doc.
2. Tag current MCP as `v1-alpha` baseline.
3. Start private alpha invite wave (10–30 users).
4. Run weekly gate review against SLO + incident counts.
5. Do not broaden API until Stage 2 exits cleanly.

---

## 6) Go / No-Go Summary

GO to next stage only if:
- Contract stability proven for current stage window
- Operational metrics within agreed bounds
- No unresolved P0 issues

NO-GO if:
- Any unannounced breaking contract change
- Sustained timeout/error spikes without mitigation
- On-call/incident process not keeping up

---

## Stage 1 Implementation Snapshot (2026-03-05)

Implemented in `apps/mcp/src/server.ts`:
- Structured MCP tool logs (`mcp_tool_invocation`) with:
  - `request_id`
  - `tool`
  - `status`
  - `elapsed_ms`
  - `error_code`
- Key + IP rate limiting on `/sse` and `/messages`
  - Env vars:
    - `MCP_REQUIRE_API_KEY` (default `false`)
    - `MCP_RATE_LIMIT_WINDOW_MS` (default `60000`)
    - `MCP_RATE_LIMIT_IP` (default `120`)
    - `MCP_RATE_LIMIT_KEY` (default `600`)
- Additive MCP response metadata:
  - `_mcp.request_id`
  - `_mcp.tool`
  - `_mcp.contract_version` (`v1-alpha`)
  - `_mcp.server_version`
  - `_mcp.timestamp`

Validation updates:
- `apps/mcp/src/__tests__/tools-contract.test.ts` now validates `_mcp` metadata.
- `apps/mcp/src/smoke-test.ts` checks `_mcp` presence on success/error responses.
