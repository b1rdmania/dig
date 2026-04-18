# Implementation plan — the Catalog Wall

> Phase C primitive. Replaces card-grid homepage with a vertical-strip
> catalog wall: one strip per label, cat numbers running top-to-bottom,
> grouped horizontally by scene, cross-tied by shared artists.
>
> One visual language at three zoom levels: homepage (whole wall),
> scene page (foregrounded scene), label page (one strip + neighbours).
>
> Reference brief: `docs/dig-map-visual-conceits.md`

---

## Why this plan exists

Dorothy's Acid House Love Blueprint taught us four things:
1. Make the metaphor the medium of the data
2. Hierarchy through outlines, not size
3. Density rewards close reading; don't fight it
4. Frame as a document, not a poster

The catalog wall takes those lessons but uses **the label discography sheet** as its native form rather than the circuit schematic. Honest to what dig actually is (a catalog), auto-generatable from data, sidesteps the Dorothy comparison.

---

## Scope of this plan

This plan covers **Phase C-1**: ship a working catalog wall that runs on real data, on the homepage, mobile-included, with correct typography and palette discipline. Plus the supporting ground work that compounds with it.

**In scope:**
- Scene primitive (data model + index page + slug page) — the wall needs scenes to group by
- Label cat-number rendering on existing label page strips (proves the strip format works)
- Catalog wall renderer at `/wall` (new route) — built and tested *before* we move it to `/`
- Homepage swap: `/` becomes the wall, search moves to `/search`
- Search route at `/search` (resolves the 404 we just spotted)
- Trail breadcrumb (sessionStorage-based) — small, ships independently
- OG image generation for wall snapshots

