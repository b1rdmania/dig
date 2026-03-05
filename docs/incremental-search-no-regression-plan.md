# Incremental Search (Typeahead) — No-Regression Implementation Plan

## Objective
Add live incremental search to the existing search page without reintroducing:
- dropped/late characters
- stale result overwrites
- UI flicker
- URL churn
- timeout-induced empty states

Keep explicit submit (Enter/button) as canonical and reliable.

---

## 1. Product Decision (Locked)

### 1.1 Behavior
- Typing triggers incremental search after debounce.
- Enter/search button still performs canonical search immediately.
- Incremental results are preview-quality but stable enough for production use.

### 1.2 Safety mode
- Feature flag: `NEXT_PUBLIC_INCREMENTAL_SEARCH=true|false`
- If disabled, current explicit-submit behavior remains unchanged.

### 1.3 Query threshold
- Incremental only runs when:
  - query length >= 2 (or 3 for stricter mode)
  - no unsupported heavy filter combination
- Otherwise show default/empty state without making requests.

---

## 2. Architecture

### 2.1 State model

Maintain separate state in a client search controller:

1. `inputValue`
- exact text in input; only user typing changes this

2. `committedQuery`
- query represented in URL/canonical state

3. `liveQuery`
- debounced query used for incremental API calls

4. `resultsState`
- `{ status: "idle" | "loading" | "success" | "error", query, data, error }`

5. `latestRequestId` (ref)
- monotonic number to guard out-of-order responses

6. `abortController` (ref)
- cancel in-flight request when a new one starts

Critical invariant:
- async response must never mutate `inputValue`.

### 2.2 Request lifecycle

For each debounced `liveQuery`:
1. increment `requestId`
2. abort previous controller
3. start fetch with new controller
4. on response:
   - if `requestId !== latestRequestId`, ignore
   - else update results
5. on abort:
   - silently ignore
6. on timeout/error:
   - keep previous successful results visible
   - set non-blocking hint

### 2.3 URL strategy

Preferred:
- URL updates only on submit (Enter/button)
- incremental search does not mutate URL

Alternative (only if required):
- `history.replaceState` after debounce
- never `pushState` per keystroke

---

## 3. API interaction rules

### 3.1 Endpoint
Use existing `/v1/search` contract.

### 3.2 Query params
Incremental request passes:
- `q`
- safe existing filters
- `limit` reduced for incremental (10–20)

### 3.3 Timeout
- client timeout: 2.5–3s for incremental
- on timeout: preserve previous list + subtle hint

### 3.4 Rate safety
- debounce 300ms default
- stricter debounce (400–500ms) when heavy filters present
- do not fire if trimmed query unchanged

---

## 4. UI/UX rules

1. Input stability
- No async-driven input rewrites
- No cursor jumps

2. Result rendering
- Keep previous results visible while loading
- Show subtle loading indicator only
- Show `Showing results for "..."` context

3. Error behavior
- Incremental failure must not blank results
- Inline non-blocking warning only

4. Accessibility
- `aria-label` on input
- `aria-live="polite"` for result updates
- keyboard submit unchanged

---

## 5. Next.js/React implementation details

### 5.1 Files likely touched
- `apps/web/src/components/SearchBar.tsx`
- `apps/web/src/components/SearchResults.tsx` (or wrapper)
- `apps/web/src/app/page.tsx`
- New hook: `apps/web/src/hooks/useIncrementalSearch.ts`

### 5.2 Hook contract
`useIncrementalSearch({ initialQuery, filters, enabled })` returns:
- `inputValue`, `setInputValue`
- `results`, `status`, `error`
- `onSubmit`
- `isStale`

### 5.3 Concurrency primitives
- `AbortController` for cancellation
- optional `useDeferredValue` for smooth rendering
- no URL-input sync loop while focused/typing

---

## 6. Filter preservation policy

On typeahead from results page:
- preserve safe filters (`type`, `genre`, `style`, `country`, year bounds)
- always clear `cursor`

---

## 7. Performance limits

- Incremental limit: 10–20 results
- No deep pagination in incremental mode
- Full result exploration remains via submit

---

## 8. Telemetry additions

Track:
- `search_incremental_started`
- `search_incremental_completed`
- `search_incremental_aborted`
- `search_incremental_error`
- existing `search_submitted`

Include:
- query length
- elapsed ms
- result count
- timeout/abort flags

---

## 9. Rollout plan

1. Flag off by default in production
2. Enable in staging
3. Run full test matrix
4. Enable for small alpha cohort
5. Enable globally only after metrics pass

---

## 10. Test plan

### 10.1 Unit
- Debounce fires once per burst
- Old response cannot overwrite new response
- Abort does not set error state
- Timeout preserves previous results
- Input never mutates from async response

### 10.2 Integration
- fast typing `aretha franklin` has no dropped letters
- rapid type/backspace remains stable
- Enter updates canonical search + URL
- slow network does not flicker empty
- mobile typing remains stable

### 10.3 Manual matrix
Queries:
- Prince
- James Brown
- Aretha Franklin
- Radiohead
- Radiohed
- love

Expected:
- input correctness 100%
- no stale overwrite
- no jitter

---

## 11. Acceptance criteria

### GO
- No input corruption under fast typing
- No stale response overwrite
- Timeout/error path keeps previous results visible
- Submit behavior unchanged
- Incremental p95 acceptable (target <500ms warm)

### NO-GO
- Input mutates unexpectedly
- Result list flickers empty
- URL/history spam
- mobile keypress lag

---

## 12. Execution sequence

1. Add feature flag + hook skeleton
2. Implement debounce + abort + requestId guard
3. Wire SearchBar while preserving submit mode
4. Preserve filters, clear cursor
5. Add non-blocking loading/error states
6. Add telemetry events
7. Add unit/integration tests
8. Validate staging
9. Roll out by cohort

---

## 13. Risk notes

1. URL/input sync loops are primary bug vector
- Guard: one-way sync only after navigation

2. Stale overwrite is primary data race
- Guard: requestId + abort

3. Request volume can spike
- Guard: debounce + min chars + reduced limit
