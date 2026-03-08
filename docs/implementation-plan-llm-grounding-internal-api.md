# Implementation Plan: LLM Grounding + Internal Retrieval API

Date: 2026-03-08
Owner: LLM/API agent
Priority: P0 reliability for beta assistant
Status: Ready for implementation

## 1) Problem Statement
Current beta assistant intermittently behaves like a generic chat model instead of a deterministic Dig retrieval assistant.

Observed failures include:
- false "catalog empty" when entity data exists in Dig
- speculative prose when retrieval is missing/degraded
- refusal to provide Dig URLs/pages despite known entities
- contradictory answers in the same conversation

This is primarily an orchestration/guardrail issue in `/v1/ask`, not a catalog absence issue.

## 2) Failure Transcript (Evidence)
Use this exact transcript as regression evidence.

```
hi can you show me a dig release page?

Sure! Here's a release page on Dig:
app.dig.baby/release/1 — that's the very first entry in the Discogs database, a 1979 pressing of Speak & Spell by Depeche Mode... actually, let me not guess at what's on that URL.
...
https://app.dig.baby/artist/4506398
Kasra V — Tehran-born, London-based producer and DJ, NTS Radio host...
...
could you show me a recent video from one of his EPs
That's not something I can do — I can't access URLs, play video, or browse the web.
...
https://app.dig.baby/version/9267745
Coming up empty — Kasra V doesn't have much catalogued under his name in the database yet...
...
you should be able to see what's on it through your API
Genuinely coming up empty — Kasra V isn't catalogued in Dig yet.
```

Failure interpretation:
- `artist/4506398` resolves in Dig web.
- Assistant still returns empty catalog assertions.
- Assistant policy allows speculative/non-grounded responses.

## 3) Product Contract (Non-Negotiable)
All `/v1/ask` responses must be in one of four explicit modes:
1. `grounded_success`
2. `grounded_empty`
3. `timeout_degraded`
4. `upstream_error`

Rules:
1. No speculative fallback prose.
2. No claims without retrieval evidence.
3. If evidence exists, include Dig links/IDs in output.
4. If evidence is missing due failure, state degraded/error clearly.

## 4) Architecture Change: Retrieval Profiles
Introduce retrieval profiles in domain/API orchestration.

### 4.1 `public` profile (existing behavior)
- fast timeout budget
- quality-filtered defaults
- low traversal depth
- public rate limits

### 4.2 `llm_internal` profile (new, used by `/v1/ask`)
- higher timeout budget
- isolated limiter bucket from public API traffic
- expanded traversal/credits/relations depth
- two-pass quality strategy:
  - pass A: `quality=active`
  - pass B: if empty, retry with `quality=all` rescue
- deterministic fallback ordering

### 4.3 `premium_llm` profile (future)
- same contract, larger quotas/deeper retrieval
- enable only after baseline reliability

## 5) `/v1/ask` Retrieval Pipeline
Implement as a strict staged pipeline.

### Stage A: Entity Resolution
Order:
1. explicit Dig URL/ID extraction
2. exact name match
3. alias/name variation match
4. bounded fuzzy rescue (confidence threshold)

Output:
- candidate list with match reason + score

### Stage B: Evidence Fetch
For top candidates, fetch in bounded parallel:
- entity detail
- releases/masters
- credits (release + track)
- relationships
- context/timeline (if enabled)
- media/video/linkouts where applicable

### Stage C: Coverage Check
- if candidate exists + fetch timeout/error -> `timeout_degraded` or `upstream_error`
- if full retrieval completes with zero evidence -> `grounded_empty`
- if evidence > 0 -> `grounded_success`

### Stage D: Answer Compose
- build answer strictly from evidence object
- include Dig links in plain text markdown
- include provenance summary (counts, sources)

## 6) API Contract Changes (`/v1/ask` response)
Required fields:
- `mode`
- `answer`
- `evidence` (array of entities/routes/counts)
- `provenance`
- `degraded_reason` (nullable)
- `request_id`

