# Implementation Plan: 404 Hardening (Web + API + CI)

Date: 2026-03-10  
Owner: Web/API/Ops  
Priority: P1  
Goal: Detect, explain, and reduce real user-facing 404s on entity pages without masking true data issues.

---

## 1. Problem Statement

Intermittent 404 reports are appearing from user click-throughs on entity pages (`/artist/:id`, `/release/:id`, `/version/:id`, `/label/:id`), while broad canary sweeps are currently green.

This suggests edge-case failure modes:

1. stale/copied malformed URLs
2. route drift in generated links
3. transient deploy-window misses
4. sparse IDs that legitimately do not exist

We need observability + recovery UX + ongoing automated sweeps.

---

## 2. Scope

In scope:

1. Server-side 404 telemetry (route type + referrer + URL + UA/IP hash).
2. Daily sampled 404 sweep in CI.
3. Friendly 404 recovery page with search and nearest-entry links.
4. Runbook updates and acceptance criteria.

Out of scope:

1. SEO cohort expansion changes.
2. Entity query optimization (separate track).
3. New DB ingest quality rules.

---

## 3. Current Baseline (for reference)

Known current files:

- Web not-found component: `apps/web/src/app/not-found.tsx`
- Entity pages call `notFound()` on API `NOT_FOUND`:
  - `apps/web/src/app/artist/[id]/page.tsx`
  - `apps/web/src/app/release/[id]/page.tsx`
  - `apps/web/src/app/version/[id]/page.tsx`
  - `apps/web/src/app/label/[id]/page.tsx`
- Existing daily CI workflow:
  - `.github/workflows/regression-smoke.yml`
- Existing canary checker:
  - `scripts/no-dead-ends-check.ts`

---

## 4. Implementation Design

## 4.1 404 event capture

### Approach

Emit an explicit telemetry event whenever the web 404 page is rendered.

Use a client component mounted from `not-found.tsx` so we can read browser `location` and `document.referrer`.

### New web component

Create:

- `apps/web/src/components/NotFoundTracker.tsx`

Behavior:

1. On mount, send a single event to API (`/v1/events`) via `sendBeacon` fallback to `fetch`.
2. Event name: `web_404_viewed`.
3. Properties:
   - `p_pathname` (`window.location.pathname`)
   - `p_referrer` (`document.referrer` or empty)
   - `p_route_type` (`artist|release|version|label|other`) parsed from pathname
   - `p_user_agent` (optional truncated)
4. Debounce duplicate sends in same session + path via sessionStorage key.

### Update not-found page

Edit:

- `apps/web/src/app/not-found.tsx`

Change:

1. Replace bare `ErrorMessage` render with:
   - friendly heading
   - search CTA (`/`)
   - quick links (`/artist/3840`, `/release/21004`, `/label/281`) as recovery paths
   - include `<NotFoundTracker />`.
2. Keep semantic 404 behavior untouched.

---

## 4.2 API telemetry schema update

Edit:

- `apps/api/src/routes/v1/events.ts`

Add event allowlist entry:

- `web_404_viewed`

Validation:

1. Require `p_pathname`.
2. Optional `p_referrer`, `p_route_type`, `p_user_agent`.

No new endpoint required (reuse existing events ingestion pipeline).

---

## 4.3 Daily sampled 404 sweep script

### New script

Create:

- `scripts/route-404-sweep.ts`

Behavior:

1. Build sampled ID sets:
   - Artists from `/v1/seo/cohort?type=artists` (N=300)
   - Releases from `/v1/seo/cohort?type=releases` (N=300)
   - Labels from `/v1/seo/cohort?type=labels` (N=300)
   - Versions from release search sampling (N=100)
2. Request corresponding web routes on `WEB_URL`.
3. Record:
   - totals per route class
   - `ok/not_found/other`
   - up to 20 sample failing URLs
4. Exit policy:
   - fail only if 404 rate > threshold (see section 5)
5. Emit JSON artifact:
   - `route-404-report.json`

### Package script

Edit `package.json`:

- add `"sweep:404": "npx tsx scripts/route-404-sweep.ts"`

---

## 4.4 CI integration

Edit:

- `.github/workflows/regression-smoke.yml`

Add job:

- `route-404-sweep`

Config:

1. daily schedule with existing smoke.
2. env:
   - `API_URL=https://dig-api.fly.dev`
   - `WEB_URL=https://app.dig.baby`
3. run `npm run sweep:404`
4. upload `route-404-report.json` artifact always.

---

## 4.5 404 dashboard/readout

Short term (no new infra):

1. Query Fly logs for `web_404_viewed`.
2. Weekly summary into `docs/`:
   - top route types
   - top referrers
   - top failing paths

Optional next:

1. Add to existing usage endpoint as `404_last_24h`, `404_last_7d` counters.

---

## 5. Gates and Thresholds

Initial thresholds (tunable):

1. Sampled 404 sweep hard fail when:
   - any route class has `notFound_rate > 2%` OR
   - combined `notFound_rate > 1%`.
2. Soft warn:
   - any `other` (5xx/network) > 0.5%.

Pass conditions:

1. CI sweep green for 3 consecutive days.
2. Logged `web_404_viewed` volume stable/downward after release.
3. Recovery 404 page renders and has working internal recovery links.

---

## 6. Acceptance Checklist

1. Hit `/artist/999999999` manually:
   - receives 404 page
   - shows search CTA + recovery links
   - emits `web_404_viewed`.
2. Trigger entity not found via invalid release/version:
   - same behavior.
3. Run local:
   - `npm run sweep:404`
   - produces `route-404-report.json`.
4. CI job runs and uploads report artifact.
5. No regressions in existing no-dead-ends canary.

---

## 7. Rollout Sequence

1. Merge web tracker + 404 page improvements.
2. Merge API event allowlist update.
3. Merge 404 sweep script + CI job.
4. Deploy API then web.
5. Run one manual sweep and attach report in gate closeout.

---

## 8. Rollback

If issues appear:

1. Disable tracker event send (remove component usage in `not-found.tsx`).
2. Revert CI `route-404-sweep` job if flaky.
3. Keep friendly 404 page (safe UX improvement) unless it breaks tests.

---

## 9. Handoff Tasks for Agent

1. Implement sections 4.1–4.4.
2. Run checks:
   - `pnpm --filter @dig/web typecheck`
   - `pnpm --filter @dig/api typecheck`
   - `npm run sweep:404`
3. Submit PR with:
   - `route-404-report.json` sample output
   - screenshot of friendly 404 page
   - one log line of `web_404_viewed`.

