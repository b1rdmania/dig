# Implementation Plan: Mixtapes Phase 1 UX Closeout

Date: 2026-03-10  
Owner: Web/API  
Scope: Complete Phase 1 mixtape user flow (create + add while browsing + verify persistence).  
Out of scope: Spotify export execution (Phase 2), crates, want list UX changes.

---

## 1. Objective

Phase 1 backend is deployed (migration 021 + `/v1/me/mixtapes` routes), but UX is incomplete because users cannot add items from release/version browsing surfaces.

This plan closes that gap by shipping:

1. `AddToMixtapeButton` on release and version pages.
2. End-to-end add flow for paid users.
3. Correct sign-in/upgrade behavior for non-eligible users.
4. Verification checklist and rollback.

---

## 2. Current State (already shipped)

- DB tables exist: `auth.mixtapes`, `auth.mixtape_tracks`, `auth.spotify_tokens`, `auth.mixtape_export_jobs`.
- API routes exist:
  - `GET /v1/me/mixtapes`
  - `POST /v1/me/mixtapes`
  - `GET /v1/me/mixtapes/:id`
  - `DELETE /v1/me/mixtapes/:id`
  - `POST /v1/me/mixtapes/:id/tracks`
  - `DELETE /v1/me/mixtapes/:id/tracks/:trackId`
- Entitlement gate exists: `early_access` / `team` only for mixtapes.
- Account tab UI exists for create/list/delete.

Gap: no browsing-surface add action.

---

## 3. Build Tasks

## 3.1 Add client component

Create:

- `apps/web/src/components/AddToMixtapeButton.tsx`
- `apps/web/src/components/AddToMixtapeButton.module.css`

Behavior:

1. Uses Clerk (`useAuth`, `useUser`) like `FavoriteButton`.
2. On first open:
   - fetch `GET /v1/me/mixtapes` with bearer token.
   - cache list in component state.
3. Renders compact trigger button: `+ Mixtape`.
4. On click opens lightweight popover/menu listing user mixtapes.
5. Selecting a mixtape calls:
   - `POST /v1/me/mixtapes/:id/tracks`
   - body:
     - `source_entity_type`: `"master"` on release page, `"release"` on version page
     - `source_discogs_id`
     - `master_discogs_id` when known
     - `name` (release title)
     - `artist` (primary artist name if present)
     - `client_request_id: crypto.randomUUID()`
6. Handles responses:
   - `201`: show inline success `Added to <mixtape>`
   - duplicate/idempotent (same request): show `Already added`
   - `401`: redirect to sign-in preserving return URL
   - `403 PLAN_UPGRADE_REQUIRED`: show inline upgrade CTA to `/account`

Notes:

- Do not block page render on mixtape fetch.
- Keep this component client-only.
- No drag/drop or track picker in this step.

## 3.2 Place button on version page hero

Edit:

- `apps/web/src/components/ReleaseHero.tsx`
- `apps/web/src/components/ReleaseHero.module.css`

Placement:

- Same action row as `FavoriteButton` and `ShareBar`.
- Order: `Discogs link` → `Favorite` → `Mixtape` → `Share`.
- Mobile: wrap gracefully, no horizontal overflow.

## 3.3 Place button on master release page

Edit:

- `apps/web/src/app/release/[id]/page.tsx`
- `apps/web/src/app/release/[id]/page.module.css`

Placement:

- Same links/actions row used for favorite/share.
- Use `source_entity_type="master"` and `source_discogs_id=<master id>`.

## 3.4 Minimal type additions

Edit:

- `apps/web/src/lib/types.ts` (if needed)

Add narrow types for mixtape list/add responses used by button component.

---

## 4. UX/Behavior Rules (non-negotiable)

1. Signed-out users can click button but are redirected to sign-in.
2. Free users can open menu but on add receive upgrade prompt (no silent fail).
3. Paid users get immediate positive feedback.
4. No duplicate buttons for mixtape/wantlist in action row.
5. No layout regressions in existing release/version action bars.

---

## 5. Telemetry

Add events to existing analytics pipeline (if event schema already accepts custom names; if strict allowlist, update API first):

- `mixtape_add_clicked`
- `mixtape_add_succeeded`
- `mixtape_add_failed`
- `mixtape_upgrade_prompted`

Fields:

- `entity_type`
- `entity_id`
- `mixtape_id` (when available)
- `reason` (auth_required/plan_required/network/error_code)

---

## 6. Testing Checklist

## 6.1 Local checks

1. `pnpm --filter @dig/web typecheck`
2. `pnpm --filter @dig/api typecheck` (if telemetry schema touched)

## 6.2 Functional checks

Use three personas:

1. Signed-out
   - click `+ Mixtape` on `/release/:id` and `/version/:id`
   - expect sign-in redirect.
2. Free signed-in
   - menu loads mixtapes or empty.
   - add attempt returns upgrade prompt.
3. Early access signed-in
   - create mixtape in `/account`
   - add from release page
   - add from version page
   - verify presence in `/account` mixtape detail / list counts.

## 6.3 Regression checks

1. Favorite button still toggles correctly.
2. Share bar still aligns inline (no “copy link” dropped below row).
3. Release pages still render media and credits as before.

---

## 7. Deploy Plan

1. Merge code.
2. Deploy web:
   - `fly deploy --config fly.web.toml --remote-only`
3. Verify live:
   - one release page
   - one version page
   - `/account` mixtapes tab
4. Confirm no API deploy required unless telemetry allowlist changed.

---

## 8. Rollback

If UI causes issues:

1. Revert web commit and redeploy web only.
2. API/DB remains safe (additive; no data loss).

---

## 9. Follow-on (after closeout)

1. Add “View mixtape” deep link from success toast.
2. Add add-from-search results affordance.
3. Start Phase 2 Spotify export implementation using existing `spotify_tokens` and `mixtape_export_jobs`.

