# Overnight Redesign — What Shipped (2026-04-17)

> Phase A of the ASCII-zine + LP-skeuomorphic redesign. Label-anchored,
> paper-and-ink, mono-first. Live at https://app.dig.baby.

## What's live right now

| Surface | URL | Notes |
|---|---|---|
| Home | https://app.dig.baby/ | New Wordmark, mono prompt, paper backdrop |
| Search | https://app.dig.baby/?q=warp&type=master | Terminal `ls -la` listing, primary_artist + primary_label columns |
| Label (R&S) | https://app.dig.baby/label/245 | Tier-1 sticker, jet-yellow accent, editorial blurb, roster, catalog spine |
| Label (Warp) | https://app.dig.baby/label/23528 | Same shape, Warp palette |
| Label (Basic Channel) | https://app.dig.baby/label/255 | Plain BC chrome, dub-techno blurb |
| Master | https://app.dig.baby/master/401184 | Page tinted by primary label, Side-A/B tracklist, liner notes |
| Artist | https://app.dig.baby/artist/45 | Eyebrow + new chrome (deeper rework deferred) |
| `/release/:id` | → 308 → `/master/:id` | Framework redirect, no meta refresh |
| `/version/:id` | → 308 → `/master/:id` | Same |

Smoke matrix (post-deploy):

```
== /v1/health ==                     ok
== /v1/labels/245 (R&S)              200 + tier1 + palette + blurb
== /v1/labels/23528/roster           200 + 5 artists with first/last year
== /v1/labels/23528/releases         200 + chronological + primary_artist
== /v1/search?q=aphex+twin           200 + primary_artist + primary_label
== /label/245                        200, 196kb, 2.3s
== /label/23528                      200, 200kb, 1.3s
== /master/401184                    200, 56kb, 1.1s
== /artist/45                        200, 52kb
== /release/12345                    308 → /master/12345
== /version/12345                    308 → /master/12345
== /release/abc                      404
```

## Numbers

- Migration `027_label_editorial_palette` applied to `dig-db-scene`
  (idempotent ADD COLUMN IF NOT EXISTS).
- Editorial seed: **112 / 124 labels resolved**, 41 with palette + blurb.
  (12 unresolved — they're not in the scene cut: Planet E
  Communications, Submerge, Rephlex, Studio !K7, Smallville, Output
  Recordings, etc. Add when scope expands.)
- 6 fuzzy matches confirmed (R&S Records → R & S Records, Apollo Records
  → Apollo Records (2), etc.). All visually correct except `DJ
  International Records → International Records` and `Schematic Records
  → Schematics Records` — flag these for manual review tomorrow.
- Tests: 61/61 pass. Typecheck: clean across db, domain, api, mcp, web.
- Build: 14 routes compile. /label/[id] is 2.93kb / 108kb FLJS.
  /master/[id] is 4.18kb / 110kb. /artist/[id] is 2.28kb / 108kb.

## What changed under the hood

### Database
- `enrich.label_editorial` now carries:
  `palette JSONB { accent, accent_ink }`, `blurb`, `founded_year`,
  `closed_year`, `is_active`, `location`. All nullable except
  `is_active` (default `true`).
- Seed lives in `packages/db/seeds/label_editorial_v2.csv` (42 curated
  rows) with the legacy tier1 CSV as fallback.
- Re-runnable: `DATABASE_URL=... pnpm exec tsx scripts/seed-label-editorial.ts`

### Domain
- `LabelDetail.editorial: { tier, palette, blurb, founded_year,
  closed_year, is_active, location }` — `tier` kept on root as
  `@deprecated` mirror so MCP and existing callers don't break.
- `getLabelReleases({ sort: 'chronological' })` — joins
  `catalog.masters` for `primary_artist_name`, returns `LabelMasterLink`
  with `catalog_number` (currently always null — release_shadow doesn't
  store catalog numbers in the slim shape; resolved in Phase B).
- New `getLabelRoster()` — top artists by master count, with
  `first_year` / `last_year`.
