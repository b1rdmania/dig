# Phase B Shipped — Label-Centric Search + Identity (2026-04-17)

> Phase B of the redesign: turn search into a label/artist-aware
> answer surface, and turn label pages into the deepest read on the
> scene. Built on top of Phase A's ASCII-zine + LP-skeuomorphic chrome.
> Live at https://app.dig.baby.

## What's live right now

| Surface | URL | What's new |
|---|---|---|
| Search (mixed) | https://app.dig.baby/?q=warp+records | Pinned **EXACT MATCH** card (Warp Records, tier-1 palette + blurb) above the listing |
| Search (typed) | https://app.dig.baby/?q=warp+records&type=label | Type tabs persist across `?q=`; counts shown per tab |
| Label (Warp) | https://app.dig.baby/label/23528 | **Warp** SVG wordmark, Family Tree (4 sublabels), Genre Profile (IDM 49%, Techno 35% …) |
| Label (R&S) | https://app.dig.baby/label/245 | Hand-set **R&S** logo, plate fallback for sub-tier-1 |
| Label (Basic Channel) | https://app.dig.baby/label/255 | Custom typewriter wordmark |
| Label (Tresor) | https://app.dig.baby/label/9099 | Custom industrial-stencil wordmark |
| Artist (Aphex Twin) | https://app.dig.baby/artist/45 | **LABELMATES** sidecar — Boards of Canada, Autechre, Squarepusher, etc. (derived from primary label = Warp) |
| Search (untyped) | `/v1/search?q=…` | API now defaults to **mixed types**, not master-only |

## API additions

| Endpoint | Returns |
|---|---|
| `GET /v1/search?q=…` | Now: `top_match` (exact label/artist hit) + `meta.type_counts` (`{ artist, label, master, *_capped }`). `type` no longer defaults to `master` |
| `GET /v1/labels/:id` | Now includes `sublabels[]` (children where `parent_label_discogs_id = :id`) |
| `GET /v1/labels/:id/styles?limit=N` | New — top styles by master count + share-of-tagged-masters |
| `GET /v1/artists/:id/labels?limit=N` | New — artist's top primary labels by master count (powers Labelmates derivation) |

Smoke matrix (post-deploy, dig-api.fly.dev + dig-web.fly.dev):

```
== /v1/search?q=warp                 top_match=Warp(label) · counts {a:72,l:47,m:100*}
== /v1/search?q=warp+records         top_match=Warp Records (tier1 + palette + blurb)
== /v1/labels/23528                  4 sublabels (Arcola, Gift, Nucleus, Warp Films)
== /v1/labels/23528/styles?limit=8   IDM 49%, Techno 35%, Experimental 25% …
== /v1/artists/45/labels?limit=5     Warp Records (14m), R&S (3m), Rephlex (2m) …
== /label/23528                      200 · 216kb · contains "Family Tree" + "Genre Profile" + "Arcola" + "IDM"
== /artist/45                        200 ·  57kb · contains "LABELMATES"
== /?q=warp+records                  200 ·  45kb · contains "EXACT MATCH" + tabs
```

## Numbers

