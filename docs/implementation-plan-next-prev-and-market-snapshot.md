# Implementation Plan: Next/Prev Navigation + Discogs Market Snapshot (7-day cache)

Date: 2026-03-09
Owner: Web/API agent
Priority: P1 UX + commercial context
Status: Ready for execution

## 1) Goals
1. Add frictionless navigation on record pages (no dead ends): Previous/Next controls.
2. Show a lightweight price signal without forcing users to open Discogs.
3. Keep external dependencies safe via aggressive caching and fail-soft behavior.

## 2) Scope
In scope:
- `/release/[id]` and `/version/[id]` top navigation controls
- Discogs market snapshot block on release/version pages
- 7-day server cache for market data
- telemetry for nav clicks and market interactions

Out of scope:
- historical pricing charts
- user portfolio value tracking
- real-time pricing (too expensive/fragile)

## 3) Feature A — Previous/Next navigation

## 3.1 UX behavior
Placement:
- Top of content area near title/meta (above videos)

Controls:
- `Previous`
- `Next`
- optional inline context: `3 of 21 versions`

Behavior on `/release/[id]`:
- Build ordered version list from master releases (`/v1/masters/:id/releases`)
- If main release exists, use it as current when available
- Prev/Next moves within that ordered list (to `/version/:id`)

Behavior on `/version/[id]`:
- Resolve parent master
- Build ordered sibling version list
- Prev/Next within siblings

Ordering rule:
1. `release_year` ascending/descending switch (default oldest->newest for chronology OR newest->oldest if consistent with existing UI)
2. tie-breaker: `discogs_id`

Edge cases:
- No siblings: hide controls
- First/last item: disable corresponding control
- Missing master linkage: show fallback `Back to Search`

## 3.2 API/data path
Prefer existing traversal endpoints where possible:
- `GET /v1/masters/:discogs_id/releases`

If missing metadata needed for context labels, extend traversal response minimally (non-breaking).

## 3.3 Telemetry
Events:
- `release_nav_clicked`
  - `entity_type`, `entity_id`, `direction`, `position`, `total`

## 4) Feature B — Discogs market snapshot

## 4.1 What to show (v1)
Do NOT label as exact "last sold" unless source guarantees it.
Show block as:
- `Discogs market snapshot`
- `Lowest listed price`
- `Items for sale`
- `Data age` (timestamp)

If source supports it reliably, optionally include:
- `Last sold` (label as `reported by Discogs`)

## 4.2 Data source strategy
Preferred order:
1. Discogs API endpoint(s) with marketplace stats for release
2. If unavailable for entity, no block (fail-soft)

Never scrape HTML in v1.

## 4.3 Cache policy (agreed)
Cache TTL:
- 7 days (604800 seconds)

Storage:
- Redis key pattern: `market:release:{discogs_release_id}`

Payload:
- `lowest_price`
- `num_for_sale`
- `last_sold_price` (nullable)
- `currency`
- `fetched_at`
- `source`

Refresh model:
- lazy refresh on read miss/expiry
- serve stale-on-error if stale exists

## 4.4 API endpoint to add
`GET /v1/releases/:discogs_id/market`

Response:
```json
{
  "market": {
    "lowest_price": 12.5,
    "num_for_sale": 21,
    "last_sold_price": null,
    "currency": "GBP",
    "fetched_at": "2026-03-09T10:00:00Z",
    "source": "discogs_marketplace"
  }
}
```

Fail-soft:
- On external error, return `market: null` with 200 (plus hint in meta if desired)

## 4.5 UI behavior
On release/version page:
- show snapshot block if `market != null`
- show subtle label `Updated X days ago`
- include `Open on Discogs` CTA
- if no data: omit block silently

## 4.6 Telemetry
Events:
- `market_snapshot_viewed`
- `market_discogs_clicked`

## 5) Reliability and limits
1. Apply endpoint timeout budget (e.g., 2s external call) and cache fallback.
2. Rate-limit external requests via cache lock to avoid stampedes.
3. Keep this independent from core release page render path:
- load in parallel boundary, never block main page content.

## 6) Legal/terms guardrail
Before enabling globally:
1. Confirm Discogs API terms permit displaying marketplace stats in this context.
2. Add attribution in UI if required.
3. If terms unclear, keep feature flagged and internal only.

## 7) Implementation steps
1. Add API market service with Redis 7-day cache.
2. Add `/v1/releases/:id/market` route.
3. Add market types in web client.
4. Add release/version page market section (async + fail-soft).
5. Add prev/next navigation component and wire to release/version pages.
6. Add telemetry events + allowlist updates.
7. Add tests + smoke checks.
8. Deploy API then web.

## 8) Test plan

Functional:
1. Release page with known master shows prev/next.
2. Version page cycles through siblings correctly.
3. First/last state disables one button.
4. Market data appears when cache/data exists.
5. Market block hidden cleanly when unavailable.

Resilience:
1. Discogs API timeout still renders page fast.
2. Stale cache serves when refresh fails.
3. No page errors when Redis unavailable (fail-soft).

Telemetry:
1. `release_nav_clicked` accepted and counted.
2. `market_snapshot_viewed` accepted and counted.
3. `market_discogs_clicked` accepted and counted.

## 9) Rollout plan
Phase 1:
- ship prev/next navigation first (no external dependency)

Phase 2:
- deploy market snapshot behind feature flag `MARKET_SNAPSHOT_ENABLED`
- enable for a small subset / internal testing

Phase 3:
- full rollout after 48h stability + terms confirmation

## 10) Acceptance criteria
1. Users can move release-to-release with one click from both release and version pages.
2. No dead-end increase in canary checks.
3. Market snapshot loads non-blocking with 7-day cache.
4. External API failures do not degrade core page rendering.
5. Usage/telemetry shows nav and market event activity.

## 11) Commands (agent)
```bash
git checkout -b codex/next-prev-market-snapshot
npx -y pnpm@10.27.0 --filter @dig/api typecheck
npx -y pnpm@10.27.0 --filter @dig/web typecheck
npx -y pnpm@10.27.0 --filter @dig/web build
fly deploy --config fly.api.toml --remote-only
fly deploy --config fly.web.toml --remote-only
```

## 12) Risks
1. Discogs data availability inconsistency -> mitigated by fail-soft + cache.
2. Currency confusion -> include currency field and avoid conversion in v1.
3. Over-fetching external API -> mitigated by 7-day TTL + lock.

## 13) Done definition
Both features live, stable, non-blocking, and measured in telemetry with no regression in no-dead-ends UX.
