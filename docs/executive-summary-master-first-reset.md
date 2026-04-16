# Executive Summary: Dig Reset To A Lean Master-First Product

## Status

Dig in its current form carries the cost and complexity of a broad Discogs-derived catalog product, but the project no longer needs or benefits from that full posture.

The current system still reflects a "general music database" architecture:

- full Discogs-derived catalog stored in live Postgres
- artist, label, master, release, and version surfaces
- a lot of storage devoted to long-tail release/pressing detail
- a broad search/retrieval posture that is more expensive than the likely product direction now justifies

The project has already been simplified in one important way:

- Clerk/auth-related product complexity has been removed from the live app
- test/design-lab surfaces have been removed
- the public product is now much closer to a read-only discovery/browsing app

That cleanup exposed the real strategic question:

> Should Dig continue carrying a huge live full-catalog database, or should it be rebuilt as a much smaller, more opinionated, scene-specific product?

This document recommends the second path.

## The Problem With Current Dig

### 1. The infrastructure is too broad for the likely product value

The live database posture is expensive relative to the current state of the project:

- `dig-db` is provisioned as a large Fly Postgres instance
- the full catalog includes huge release/version volume and associated child tables
- the storage and operational complexity make sense only if Dig remains a broad all-catalog product

That no longer appears to be the best direction.

### 2. Full-catalog Discogs depth creates more noise than product clarity

For a collector-oriented browsing product, especially in dance music, the main user problem is usually not "I need every pressing row immediately."

The real problems are:

- discovery is noisy
- search returns too many near-duplicates
- label and artist browsing is cluttered
- release/version sprawl overwhelms the user
- product focus gets diluted

The current Dig shape inherits too much of that complexity instead of filtering it.

### 3. Release/version pages are costly and low-leverage

Keeping first-class `release` and `version` pages means:

- much more data retained
- more UI and routing surface
- more indexing/search complexity
- more opportunities for dead-end or duplicate-heavy flows

But for the reduced product vision, those pages may no longer be necessary if Dig can:

- show canonical master-level information
- retain cover art
- surface meaningful remix/version context
- link out to Discogs for deep pressing detail

### 4. The old broad product is no longer the right optimization target

The old direction assumed a broad structured catalog layer.

The emerging direction is different:

- smaller
- more opinionated
- scene-specific
- discovery-first
- cheaper to run

That means the infrastructure and data model should now optimize for:

- focus
- curation
- low storage cost
- low operational overhead
- clear product identity

## Proposed Product Direction

## Product Thesis

Rebuild Dig as a **master-first, styles-first browsing product** for a focused scene, initially:

- 90s house
- 90s techno
- adjacent substyles where they fit the scene intent

This is not "small Discogs."

It is:

- a scene browser
- a cleaner discovery layer
- a label/artist/master exploration product
- with Discogs as the external deep-detail destination for pressing-level obsessiveness

## Product Model

### Public-facing entities

Keep as first-class product surfaces:

- `artist`
- `label`
- `master`

Remove as first-class public product surfaces:

- `release`
- `version`

### Core UX

- search should be master-first
- artist pages should primarily show scoped master releases
- label pages should primarily show scoped master releases
- master pages should be the central destination
- users can click out to Discogs for full pressing/version detail

### What master pages should contain

Each master page should aim to answer:

- what is this release?
- who made it?
- what label ecosystem is it in?
- what styles is it part of?
- what does the tracklist look like?
- what are the notable mixes/versions/remix variants?
- where do I go on Discogs if I want every pressing?

So the page should keep:

- title
- year
- artists
- label context
- styles
- tracklist
- cover art
- related masters or scene links
- a small "notable versions/remixes" summary
- a clear outbound Discogs link

## Data Strategy

## Key principle

Do **not** prune the current live full DB in place.

Instead:

1. define the scoped catalog
2. build a new smaller DB
3. cut over to it
4. preserve a full-catalog rebuild path
5. then remove the large live DB

This is safer, cleaner, and more likely to produce actual cost savings.

## Scope should be styles-first, not genre-first

Live investigation against the current catalog showed an important taxonomy fact:

- plain `genre = House` / `genre = Techno` is not the right primary filter
- broad Discogs genre often appears as `Electronic`
- the real scene signal is stored mostly in `style`

That means scoping should be driven primarily by a locked style allowlist.

## Initial style allowlist

Recommended initial style set:

- `Acid House`
- `Acid Techno`
- `Deep House`
- `Detroit Techno`
- `Dub Techno`
- `Garage House`
- `Hard House`
- `Minimal`
- `Minimal Techno`
- `Progressive House`
- `Tech House`
- `Techno`
- `Tribal House`

Important note:

- plain `House` and plain `Techno` as styles may still be too broad
- they can be included initially, but may need tightening later if the subset remains too large or noisy

## Master-first retention logic

The ideal model is:

1. find in-scope material by style
2. derive an in-scope master set
3. retain only the minimal release-level shadow data needed to support master pages

### Master inclusion rule

A master is in-scope if:

- the master itself has an allowed style, or
- any linked release has an allowed style

### Artist closure

Keep artists linked to in-scope masters and their selected supporting release rows.

Artist pages become:

- scoped Dig artist pages
- not full Discogs-complete career pages

### Label closure

Keep labels linked to in-scope masters and their supporting release rows.

Label pages become:

- scoped Dig label pages
- not full Discogs-complete catalog pages

## Release/version policy

## Public policy

No public release/version pages.

That is the major simplification.

## Internal policy

Do **not** necessarily delete all release data.

Instead, keep a **thin release shadow layer** behind the scenes for:

- cover art lookup
- canonical Discogs outbound link
- identifying representative editions
- remix/version detection
- tracklist differences
- format differences