Backwards compatibility:
- keep existing top-level shape where needed, add fields non-destructively

## 7) Guardrails
1. Hard ban on ungrounded claims in composer.
2. Hard ban on "I can't link" messaging when Dig IDs known.
3. If internal retrieval unavailable, return structured error mode only.
4. Temperature low; deterministic prompt scaffolding.

## 8) Observability
Per ask request log structured steps:
- step name
- parameters
- row counts
- elapsed ms
- timeout/error flag
- final mode

Add aggregation counters:
- mode distribution
- false-empty incidents
- degraded rate
- upstream failure rate

## 9) Parity and Regression Tests

### 9.1 Ask-vs-Direct API parity suite
Build fixed canary set (minimum 50 entities), must include:
- artist 4506398 (Kasra V)
- version 9267745
- several rich artists (148 etc.)

Fail condition:
- direct API has evidence but `/v1/ask` returns `grounded_empty`

### 9.2 Conversation regression tests
Include scripted replay of transcript above.
Expected outcomes:
- no speculative claim on release/1
- Kasra V query returns grounded evidence or explicit degraded mode
- "show video" returns linkable media evidence if present

### 9.3 Contract tests
- mode always set
- evidence required for `grounded_success`
- degraded_reason required for degraded/error modes

## 10) UX Changes (LLM Beta Page)
1. Show mode badge (`Grounded`, `Empty`, `Degraded`, `Error`).
2. Show evidence count and top linked entities.
3. Show "retrieval partial" banner when degraded.
4. Remove any UI copy implying blind chat behavior.

## 11) Rollout Plan

### Phase 1 (internal/staging)
- implement pipeline + profile split + response modes
- keep behind feature flag

### Phase 2 (beta rollout)
- enable for LLM beta tester
- monitor mode distribution for 48h

### Phase 3 (harden)
- close false-empty bugs
- tune timeout budgets and rescue thresholds

### Phase 4 (premium prep)
- add entitlements for `premium_llm` profile
- no launch until reliability SLO passes

## 12) Reliability Gates

Gate LLM-A (contract):
- 100% `/v1/ask` responses include valid mode

Gate LLM-B (parity):
- 0 false-empty on canary set

Gate LLM-C (stability):
- degraded + upstream error combined < 5% on beta traffic window

Gate LLM-D (UX):
- zero occurrences of ungrounded fallback prose in replay tests

## 13) Execution Checklist (Copy/Paste for Agent)
1. Implement retrieval profiles (`public`, `llm_internal`) and wire `/v1/ask` to `llm_internal`.
2. Add strict staged pipeline (resolution -> evidence -> coverage -> compose).
3. Enforce explicit response modes and required mode-specific fields.
4. Add two-pass quality rescue (`active` then `all`) in `llm_internal`.
5. Add structured step logging.
6. Implement parity test suite including Kasra V + version 9267745.
7. Add transcript replay regression tests.
8. Update beta UI with mode/evidence badges.
9. Run typecheck/tests/build.
10. Deploy behind flag, monitor 48h, publish gate report.

## 14) Commands (suggested)
```bash
git checkout -b codex/llm-grounding-internal-api
npx -y pnpm@10.27.0 --filter @dig/domain typecheck
npx -y pnpm@10.27.0 --filter @dig/api typecheck
npx -y pnpm@10.27.0 --filter @dig/web typecheck
npx -y pnpm@10.27.0 --filter @dig/api test
npx -y pnpm@10.27.0 --filter @dig/web build
```

Deploy:
```bash
fly deploy --config fly.api.toml --remote-only
fly deploy --config fly.web.toml --remote-only
```

## 15) Out of Scope
- pricing/entitlements launch
- broader monetization model
- replacing current search API contracts

## 16) Success Definition
This plan is complete when:
1. Kasra V-style false-empty cases are eliminated.
2. Assistant never free-chats outside evidence.
3. All answers are explicit about grounding mode.
4. Beta users can trust that "empty" means genuinely empty or explicitly degraded.