**Out of scope (Phase C-2 or later):**
- Constellation as label-page neighbourhood device (deferred)
- Hand-illustrated subway map (parked — catalog wall replaces it as the lead)
- Sleeve mosaic on scene page (deferred)
- Scene editorial copy (writer's job; we ship the template)
- Audio playback / preview (out of charter)
- User accounts, comments, ratings (explicit non-goal)

---

## Build order (engineering)

Each step is gated: typecheck + smoke + commit before the next.

### Step 1 — Scene primitive (data + API)

**Schema** (`enrich.scenes`):
```sql
CREATE TABLE enrich.scenes (
  slug              text PRIMARY KEY,
  name              text NOT NULL,
  city              text,
  era_start         int,
  era_end           int,
  parent_slug       text REFERENCES enrich.scenes(slug),
  axis              text NOT NULL,  -- 'geography' | 'sound' | 'era' | 'cluster' | 'bridge' | 'micro'
  depth             int NOT NULL DEFAULT 1,
  blurb             text,
  hero_label_id     bigint,
  palette           jsonb,          -- { ink, accent, paper_tint }
  added_at          timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE enrich.scene_labels (
  scene_slug         text REFERENCES enrich.scenes(slug) ON DELETE CASCADE,
  discogs_label_id   bigint NOT NULL,
  role               text DEFAULT 'core', -- 'core' | 'adjacent' | 'bridge'
  rank               int DEFAULT 0,       -- ordering within strip
  PRIMARY KEY (scene_slug, discogs_label_id)
);

CREATE TABLE enrich.scene_bridges (
  from_slug         text REFERENCES enrich.scenes(slug),
  to_slug           text REFERENCES enrich.scenes(slug),
  via_kind          text,    -- 'artist' | 'label' | 'sound'
  via_id            bigint,  -- artist or label discogs id
  blurb             text,
  PRIMARY KEY (from_slug, to_slug, via_kind, via_id)
);
```

**Migration**: `packages/db/migrations/015_scenes.ts`. Adds the three tables + indexes on `(scene_slug)` and `(discogs_label_id)`.

**Seed**: `packages/db/seeds/scenes.ts`. Initial 12 scenes:
1. `detroit-core` — UR, KMS, Transmat, Metroplex, Axis, Submerge, Planet E, 430 West, Sound Signature, Mahogani
2. `chicago-house` — Trax, DJ International, Dance Mania, Cajual, Relief, Underground Construction, Prescription, Strictly Jaz Unit
3. `berlin-techno` — Tresor, BPitch Control, Hardwax, Ostgut Ton, Berghain, Basic Channel, Chain Reaction
4. `dub-techno` — Basic Channel, Chain Reaction, Echocord, Echospace, Modern Love
5. `uk-bleep-warp` — Warp, FON, Skam, Rephlex, Mo'Wax (cross to bridge)
6. `cologne-minimal` — Kompakt, Profan, Force Inc, Mille Plateaux, Perlon
7. `nyc-house-garage` — Strictly Rhythm, Nervous, King Street, Henry Street, Eightball
8. `uk-jungle-dnb` — Reinforced, Moving Shadow, Metalheadz, Goldie's projects, Photek-era
9. `acid-house-uk` — Boy's Own, FFRR, Junior Boys Own, Ministry, Hard Hands
10. `electroclash-bridge` — International Deejay Gigolos, Output, Tigersushi
11. `idm-ambient` — Warp (recurs), Skam, Rephlex, Touch, Em:t, Apollo
12. `tribal-tech-house` — Eukahouse, NRK, Classic, Subliminal early

Each scene seed: name, city, era window, axis, hero_label_id, palette, blurb, ranked label list.

**API endpoints** (extend `apps/api/src/routes/v1/`):
- `GET /v1/scenes` — list all scenes (slug, name, city, era, hero_label_id, label_count)
- `GET /v1/scenes/:slug` — full scene incl. labels (with cat-number range), bridges in/out
- `GET /v1/scenes/:slug/wall` — wall payload: per-label, ordered cat-numbered release list, ranked artists, palette

**Domain layer** (`packages/domain/src/`):
- `scenes.ts` — `getScene(slug)`, `listScenes()`, `getSceneWall(slug, opts)`
- Wire to `index.ts` exports

**Tests**: `packages/domain/src/__tests__/scenes.test.ts` — fixtures for one scene, assert ranking + cat-number ordering.

**Smoke**: `curl /v1/scenes/detroit-core/wall | jq` returns ranked label strips with cat numbers.

**Commit**: `scenes: data model + api + initial seed of 12 scenes`

---

### Step 2 — Strip rendering primitive

The smallest unit of the wall: one label's vertical strip, cat numbers + titles + year.

**Component**: `apps/web/src/components/wall/LabelStrip.tsx`
- Props: `labelId, name, palette, releases (cat_no, title, artist, year)[], height, density`
- Renders a fixed-width vertical strip:
  - Header pill: label name in stencil-mono caps, palette accent on the underline
  - Body: monospace cat numbers (left-aligned), title (small caps, truncated), artist (smaller, muted)
  - Footer: era range "1991–2003", master count
- Density modes: `compact` (homepage), `medium` (scene page), `full` (label page)

**CSS**: `apps/web/src/components/wall/LabelStrip.module.css`
- Strip: 180px wide compact, 240px medium, 320px full
- Type: stencil-mono headers, JetBrains Mono body, 11/12/14px scale
- Background: paper tint at 4% palette accent
- Border: 1px solid rule, accent-colored underline on the header pill
- Hover: lift 2px, accent glow

**Test**: render a real label (Tresor, id `4724`) on a stub page at `/_design/strip` to verify type & spacing on a real strip before doing anything dynamic.

**Commit**: `wall: LabelStrip primitive component + design preview`

---

### Step 3 — Wall renderer

The composition layer: many strips, grouped by scene, with cross-strip tie lines.

**Component**: `apps/web/src/components/wall/CatalogWall.tsx`
- Props: `scenes: SceneWall[]`, `density`, `crossLinks: TieLine[]`
- Renders horizontally-flowing scene clusters
- Each cluster: scene header (city + era + count), then strips
- Mobile: scenes stack vertically, strips inside each scene scroll horizontally (snap)
- Tie lines: SVG overlay positioned over the wall, drawn from one strip's row to another's; thin (0.5px), 30% opacity, accent of the source label

**SVG tie-line layer**: separate `<svg>` absolutely positioned over the wall, `pointer-events: none`. Updates on resize via ResizeObserver.

**Density logic**: `compact` mode caps each strip to top N releases (e.g. 25), shows "+47 more" link at the bottom. `full` shows everything.

**Tests**: snapshot test for the cluster layout at three viewport widths (mobile / tablet / desktop).

**Commit**: `wall: CatalogWall composer with scene clustering + tie lines`

---

### Step 4 — Routes

**`/wall`** — the test route. Renders the wall in compact mode for all 12 seeded scenes. Lets us iterate on visual + density on real data without touching the homepage.

**`/scene`** — index. Lists all scenes as cards (name, era, label count, hero strip preview).

**`/scene/[slug]`** — scene page. Header (name, era, blurb), then the wall foregrounded on this scene at medium density, then prose section (placeholder: "editorial coming"), then bridges (in/out) at the bottom.

**`/search`** — new route. Lifts the existing search component out of `/` into its own page. Solves the 404 the user just spotted.

**`/`** — *temporarily unchanged*. Stays as search homepage until Step 7 confirms the wall is good. We do not break the live homepage during iteration.

**Commit**: `wall: routes for /wall, /scene, /scene/[slug], /search`

---

### Step 5 — Trail breadcrumb (independent ship)

While the wall is iterating, ship the trail. Independent of everything else.

**Component**: `apps/web/src/components/Trail.tsx`
- Reads from sessionStorage key `dig:trail` (array of `{ kind, id, name, ts }`, max 8 entries)
- On mount of any `/label/*`, `/artist/*`, `/master/*`, `/scene/*` page, push to trail
- Renders in the Header just below the logo:
  ```
  TRESOR → JEFF MILLS → AXIS → ROBERT HOOD
  ```
- Each item is a Link, last item is bold (current page). Right-most item is the current page; clicking earlier items navigates back without page state loss.
- Mobile: collapses to "← TRESOR (4)" with a tap-to-expand drawer.

**CSS**: small, mono, `var(--ink-muted)` arrows, `var(--accent)` on hover.

**No backend.** Pure client.

**Commit**: `trail: client-side breadcrumb across label/artist/master/scene pages`

---

### Step 6 — Essential picks per label

Independent of the wall but compounds with it. Currently label pages show a long discography. Add a curated "essentials" block at the top.

**Schema** (`enrich.label_essentials`):
```sql
CREATE TABLE enrich.label_essentials (
  discogs_label_id  bigint NOT NULL,
  master_discogs_id bigint NOT NULL,
  rank              int NOT NULL,
  blurb             text,
  PRIMARY KEY (discogs_label_id, master_discogs_id)
);
```

**Migration**: `016_label_essentials.ts`

**Seed**: 5–10 essentials per tier-1 label (41 labels × ~7 = ~280 rows). Curated by hand from existing tier-1 catalog inspection. Ship with empty for tier-2 (71 labels) — those get filled by the editor later.

**API**: `GET /v1/labels/:id/essentials` returns the picks with master detail.

**UI**: new `EssentialsBlock` component on `/label/[id]`, sits above the existing master list. Renders 5–10 master cards with the curated blurb.

**Commit**: `labels: essential picks block + initial seed for tier-1 labels`

---

### Step 7 — Homepage swap

Once steps 1–6 are live and the wall has been on `/wall` for at least a day of self-testing:

- Move existing search-on-homepage code to `/search` (already at `/search` from Step 4)
- Swap homepage `/` to render `<CatalogWall />` in compact mode for all scenes
- Add a search box at the top of the wall (empty state shows wall; query → `/search?q=...`)
- Add a "ways in" strip above the wall: 6 quick-entry chips (Detroit Core, Chicago House, Berlin Techno, Dub Techno, UK Bleep, Cologne Minimal) — same data as scenes, just an editor's selection of which to surface

**Update navigation**: search box in header still goes to `/search` from anywhere.

**Commit**: `homepage: catalog wall as the primary surface, search moves to /search`

---

### Step 8 — OG images

Make the wall (and each scene) shareable.

**Route**: `apps/web/src/app/api/og/wall/route.tsx`, `app/api/og/scene/[slug]/route.tsx`

**Approach**: use `@vercel/og` (already a dependency, used for existing OG generation). Render a static PNG snapshot of the catalog wall (or scene wall) at 1200×630, dark paper background, accent palette, top 3 strips per scene, scene name as headline.

**Update metadata**: each scene page sets `openGraph.images` to its OG endpoint. Homepage sets to `/api/og/wall`.

**Commit**: `og: shareable wall + scene snapshot images`

---

### Step 9 — About page link to scenes

Update the freshly-shipped `/about` page to link to `/scene` from the "Status" section ("the visual scene map" → live link).

**Commit**: `about: link scenes index from status section`

---

## Visual brief — what the wall looks like

This is the brief for the visual system. We'll iterate this in code (CSS, not Figma) on the `/wall` test route.

### Palette discipline
- **Paper**: `#f4f1e8` (existing)
- **Ink**: `#1a1a1a` (existing)
- **Ink muted**: `#8a8a82` (existing)
- **Rule**: `#d4cfbe` (existing)
- **Per-scene accent**: from the scene's hero label's palette, used at 8% as background tint behind that scene's strips, at 100% on the strip's underline, nowhere else

No new colors. Discipline = the look.

### Typography
- **Strip header (label name)**: stencil-mono caps. We need to pick a real face; shortlist:
  - Apoc Stencil (Cadson Demak) — sharp, modern stencil
  - GT America Mono Stencil
  - Or a mono stencil from the Velvetyne / Future Fonts indie scene
- **Cat numbers**: JetBrains Mono (already in use)
- **Release titles**: small caps in our existing serif, 11px, tight tracking
- **Artist names**: same serif, italic, 10px, `var(--ink-muted)`
- **Scene cluster header**: existing eyebrow style (mono caps, 11px, letter-spaced)

### Density
- Strip body in compact mode: top 25 releases per label, then "+N more"
- Strip body in full mode: every release in cat-number order
- Tie-lines drawn at <=20 per scene cluster (sample if more); avoids visual noise

### The "document" framing
- Top-right corner of the wall: a title block in the Dorothy style (without copying the schematic):
  ```
  ┌──────────────────────────────────┐
  │ DIG · CATALOG WALL               │
  │ House and techno · 1988–2003     │
  │ Edition v0.1 · 2026.04.16        │
  │ 168k labels · 81k masters · CC0  │
  └──────────────────────────────────┘
  ```
  Same vibe as Dorothy's edition stamp; different content; not a circuit.

---

## Engineering scaffolding to verify before building

1. Confirm `dig-db-scene` is the one we deploy against and has the same schema as `dig-db` (it should — confirm via migration list)
2. Confirm `enrich` schema is writable from migrations (it should — we already wrote `enrich.label_editorial`)
3. Confirm the API can read from `enrich.scenes` once seeded (Kysely schema needs regeneration after the migration)
4. Confirm `@vercel/og` is on the web package (likely — it powers existing OG)

---

## Order of operations (the actual ship sequence)

| # | Block | Dependencies | Est. time | Ship target |
|---|---|---|---|---|
| 1 | Step 1 — scenes data + api | none | 90 min | private commit |
| 2 | Step 2 — strip primitive | none | 60 min | `/`_design/strip on staging |
| 3 | Step 3 — wall composer | 1 + 2 | 90 min | private commit |
| 4 | Step 4 — routes | 3 | 45 min | `/wall`, `/scene`, `/search` live |
| 5 | Step 5 — trail | none | 45 min | live in header |
| 6 | Step 6 — essentials | none | 60 min (+ seed time) | live on tier-1 labels |
| 7 | Step 7 — homepage swap | 1–4 | 30 min | `/` becomes wall |
| 8 | Step 8 — OG images | 1 + 7 | 60 min | shareable |
| 9 | Step 9 — about link | 7 | 5 min | live |

**Total active build: ~7 hours of focused work.** Plus seed-data time for scenes (~2 hours of careful curation) and label essentials (~3 hours of catalog inspection). Realistic end-to-end: a strong overnight push for the engineering, plus a separate session for the seed work.

---

## What I'm doing right now

Starting at Step 1. I'll commit at the end of each step and post a brief status update with the live URL where you can see it. If anything pulls in a direction the plan didn't anticipate, I'll surface it before continuing.

The "search 404" fix lands as a side-effect of Step 4 (search gets its own route).

Open question before I commit Step 7: do you want the homepage to be **wall-only**, or **wall + a small persistent search bar at the top**? My vote is the latter — search should always be one keystroke away — but it's your call. Default behaviour if you don't reply: ship with a small search bar pinned at the top of the wall.
