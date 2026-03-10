# Implementation Plan: Favorites Retention + Share Funnel Polish

Date: 2026-03-10  
Owner: Web + API + Analytics  
Priority: P1 (Favorites) / P2 (Share Funnel)  
Status: Ready for implementation handoff

---

## 1. Objective

Strengthen post-save user habit loops and improve distribution observability without introducing new external platform dependency.

Primary outcome:

1. Favorites are not only savable, but discoverable/reusable in daily flows.
2. Share behavior is measurable end-to-end (click -> channel -> downstream page view).

---

## 2. Scope

## 2.1 In scope (Phase A: Favorites retention)

1. Account favorites UX completion:
   - filter by entity type
   - sort options
   - remove selected items
2. “Recently favorited” rail on Search/Home surfaces.
3. Telemetry funnel for favorites:
   - save
   - view list
   - reopen entity from list

## 2.2 In scope (Phase B: Share funnel polish)

1. Share copy/title consistency audit (entity pages).
2. Unified share telemetry taxonomy.
3. Usage endpoint additions for share conversion summary.

## 2.3 Out of scope

1. Crates taxonomy and organization.
2. Spotify/Apple integrations.
3. Pricing plan changes.

---

## 3. Current baseline

Already shipped:

1. Save/favorite API routes (`/v1/me/saved`) and Clerk auth flow.
2. Favorite button on entity surfaces.
3. Initial account favorites list rendering.

Known gap:

1. Retrieval UX is minimal and not optimized for repeat use.
2. Share telemetry exists but not fully summarized as a usable funnel.

---

## 4. Phase A — Favorites Retention UX

## 4.1 Account favorites controls

Files:

- `apps/web/src/app/account/AccountClient.tsx`
- `apps/web/src/app/account/page.module.css`

Add:

1. Filter chips:
   - All
   - Artists
   - Releases
   - Versions
   - Labels
2. Sort dropdown:
   - Newest saved (default)
   - Oldest saved
   - Entity type (A->Z by type then ID)
3. Multi-select mode:
   - checkbox per row
   - “Remove selected” action
4. Empty-state copy:
   - “No favorites yet. Save artists, releases, versions, or labels.”

Behavior:

1. Local state filtering/sorting over server response.
2. Bulk remove executes batched DELETE requests to `/v1/me/saved/:list/:type/:id`.
3. Optimistic UI update with rollback on failure.

## 4.2 Recently favorited rail

Placement:

1. Search page (`/search` results page) above result groups.
2. Home page only if signed-in (optional if search placement is enough for v1).

Files (likely):

- `apps/web/src/app/page.tsx` (if home implemented there)
- `apps/web/src/app/search/...` or existing search results component path
- new component: `apps/web/src/components/RecentFavoritesRail.tsx`

Data:

1. Fetch `GET /v1/me/saved?list_type=favorite`.
2. Show top 8 most recent.
3. Render compact entity pills/cards linking to target route.

Guardrails:

1. Signed-out: section hidden.
2. Free/paid: both visible (favorites are free).

## 4.3 Favorites telemetry funnel

Events to emit:

1. `favorite_saved` (already inferred from toggle; normalize if needed)
2. `favorite_removed`
3. `favorites_list_viewed`
4. `favorite_reopened`
5. `favorites_bulk_remove`

Event props:

1. `entity_type`
2. `entity_id`
3. `source_surface` (`release_page|version_page|artist_page|account_list|recent_rail`)
4. `position` (for list/rail clicks)

Files:

- `apps/web/src/lib/analytics.ts`
- API allowlist in `apps/api/src/routes/v1/events.ts` (if strict)

---

## 5. Phase B — Share Funnel Polish

## 5.1 Share metadata consistency audit

Audit all entity pages for:

1. `og:title` and `twitter:title` coherence.
2. fallback description shape consistency.
3. image fallback order:
   - cover art
   - YouTube thumbnail
   - dynamic OG image

Files:

- `apps/web/src/lib/seo.ts`
- entity page metadata functions under:
  - `apps/web/src/app/artist/[id]/page.tsx`
  - `apps/web/src/app/release/[id]/page.tsx`
  - `apps/web/src/app/version/[id]/page.tsx`
  - `apps/web/src/app/label/[id]/page.tsx`

## 5.2 Share telemetry normalization

Ensure `ShareBar` emits consistent channels:

1. `copy`
2. `x`
3. `whatsapp`
4. `native`

Event:

1. `share_clicked`

Props:

1. `entity_type`
2. `entity_id`
3. `channel`
4. `route`

## 5.3 Usage endpoint enrichment (share summary)

Add metrics rollups:

1. shares_last_24h / 7d / 30d
2. shares_by_channel
3. share_to_pageview ratio (approx from telemetry)

Files:

- `apps/api/src/metrics/usage.ts`
- `apps/api/src/routes/v1/usage.ts`
- `apps/web/src/app/usage/page.tsx`

---

## 6. Acceptance Criteria

## 6.1 Favorites retention

1. Signed-in user can filter and sort favorites on `/account`.
2. Signed-in user can bulk remove favorites.
3. Recently favorited rail shows on signed-in search/home.
4. Clicking favorite in list/rail opens entity route correctly.
5. Telemetry shows favorite funnel events in usage logs.

## 6.2 Share funnel

1. All entity pages have coherent share title/description/image.
2. Share events have normalized channel taxonomy.
3. Usage page surfaces share volume + by-channel breakdown.

---

## 7. Rollout Plan

## Step 1 (safe): Favorites UI only

1. Ship filter/sort/bulk remove in account.
2. Verify no auth regressions.

## Step 2: Recent rail + funnel telemetry

1. Add recent rail on search.
2. Add events and validate ingestion.

## Step 3: Share funnel polish

1. Metadata consistency pass.
2. Usage summary additions.

---

## 8. Test Plan

1. Web typecheck:
   - `pnpm --filter @dig/web typecheck`
2. API typecheck (if metrics/events touched):
   - `pnpm --filter @dig/api typecheck`
3. Manual:
   - favorite save/remove from entity page
   - favorites list filter/sort/remove
   - recent rail click-through
   - share button channels
4. Verify events in API logs:
   - `fly logs -a dig-api | rg 'favorite_|share_clicked|favorites_'`

---

## 9. Rollback

1. If favorites UI regresses:
   - revert `AccountClient` + styles + recent rail component.
2. If telemetry changes break ingestion:
   - revert allowlist additions in `events.ts`.
3. No DB migration required for this plan (low rollback risk).

---

## 10. Handoff execution checklist (agent)

1. Implement Phase A first and submit PR.
2. Include screenshots:
   - account favorites with filters
   - account bulk remove state
   - recent favorites rail
3. Include telemetry sample lines in PR description.
4. Only start Phase B after Phase A deploy is stable for 24h.

