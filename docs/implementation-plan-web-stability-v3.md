# Implementation Plan — Web Stability v3 (Final Elimination)

Date: 2026-03-16  
Owner: Web/API agent  
Goal: eliminate recurring web instability (`transformAlgorithm` stream faults, OOM risk under burst), remove silent search failure modes, and close the 48h watch with objective gates.

---

## 0) Problem Statement

Current state is **contained but not eliminated**:
- Design Lab routes are disabled and redirected.
- Web capacity is pinned (2 machines, 1024MB each, lower per-instance concurrency).
- Regression smoke can pass, but a recurring stream runtime fault still appears intermittently:
  - `TypeError: controller[kState].transformAlgorithm is not a function`
- Under DB contention, some search paths can return `200` with empty results (timeout masked as empty), creating false negatives and operational ambiguity.

This plan closes all remaining failure classes.

---

## 1) Non-Negotiable Target Behavior

1. A timeout is never represented as `200 + []`.
2. A stream/render fault never produces an “empty success” page.
3. Under burst load, system degrades to explicit, typed errors/fallback UI (not crash loops).
4. Canary and smoke distinguish:
   - app/runtime faults,
   - data/query contention,
   - genuine dead-end content issues.

---

## 2) Phase A — Search Timeout Contract Fix (API)

### Objective
Eliminate silent empty-success semantics on timed-out searches.

### Tasks
1. Update search route timeout handling:
   - File: `apps/api/src/routes/v1/search.ts` (or active search route file)
   - Map DB statement timeout / pool timeout to explicit error response:
     - HTTP `504`
     - code: `QUERY_TIMEOUT`
     - message: deterministic timeout message
2. Ensure fallback query paths (if any) are explicit in response metadata:
   - e.g. `meta.degraded_reason = "query_timeout_fallback"` when fallback used.
3. Add regression tests:
   - timeout path returns `504`, not `200`.
   - normal empty result (real no-match) still returns `200` with empty list.

### Acceptance
- No code path in search returns `200` for timeout-induced empty results.
- Smoke queries previously showing `results=0` under contention now show `504 QUERY_TIMEOUT`.

### Rollback
- Revert search timeout mapping commit only; no schema change involved.

---

## 3) Phase B — Heavy Query Fallback (API/Domain)

### Objective
Maintain useful search under contention without saturating DB.

### Tasks
1. Implement bounded fallback query profile for artist searches:
   - Trigger: primary query timeout.
   - Characteristics:
     - index-friendly conditions only,
     - smaller projection,
     - strict limit (e.g. 10),
     - no expensive joins/ranking expansions.
2. Return explicit meta when fallback was used:
   - `meta.fallback_used = true`
   - `meta.fallback_profile = "artist_fast_path_v1"`
3. Add tests:
   - simulated timeout triggers fallback path and non-empty response when known artist exists.

### Acceptance
- Under controlled contention, top artist probes return either:
  - normal primary result, or
  - fallback result with `meta.fallback_used=true`, or
  - explicit `504`
- Never silent `200 + []` due to timeout.

### Rollback
- Feature-flag fallback profile (if added) or revert fallback commit.

---

## 4) Phase C — Stream Fault Surface Reduction (Web)

### Objective
Remove fragile render topology and guarantee deterministic fallback HTML.

### Tasks
1. Audit and simplify route trees:
   - `apps/web/src/app/artist/[id]/page.tsx`
   - `apps/web/src/app/release/[id]/page.tsx`
   - `apps/web/src/app/version/[id]/page.tsx`
2. Enforce one top-level streamed boundary per heavy page section (no nested fan-out boundaries where avoidable).
3. Ensure each page has fallback copy rendered in initial shell when streamed section fails:
   - release fallback text,
   - version fallback text,
   - artist fallback text.
4. Keep entity markers for checker classification:
   - `data-dig-entity="artist|release|version"`.

### Acceptance
- Failing render path yields fallback HTML, not empty shell interpreted as success.
- `ssr_render_error` event rate drops versus baseline and no bursty same-digest floods.

### Rollback
- Route-level revert possible per page file.

---

## 5) Phase D — CI Signal Separation (Ops/Checks)

### Objective
Make CI verdicts diagnostic and actionable, not ambiguous.

### Tasks
1. `scripts/regression-smoke.ts`:
   - classify failure categories:
     - `QUERY_TIMEOUT`
     - `EMPTY_SUCCESS_ANOMALY`
     - transport/network error
   - emit summary counts per category.
2. `scripts/no-dead-ends-check.ts`:
   - keep retry logic,
   - keep stream-fault classification non-structural,
   - output top failing entities and class.
3. Workflow sequencing:
   - keep heavy checks serialized where contention is known.

### Acceptance
- A failed run clearly states which class failed.
- No-dead-ends structural failures are genuine content/routing failures only.

### Rollback
- Revert script classification changes only.

---

## 6) Phase E — Observability + Watch Closure

### Objective
Close incident with objective evidence.

### Tasks
1. Keep telemetry active:
   - `ssr_render_error`
   - `error_boundary`
2. Use watch cadence in:
   - `docs/handoff-ssr-stream-fault-watch-48h.md`
3. Capture digest→route attribution table:
   - digest,
   - route_path,
   - count per 6h window.

### Closure Criteria (all required)
1. 2 consecutive green `Regression Smoke` runs.
2. No web OOM events for 48h.
3. No dominant repeating `(digest, route_path)` burst.
4. No `EMPTY_SUCCESS_ANOMALY` on top artist probes.

If any fail, keep watch open and patch top offender immediately.

---

## 7) Execution Order (Do Not Reorder)

1. Phase A (timeout contract)
2. Phase B (fallback profile)
3. Phase C (stream simplification)
4. Phase D (CI classification)
5. Deploy web+api
6. Run Regression Smoke
7. Start/continue 48h watch

---

## 8) Deliverables Checklist

- [ ] API search timeout contract fix merged.
- [ ] API fallback profile merged.
- [ ] Web stream topology simplification merged.
- [ ] Smoke/no-dead-ends classification updates merged.
- [ ] Deploy completed (api + web).
- [ ] Post-deploy smoke run green.
- [ ] 48h watch report complete and signed off.

---

## 9) Operator Commands (Copy/Paste)

Deploy:
```bash
fly deploy --config fly.api.toml --remote-only
fly deploy --config fly.web.toml --remote-only
```

Trigger smoke:
```bash
gh workflow run "Regression Smoke"
gh run list --workflow "Regression Smoke" --limit 3
```

Inspect failed logs:
```bash
GH_PAGER=cat gh run view <RUN_ID> --log-failed
```

Live error scan:
```bash
fly logs -a dig-web --no-tail | rg "ssr_render_error|error_boundary|transformAlgorithm"
```

---

## 10) Notes

- Design Lab remains off until this plan is fully closed.
- Do not loosen web concurrency/memory controls during watch window.
- Do not mark incident resolved on a single green run.