- `SearchResult` gains `primary_artist` + `primary_label` for `master`
  results — no extra round trips on the page.

### API
- `GET /v1/labels/:id` — returns `editorial` block.
- `GET /v1/labels/:id/releases?sort=chronological&limit=200` — new
  flag, capped at 200 (the slow path is bounded).
- `GET /v1/labels/:id/roster?limit=N` — new, `roster: [...]` payload.

### Frontend
- New tokens in `globals.css`:
  `--paper`, `--ink`, `--rule`, `--label-accent`/`--label-ink`,
  `--font-mono` (JetBrains Mono), `--font-sans` (IBM Plex Sans),
  `--font-serif` (Source Serif 4), `--sp-0..6`, `--fs-xs..xl`.
- Shared design components in `apps/web/src/components/design/`:
  `Page`, `Sticker`, `Stamp`, `Rule`, `MetaRow`, `Wordmark`,
  `CatalogSpine`, `RosterColumn`, `LinerNotes`, `MonoTable`,
  `TerminalListing`. Each has its own CSS module — no global leakage.
- `Page` accepts `accent` + `accentInk` so any page can adopt a
  label's identity. Master page reads it from the primary label.
- `TerminalListing` does master-first dedup at the row level (no
  duplicate releases under a master).

## What's deferred to Phase B (tomorrow's session)

- **Catalog numbers on the spine** — currently null. Need a small
  query against the source `release.labels.catno` field (or a new
  denorm column on `release_shadow`).
- **Tracklist credit grouping** — the master page renders credits in
  a single liner-notes block; doesn't yet pull producer / engineer /
  vocalist per track. Requires `master_track_credits` source.
- **Artist page proper rework** — eyebrow + chrome only. Discography
  view should adopt the same `CatalogSpine` shape, grouped by label.
- **Hero on `/`** — currently a tame mono headline. The plan calls
  for a typewriter-style rotating tagline + a "today's spin" sticker.
- **12 unresolved label seeds** — add manually once scope expands.
- **2 wrong fuzzy matches** — `DJ International Records` and
  `Schematic Records` need manual override in the seed CSV.
- **Mobile pass** — tested at desktop only. Needs a one-column
  collapse rule on the `/label` page below 720px.

## Phase C (post-alpha, stretch)

- Animated "drop the needle" intro on first label visit (Lottie /
  Rive — keep it under 50kb, can disable).
- Custom Wordmark SVG (currently CSS-only).
- Per-label sticker artwork (replace the auto-generated palette dot
  with a hand-drawn sticker per Tier-1 label).
- "On the back" — flip animation to reveal the mono catalog table
  on master pages.

## Rollback

If anything's broken in the morning:

1. **Frontend rollback:** `fly releases list -a dig-web` →
   `fly releases rollback <previous_version> -a dig-web`. Old
   pages still work because all of Phase A is additive on the
   client.
2. **API rollback:** same drill on `dig-api`. The new
   `/v1/labels/:id/roster` route disappears; everything else is
   backwards-compatible.
3. **DB rollback:** migration 027 is reversible — `pnpm --filter
   @dig/db migrate:down`. Drops the 6 new columns. Editorial seed
   data is lost, but the original tier1 rows survive.
4. **Full nuclear:** `git revert b125b61` and redeploy.

## Files touched this session

- 57 files, +4229 / -958.
- 30 new files (design components, design-system.md, implementation
  plan, migration 027, seed CSV + script, label module CSS).
- 27 modified (domain, API routes, web pages, types, layout, globals,
  Nav/Footer, SearchResults, Empty, IncrementalSearchWrapper).

Commit: `b125b61` — *redesign: ASCII-zine + LP-skeuomorphic UI, label-anchored*

## Sleep notes

- Coffee held. Caffeine still useful.
- The label pages are the anchor. The rest of the site visually
  surrenders to whatever label palette is in scope. That's the
  whole emotional move.
- Tomorrow's first job: open `/label/245` on a phone, then on a
  laptop, then on a 27" monitor. If it doesn't make you want to
  put on a Beltram record, the design has failed and we redo it.
