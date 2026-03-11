# Implementation Plan: Design Lab Live v2 (Fully Wired Mock Site)

Date: 2026-03-11  
Owner: Web  
Status: Execute now

---

## 1. Goal

Ship a fully wired, production-safe mock site at `/design-lab/live-v2` using the new Variant-Dig visual language while keeping current production routes unchanged.

No production entity routes are modified (`/artist`, `/release`, `/version`, `/label`, `/search` remain untouched).

---

## 2. Deliverables

1. New route family:
   - `/design-lab/live-v2`
   - `/design-lab/live-v2/search`
   - `/design-lab/live-v2/artist/[id]`
   - `/design-lab/live-v2/release/[id]`
   - `/design-lab/live-v2/version/[id]`
   - `/design-lab/live-v2/label/[id]`
2. Shared v2 shell component using imported Variant-Dig structure.
3. Real Dig API data wiring for all v2 pages.
4. Updated Design Lab index with clear status labels:
   - New imports (static)
   - Live v2 (wired)
   - Live legacy (older shell)
5. Prominent media placement on release/version pages (hero + top-right media module)

---

## 3. Architecture

## 3.1 Shared shell

Create `VariantDigLiveV2Shell`:

- Visual direction from imported desktop variant.
- Responsive behavior with mobile collapse.
- Data-driven props:
  - title / subtitle
  - facts row
  - actions row (links/buttons)
  - primary list (tracks/results)
  - secondary cards/lists
  - status/error fallback

## 3.2 Data wiring approach

Reuse proven fetch patterns from existing `/design-lab/live/*` pages:

1. Keep `digFetch` usage and response guards.
2. Convert links to `/design-lab/live-v2/*`.
3. Use typed fallback rendering on missing entities.

---

## 4. Page-by-page mapping

## 4.1 Home (`/design-lab/live-v2`)

Purpose:

- Entry hub for v2 pages with real IDs.

Data:

- Static list of tested links (search/artist/release/version/label), same as legacy live home.

## 4.2 Search

Data:

- `/v1/search` with query/type params.

UI:

- Query field + submit.
- Grouped results:
  - Results list
  - Releases spotlight
  - Artists spotlight
  - Labels spotlight

## 4.3 Artist

Data:

- `/v1/artists/:id`
- `/v1/artists/:id/catalog_releases`
- `/v1/artists/:id/credits`

UI order:

1. Artist identity/profile.
2. Main releases.
3. Credits + aliases/groups.

## 4.4 Release (master)

Data:

- `/v1/masters/:id`
- `/v1/masters/:id/releases`
- `/v1/releases/:main_release_id` (if present)

UI:

1. Release hero.
2. Track list.
3. Versions, artists, media.

## 4.5 Version (pressing)

Data:

- `/v1/releases/:id`
- `/v1/masters/:master_id` (if available)

UI:

1. Pressing-specific facts first.
2. Tracks.
3. Link back to master page.

## 4.6 Label

Data:

- `/v1/labels/:id`
- `/v1/labels/:id/releases`

UI:

1. Label profile.
2. Catalog releases.
3. External links.

---

## 5. Safety constraints

1. No mutations: read-only API calls only.
2. No DB schema changes.
3. No production route replacement.
4. Keep existing `/design-lab/live` as fallback.

---

## 6. Acceptance criteria

1. All six `/design-lab/live-v2*` routes render on production.
2. Each page displays real data for known IDs.
3. Not-found entities render clear fallback + onward navigation.
4. Design Lab menu clearly distinguishes:
   - imported static variants
   - live v2 wired pages
   - legacy live shell.
5. `@dig/web` typecheck passes.

---

## 7. Rollback

1. Remove `/design-lab/live-v2*` routes from menu (or delete routes).
2. Keep old `/design-lab/live` intact.
3. No migration rollback needed.