This is the key compromise:

- remove release/version surfaces
- keep enough release-level metadata to avoid losing meaningful music context

## Why not go pure masters-only in data?

Because in house/techno, valuable information often lives below the master:

- remix naming
- alternate mix titles
- tracklist deltas
- 12" culture
- notable EP/single variants

If Dig throws away all release-level awareness, it risks flattening precisely the details that matter in dance music.

So the right move is:

- **master-first product**
- **release-aware internals**
- **Discogs for exhaustive version detail**

## Proposed Lean Data Model

Keep as first-class stored product data:

- artists
- labels
- masters
- master artists
- master styles
- master genres
- master videos
- artist metadata needed for page context
- label metadata needed for page context
- cover art mapping or canonical release link support

Keep as limited internal support data:

- representative releases per master
- release styles/genres for scene inclusion
- minimal release summaries
- tracklist-level signals needed for remix/version awareness
- label/release joins needed to show label context correctly

Drop from the product surface:

- release pages
- version pages
- release/version routing
- release-level SEO posture
- broad pressing-first browsing

Potentially drop from the scoped DB entirely, once replacement logic exists:

- large amounts of low-signal duplicate release data
- full long-tail pressing rows that are only useful for exhaustive Discogs parity

## Proposed "Release Shadow" Model

For each in-scope master, keep only enough release-level metadata to support a richer master page.

Example fields:

- `release_discogs_id`
- `master_discogs_id`
- `title`
- `release_year`
- `country`
- `label`
- `format`
- `is_main_release`
- `has_tracklist_delta`
- `has_remix_signal`
- `discogs_url`

This can support:

- "primary version"
- "notable versions"
- "see all versions on Discogs"

without having to carry full native release/version product surfaces.

## Build Proposal

## Phase 1: Lock the product contract

Decide and document:

- Dig is now master-first
- release/version pages are removed
- Discogs is the deep-detail escape hatch
- scope is driven by scene styles

## Phase 2: Lock the style vocabulary

Create the first approved style allowlist.

Avoid trying to include every plausible edge case immediately.

Prefer:

- narrower first pass
- measure size
- widen later if needed

## Phase 3: Build the scoped catalog selection logic

Use style-driven matching to derive:

- in-scope masters
- linked artists
- linked labels
- minimal release shadows

This should happen in a new smaller DB, not by mutating the full live DB.

## Phase 4: Change app behavior to master-first

Required app changes:

- search prioritizes masters
- artist pages return masters, not release/version sprawl
- label pages return masters, not release/version sprawl
- master page becomes the primary content page
- release/version routes are removed or retired
- Discogs outbound links are added where needed

## Phase 5: Preserve remix/version awareness

Implement a master-page section such as:

- `Notable versions`
- `Key mixes`
- `See all versions on Discogs`

This should be fed by the thin release shadow layer.

## Phase 6: Cut over infrastructure

Once the scoped DB is built and the app is updated:

- point API and web to the smaller DB
- verify smoke tests
- verify key pages manually
- keep rebuild docs for the full-catalog path
- remove the large full-catalog live DB

## Operational Work Already Started

Some repo groundwork has already been added:

- `scripts/scoped-catalog-report.ts`
  - a scope-sizing/report script for a candidate scene subset
- `docs/scoped-catalog-90s-house-techno.md`
  - a cutover and rebuild planning doc

The scope-report work also surfaced two important realities:

1. taxonomy needs to be style-driven
2. some scope queries are heavy enough that final sizing should ideally be run directly on the DB host or with controlled execution, not ad hoc daytime proxy experiments

## Risks

### 1. Over-flattening the catalog

If the product becomes too master-only, it can lose meaningful dance-music nuance.

Mitigation:

- keep a release shadow layer
- preserve remix/version awareness on master pages

### 2. Style scope still too broad

Even a style-driven subset may still be larger than expected.

Mitigation:

- start with a narrower style set
- exclude or delay the broadest styles if necessary

### 3. Label/artist pages may feel incomplete

If users expect full Discogs completeness, scoped pages may feel partial.

Mitigation:

- position pages as Dig-scoped
- bias toward strong curation, not total completeness

### 4. Cover art depends on release-level linkage

If release-level linkage is cut too aggressively, cover art and external linking quality may degrade.

Mitigation:

- keep one or a few representative release links per master

## Why This Direction Is Better

This reset gives Dig:

- a clearer product identity
- far lower infrastructure burden
- less storage bloat
- less UI sprawl
- better discovery ergonomics
- a cleaner argument for why the product exists at all

Instead of being:

- a partially maintained broad Discogs clone

it becomes:

- a focused scene browser
- master-first
- style-driven
- visually clean
- collector-aware without trying to host every pressing itself

## Recommended Decision

Adopt the following as the new product/infrastructure direction:

1. Dig becomes a **master-first scene browser**
2. Scope is determined primarily by **styles**, not broad genres
3. Public **release/version pages are removed**
4. A **thin release shadow layer** is retained for cover art, remix awareness, and Discogs outbound links
5. A **new smaller scoped DB** is built
6. The large full-catalog live DB is retired only after successful cutover and recovery documentation

## Immediate Next Actions

1. Finalize the first style allowlist
2. Decide whether plain `House` / `Techno` styles are in or out for v1
3. Write the exact master inclusion contract
4. Write the exact release shadow contract
5. Update web/API requirements for master-first behavior
6. Build the new scoped DB as a replacement target

## One-Sentence Summary

Dig should stop trying to be a broad live Discogs-derived release database and instead become a smaller, style-scoped, master-first discovery product that keeps just enough release-level shadow data to preserve cover art and remix intelligence while sending deep pressing detail back to Discogs.