- API typecheck: clean across `db`, `domain`, `api`, `mcp`.
- Web typecheck: clean. Build: 14 routes compile. `/label/[id]` is 3.53kB / 109kB FLJS (was 2.93kB Phase A — +600B for Family Tree + Genre Profile + Wordmark, no JS bundle bloat from the SVG wordmarks since they're inline server-rendered).
- Test suite: **142/142 pass** (61 domain + 20 api + 18 mcp + 43 ingest).
- 10 hand-set tier-1 wordmarks shipped: R&S, Warp, Tresor, Basic Channel, Underground Resistance, Trax, Dance Mania, Axis, Ninja Tune, Mute. All other tier-1 labels fall back to a palette-tinted `PlateWordmark` so they still feel intentional.
- Sublabel coverage spot-checked: Warp (4), R&S (varies), Trax (Dance Mania is sister, not sublabel), Basic Channel (Chain Reaction, Rhythm & Sound).
- Labelmates derivation cost: 2 round trips (`/v1/artists/:id/labels` then `/v1/labels/:id/roster`), both `revalidate: 600`, both rendered inside a Suspense fallback so they never block hero paint.

## What changed in the codebase

### Domain (`packages/domain/src/`)
- `search.ts`: added `findTopMatch` (case-insensitive exact-match for labels & artists, label hit enriched with editorial palette + blurb) and `getTypeCounts` (three capped count queries; flag `*_capped: true` when at the cap so the UI can render `100+`).
- `retrieval/label.ts`: `LabelDetail.sublabels[]` populated via single `WHERE parent_label_discogs_id = ?` query, name-ordered, capped at 50.
- `traversal.ts`: added `getLabelStyles` (unnest + count over `catalog.masters.styles`) and `getArtistPrimaryLabels` (DISTINCT-COUNT by master so collab credits don't double-count).

### API (`apps/api/src/routes/v1/`)
- `search.ts`: removed implicit `type = "master"` default. Now `undefined` if not supplied → mixed-type results + counts.
- `traversal.ts`: registered `/v1/labels/:id/styles` and `/v1/artists/:id/labels`.

### Frontend (`apps/web/src/`)
- 6 new design-system components: `TopMatchCard`, `TypeTabs`, `SublabelTree`, `GenreBar`, `LabelWordmark`, `Labelmates`. All composable, all CSS-modules-scoped, all server components except the type-tabs (it reads `useSearchParams`).
- `LabelWordmark` carries 10 hand-tuned SVG wordmarks + a generic `PlateWordmark` fallback. `hasCuratedWordmark(id)` is exported for callers to decide between custom SVG vs. plate vs. plain text.
- Wired into existing surfaces:
  - `SearchResults.tsx` — pinned card + type tabs above listing, top-match entity filtered out of the listing to avoid duplication.
  - `app/label/[id]/page.tsx` — wordmark in `<h1>`, Family Tree + Genre Profile blocks in side column.
  - `app/artist/[id]/page.tsx` — Labelmates inserted between Releases and Aliases, wrapped in Suspense.

## Known limitations / deferred

- **Catalog numbers** — not stored in the slim DB; `CatalogSpine` shows `—` for catno column. Restoring requires migration 028 + a release_label_link backfill. Cancelled for Phase B; revisit when scope is justified.
- **Sub-tier-1 labels with custom typography** — only the 10 named labels above have hand-set SVGs. The plate fallback is the answer for everything else; new wordmarks land in `LabelWordmark.tsx` as `case <discogs_id>:` branches.
- **Top match for partial queries** — `findTopMatch` requires a case-insensitive *exact* string match. `q=aphex` will not pin Aphex Twin (it'd need `q=aphex twin`). This is intentional — partial matches stay in the listing where they belong.
- **Label palette for non-tier-1** — only tier-1 labels have hand-curated palettes. Generic labels render the wordmark in the default ink/paper colours.
- **Type tabs counts** — capped at 100 per type to keep the count queries cheap. UI shows `100+` when `*_capped` is true.

## What's next (Phase C / post-alpha candidates)

1. **Label palette extraction** — auto-extract a 2-color palette from a label's most-popular sleeve via the cover-art pipeline; would let every label get a tinted page without manual editorial work.
2. **More tier-1 wordmarks** — Soul Jazz, Ghost Box, Hyperdub, Planet Mu, Editions Mego, Touch, Editions PAN. Each is ~30 minutes of SVG work.
3. **Sublabel inheritance for editorial** — when a sublabel has no editorial blurb but its parent does, surface the parent blurb with attribution ("inherited from Warp Records").
4. **Artist's "scene" sidecar** — extend Labelmates to "labelmates across the artist's *top 3* labels", not just the primary one. Useful for cross-pollinated scenes (Rephlex+Warp).
5. **Genre-bar comparator** — on the search page, when the top match is a label, render its Genre Profile next to the type tabs as a one-line "what this label sounds like" preview.
6. **Catalog numbers** — see above.

## Files touched (Phase B)

```
M  apps/api/src/routes/v1/search.ts
M  apps/api/src/routes/v1/traversal.ts
M  apps/web/src/app/artist/[id]/page.tsx
M  apps/web/src/app/label/[id]/page.module.css
M  apps/web/src/app/label/[id]/page.tsx
M  apps/web/src/components/SearchResults.module.css
M  apps/web/src/components/SearchResults.tsx
M  apps/web/src/components/design/index.ts
M  apps/web/src/lib/types.ts
M  packages/domain/src/__tests__/retrieval.test.ts
M  packages/domain/src/__tests__/search.test.ts
M  packages/domain/src/index.ts
M  packages/domain/src/retrieval/index.ts
M  packages/domain/src/retrieval/label.ts
M  packages/domain/src/search.ts
M  packages/domain/src/traversal.ts
A  apps/web/src/components/design/GenreBar.{tsx,module.css}
A  apps/web/src/components/design/LabelWordmark.{tsx,module.css}
A  apps/web/src/components/design/Labelmates.{tsx,module.css}
A  apps/web/src/components/design/SublabelTree.{tsx,module.css}
A  apps/web/src/components/design/TopMatchCard.{tsx,module.css}
A  apps/web/src/components/design/TypeTabs.{tsx,module.css}
```

29 files, +1691 / −14. One commit: `a047c32`.
