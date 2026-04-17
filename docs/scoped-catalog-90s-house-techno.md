# Scoped Catalog Plan: Scene Reset (1985–2003 Electronic Dance, Master-First, Slim)

Purpose: replace the full live Discogs runtime database with a smaller, opinionated, scene-scoped Dig catalog focused on house, techno, and adjacent electronic dance from 1985–2003 — comprehensive on legitimate scene material, ruthless on junk. Master-first product surface, with release detail offloaded to Discogs.

This doc is the operational plan. The product framing lives in [`executive-summary-master-first-reset.md`](executive-summary-master-first-reset.md).

## Decision

Do not prune the current live `dig-db` in place.

Instead:

1. Build a new smaller Postgres instance (`dig-db-scene`) for the scoped catalog, in **lhr** (London).
2. Apply Kysely migrations 001–026 on the new instance — including the slim model (`025`) and the defensive drops (`026`).
3. Load only in-scope, denormed, pre-pruned rows (defined below) into the new instance.
4. Cut API and web over to the new instance after verification.
5. Keep the full-catalog rebuild path documented.
6. Delete the large full-catalog database only after the scoped stack is verified.

Reason:

- In-place deletes are risky on a working DB.
- Deleting rows does not guarantee lower hosted disk cost.
- A new smaller DB gives cleaner rollback, cleaner pricing, and natural enforcement of the new scope contract.
- The slim model (denorm + drop) means the new shape isn't reachable by simply pruning rows — it's a structural rewrite.

## Locked Scope Contract

A master is **IN** if all of these are true:

- It has at least one style in the **style allowlist**, OR at least one of its releases has a style in the allowlist.
- Its effective year (`master.year`, or `release_year` fallback) is in `[1985, 2003]`.
- Its `enrich.entity_quality.quality_status = 'active'` (or row absent → fail-open as active).
- Its derived `scene_weight` (see [Scene Weight & Pruning](#scene-weight--pruning)) meets the threshold chosen during the histogram dry-run.

Labels and artists are **IN** only via connection to an in-scope master. There is **no manual label allowlist** for inclusion. Niche labels stay in automatically through the style + quality + weight filter. Curation work shifts to a small editorial **tier-1 list** layered on top for badging — see [Editorial Tier-1 Labels](#editorial-tier-1-labels).

### Scoping is styles-first, not genres

Final scope query is driven by **`catalog.release_styles`** matched against the style allowlist. The Discogs `genre` field is too coarse for our scene boundaries (and the live DB's `release_genres` table has no per-genre index, so genre seeding is also ~10× slower at sizing time). Styles give us:

- Higher precision (`Detroit Techno` vs `Electronic`).
- Index-backed lookup (`idx_release_styles_style`).
- Direct alignment with the editorial brief.

### Style Allowlist (locked v1)

Core house + techno:

- `Acid House`, `Acid Techno`, `Chicago House`, `Deep House`, `Detroit Techno`, `Dub Techno`, `Garage House`, `Hard House`, `House`, `Minimal`, `Minimal Techno`, `Progressive House`, `Tech House`, `Techno`, `Tribal House`

Edge genres included by your locked decision (`scene_canon` window, edge selection: electro + IDM + ambient_techno + UK_rave/hardcore + italo_proto):

- Electro: `Electro`
- IDM / experimental: `IDM`, `Experimental`, `Abstract`
- Ambient techno: `Ambient`, `Drone`, `Dub`
- UK rave / breakbeat hardcore (gated to `≤1994` via post-filter, see [Breakbeat / Hardcore Year Gate](#breakbeat--hardcore-year-gate)): `Breakbeat`, `Hardcore`
- Italo / proto-house: `Italo-Disco`
- Other scene-adjacent: `Trance`, `Goa Trance`, `Electroclash`, `Leftfield`, `Balearic`

### Year Window: 1985–2003 (Scene Canon)

Locked. Picks up Italo / proto-house seeds in the back half of the 80s and the long minimal/microhouse tail through 2003.

### Explicit Exclusions

- **Drum & Bass / Jungle**: any style named `Drum n Bass`, `Jungle`. Excluded outright.
- **Speed Garage / UK Garage / 2-step**: leaning out. Excluded by default; can be added back via tier-1 label exception if a specific imprint is canonical.
- **Pop / Rock / Hip Hop / Soul / Funk / Jazz**: not seeded. May be reachable via in-scope masters as remix/scene-adjacent context only.
- **Plain `Disco`** (without `Italo-Disco` modifier): not seeded directly to avoid widening the tail into 80s pop-disco. Italo material gets in via `Italo-Disco`.

### Breakbeat / Hardcore Year Gate

`Breakbeat` and `Hardcore` styles are also used by post-1994 D&B / gabber subgenres. To keep the UK rave / breakbeat hardcore window honest:

- During scope build, masters seeded **only** from `Breakbeat` or `Hardcore` (no other in-scope style on the master) are dropped if the master's effective year is `> 1994`.
- This rule is implemented in `scripts/build-scoped-db.ts` as a post-seed prune step.

### Denylist Slots (reactive, small)

- **Bootleg / mashup labels**: populate from top-labels report after first build, store in `enrich.label_editorial.tier = 'denylist'`.
- **Spam / data-quality-rejected labels**: same mechanism.

The denylist is for clearly junk imprints, not for trimming legitimate niche labels. Bias is toward inclusion.

## Master-First Lean Architecture

The scoped DB is **not a smaller copy of the source schema.** It is a denormed master-first read model purpose-built for the slim Dig product surface (master pages + artist pages + label pages + search; no public release/version surface).

### Why denorm + drop, not just subset

A master-first product never joins through `catalog.releases` at runtime. Every public field on a master card or master page either lives on the master itself or in one of three small per-master derivations. By baking those derivations into the scoped DB at build time, the runtime queries become trivial single-table or 1-join lookups, and the entire `catalog.releases` + `catalog.tracks` + release child table family disappears (the largest tables on the source DB).

### Tables KEPT on `dig-db-scene`

| Table | Rows (est.) | Notes |
|-------|-------------|-------|
| `catalog.masters` | 80–100k after pruning | Fattened with denormed columns (see below) |
| `catalog.master_artists` | ~250k | Full credits panel on master page |
| `catalog.master_tracks` *(NEW, 025)* | ~1M | Frankenstein tracklist (see below) |
| `catalog.master_videos_unified` *(NEW, 025)* | ~600k | Aggregates `master_videos` + `release_videos` from in-scope releases |
| `catalog.release_shadow` | ~1.5M | Thin per-release row for "Notable Versions" card; no joins, no tracks |
| `catalog.artists` | ~120k | + denormed `aliases_text TEXT[]` column (025) |
| `catalog.artist_urls` | ~30k | Sidebar links |
| `catalog.labels` | ~70k | + denormed `aliases_text TEXT[]` column (025) |
| `catalog.label_urls` | ~30k | Sidebar links |
| `enrich.entity_quality` (subset) | ~400k | Quality filter |
| `enrich.label_linkouts` (subset) | ~20k | Bandcamp / Instagram |
| `enrich.label_editorial` *(024)* | ~120 | Tier-1 badges |
| `enrich.scene_scope_audit` *(024)* | 1 | Build provenance |
| `ingest.dump_batches` | 1 | Source dump provenance |

### Tables DROPPED on `dig-db-scene` (migration `026`)

| Drop | Replacement / Why |
|------|-------------------|
| `catalog.releases` | Replaced by `release_shadow` for display + denormed `primary_*` columns on `catalog.masters` for attribution |
| `catalog.release_artists`, `release_credits`, `release_labels`, `release_formats`, `release_genres`, `release_styles`, `release_identifiers`, `release_companies`, `release_videos` | No public release surface; videos folded into `master_videos_unified` |
| `catalog.tracks`, `catalog.track_credits` | Replaced by `master_tracks` (Frankenstein) |
| `catalog.master_genres`, `master_styles` | Denormed onto `catalog.masters` as `TEXT[]` arrays with GIN indexes — faster filtering and one fewer join |
| `catalog.master_videos` | Folded into `master_videos_unified` |
| `catalog.artist_aliases` | Denormed onto `catalog.artists.aliases_text TEXT[]`; rendered as plain text on artist pages, no graph traversal |
| `catalog.artist_name_variations` | Search recall improvement only — marginal value, costs a query, dropped |
| `catalog.artist_members`, `catalog.artist_groups` | No UI surface in the slim product; cross-discovery handled by search + Discogs outbound |
| `enrich.usage_counters` | Runtime telemetry — recreated fresh on the new DB |
| `enrich.ingest_batches`, `enrich.refresh_checkpoints` | No enrichment data ever landed beyond `entity_quality` and `label_linkouts` |

### Denormed columns added to `catalog.masters` (migration `025`)

Built once at scope-build time from the master's `main_release` + `master_artists` + `master_genres` + `master_styles`:

| Column | Source | Why |
|--------|--------|-----|
| `primary_artist_discogs_id INTEGER` | first `master_artists` row by `position` | Fast "more by this artist" lookups |
| `primary_artist_name TEXT` | same row | List rendering without join |
| `artists_credit_text TEXT` | constructed from all `master_artists` with join phrases | Display string for headers (e.g. `"X & Y feat. Z"`) |
| `primary_label_discogs_id INTEGER` | from `release_labels` of `main_release` | **Critical** — without this we have no master → label link |
| `primary_label_name TEXT` | same | List rendering without join |
| `primary_country TEXT` | from `releases` of `main_release` | Filtering and sidebar |
| `primary_format TEXT` | from `release_formats` of `main_release` | Sidebar (e.g. `"Vinyl, 12""`) |
| `genres TEXT[]` | from `master_genres` | GIN-indexed for filter speed |
| `styles TEXT[]` | from `master_styles` | GIN-indexed for filter speed + scope rebuild |
| `scene_weight INTEGER` | derived score (see below) | Pruning + ranking |

**Trade-off accepted:** when a master has releases across multiple labels (license deals — Inner City on Virgin UK + KMS US), `primary_label` picks ONE (the `main_release`'s label, with fallback to the highest-completeness in-scope release). The other labels still appear in `release_shadow` "Notable Versions" so the info isn't lost — but the master's *primary* label-page-attribution is single-valued. This matches Discogs's own master-header convention.

### `catalog.master_tracks` — the Frankenstein tracklist

Built once at scope-build time. For each in-scope master, pick a single canonical tracklist using this logic:

1. If `main_release` exists and has tracks → use it.
2. Otherwise, score every in-scope release for the master by track-completeness (count of tracks where `duration_seconds IS NOT NULL` and `title IS NOT NULL`) and pick the highest.
3. (v2, future) Per-position merge across pressings: take title/duration from primary, fill missing fields from sibling releases. Not in v1.

Output schema:

```
catalog.master_tracks (
  id BIGSERIAL PRIMARY KEY,
  master_discogs_id INTEGER NOT NULL,
  position TEXT,
  title TEXT NOT NULL,
  duration_seconds INTEGER,
  artists_text TEXT,           -- denormed from track_credits, e.g. "Mike Banks"
  source_release_discogs_id INTEGER  -- which release we lifted this from
)
```

Index on `(master_discogs_id, position)` for tracklist render.

### `catalog.master_videos_unified` — per-version YouTube discovery

Built once at scope-build time. Aggregates videos from BOTH levels into a single per-master view. Critical for LLM-driven queries like "find me Juan Atkins dub mixes" — the dub mix's YouTube embed often only lives on the 12" single's release page in Discogs, not on the master.

Output schema:

```
catalog.master_videos_unified (
  id BIGSERIAL PRIMARY KEY,
  master_discogs_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('master', 'release')),
  source_release_discogs_id INTEGER,    -- null when source_type = 'master'
  url TEXT NOT NULL,
  title TEXT,
  duration_seconds INTEGER,
  discogs_release_url TEXT              -- outbound link for "see this pressing on Discogs"
)
```

Indexes on `(master_discogs_id, source_type)`. Title-based search (e.g. for `%dub%`, `%instrumental%`, `%remix%`) is exposed via the MCP for agent-driven discovery.

### Scene Weight & Pruning

Computed at scope-build time per master:

| Signal | Weight | Source |
|--------|--------|--------|
| `data_quality` = `Correct` or `Complete and Correct` | +5 | `catalog.masters.data_quality` |
| `data_quality` = `Needs Vote` or `Needs Minor Changes` | +2 | same |
| `data_quality` = `Needs Major Changes` or `Entirely Incorrect` | -5 | same |
| Number of in-scope releases | +1 each, cap +5 | derived from `release_shadow` |
| Distinct countries in `release_shadow` | +1 each, cap +3 | same |
| Has any master-level video | +3 | `master_videos` |
| Has any release-level video on an in-scope release | +3 | `release_videos` |
| On a tier-1 label (any of its in-scope releases) | +10 | `enrich.label_editorial.tier = 'tier1'` |
| At least one named `master_artists` row | +2 | `master_artists` |
| Year is known (not NULL) | +1 | `masters.year` or fallback |
| `enrich.entity_quality` = `active` | required gate (else master excluded entirely) | `entity_quality` |

Weights chosen to make ~5 the "at least one supporting signal" threshold and ~10 the "well-attested" threshold. **Power-user escape hatch is not preserved** — masters below the chosen threshold are dropped from the scope entirely; users wanting deep cuts use the Discogs outbound link on parent entities.

The build script flow:

1. **Histogram pass** — `--histogram` flag: build the full scope (no weight cut), compute `scene_weight` for every master, output the distribution + 20 sample masters per weight bucket.
2. **Threshold pick** — manual eyeball check of the histogram against the samples.
3. **Real build** — `--scene-weight-min N` flag: masters with `scene_weight < N` are dropped from `scope_m` early, so all downstream tables shrink proportionally.

## Editorial Tier-1 Labels

Separate from inclusion. After the histogram pass yields the top-labels report we collaboratively walk the top ~300 labels and tag canonical scene pillars (`Trax`, `DJAX-Up-Beats`, `Basic Channel`, `Tresor`, `Warp`, `Mo' Wax`, `R&S`, `Underground Resistance`, `Strictly Rhythm`, `Nu Groove`, `Planet E`, `Peacefrog`, `Kompakt`, `Perlon`, `Sähkö`, `Metroplex`, `KMS`, `Soma`, `Force Inc.`, `Mille Plateaux`, …).

- Stored as a CSV seed: [`packages/db/seeds/label_editorial_tier1.csv`](../packages/db/seeds/label_editorial_tier1.csv)
- Loaded into `enrich.label_editorial` via migration `024`
- Used for: (a) tier-1 badge on master/label pages, (b) +10 contribution to `scene_weight`, (c) optional ranking nudge in search.
- Target size: ~100–200 tier-1 entries, refined over time.

## Sizing Methodology

### Working estimates (post-prune)

These are the targets for `dig-db-scene` provisioning. To be reconciled against real numbers from the histogram pass + threshold-pick.

| Entity | Rough target | Notes |
|--------|--------------|-------|
| Masters | 80,000–100,000 | After `scene_weight ≥ ~5` cut |
| `master_tracks` | ~1M | ~10 tracks per master |
| `master_videos_unified` | ~500–700k | Master + in-scope release videos combined |
| `release_shadow` | ~1.4–1.8M | One row per in-scope release of a kept master |
| Artists | ~100,000–150,000 | Only those touching kept masters |
| Labels | ~50,000–80,000 | Only those touching kept masters |

**Estimated DB size:** ~1.5–2 GB data + ~1–1.5 GB indexes ≈ **3 GB on disk.**

### Provisioning target

`dig-db-scene` on Fly Postgres in **lhr**:

- Machine: `shared-cpu-1x`
- RAM: 1 GB (working set fits comfortably)
- Volume: 10 GB (3–4× headroom over expected used size)
- Estimated cost: **~$3–5/mo** (vs ~$30+/mo for current `dig-db`).

If the histogram pass shows the slim model lands materially heavier than the estimates, we resize before running the real build.

### Sizing infrastructure (legacy, retained)

- **Style sizing helper** — `scripts/sizing/run-variant.sh`. Single-session psql heredoc, runs all scope queries in one connection. Used during initial empirical sizing against `dig-db`.
- **Build script (canonical)** — `scripts/build-scoped-db.ts` is now the authoritative source for both sizing (`--histogram`) and the real build. Variants below are documented for completeness.

#### Variants Considered (historical)

- **V1 — Conservative**: Core house+techno styles only (15), 1988-2002, no quality filter.
- **V2 — Locked edges**: V1 + the locked edge styles, 1985-2003, no quality filter.
- **V3 — V2 + quality filter on**. Was the production target before the slim refactor.
- **V4 — V3 with `House` / `Techno` / `Breakbeat` removed**.

The slim refactor supersedes V3 by adding `scene_weight` pruning + master-first denorm.

## Cutover Sequence

### 1. Provision `dig-db-scene` (lhr)

```bash
fly pg create --name dig-db-scene --region lhr --vm-size shared-cpu-1x \
  --initial-cluster-size 1 --volume-size 10
```

### 2. Apply migrations

Run all Kysely migrations 001–026 against `dig-db-scene`. Migration `026` performs defensive `DROP TABLE IF EXISTS` for all tables we are not shipping — it's a no-op on a freshly-migrated DB but enforces the slim shape if the migration history is later replayed.

### 3. Histogram dry-run on `dig-db`

```bash
SOURCE_DATABASE_URL=postgres://... \
  pnpm exec tsx scripts/build-scoped-db.ts --histogram --quality-active-only
```

Output: scene_weight distribution + 20 sample masters per bucket. **Threshold is picked here.**

### 4. Build & load the scoped subset

Real build runs on a Fly machine (so a laptop sleep can't drop the connection):

```bash
fly machine run --app dig-build --vm-size shared-cpu-2x --vm-memory 4096 \
  -e SOURCE_DATABASE_URL=$SOURCE -e TARGET_DATABASE_URL=$TARGET \
  ghcr.io/.../dig-builder:latest \
  pnpm exec tsx scripts/build-scoped-db.ts \
    --year-min 1985 --year-max 2003 --quality-active-only \
    --scene-weight-min N --output /tmp/dig-scene.sql --target
```

Preserves the live `batch_id` so runtime batch resolution still works.

### 5. Verify

Minimum checks against `dig-db-scene`:

- Counts match the histogram-pass projections
- `/v1/health` passes pointed at `dig-db-scene`
- Search returns master-first results
- Master pages render with tracklist (from `master_tracks`), Notable Versions (from `release_shadow`), aggregated YouTube (from `master_videos_unified`), Discogs outbound link
- Artist pages render with `aliases_text` denorm
- Tier-1 label badge renders for at least one canonical label
- MCP smoke test passes against the new shape

### 6. Cut runtime over

Update Fly secrets on `dig-api` and `dig-web` to point at `dig-db-scene`. Redeploy. Run `apps/mcp/src/smoke-test.ts` against live.

### 7. Hold rollback for 72h

Old `DATABASE_URL` kept in a dated note in `docs/ops-runbook.md`. After 72 healthy hours, scale old `dig-db` down to single-machine minimal.

### 8. Delete the large full DB

Only after another 7 days with the recovery archive confirmed.

## Recovery Bundle

Before deleting the full DB, preserve:

- exact Discogs dump filenames + checksums
- migration state at the point of capture (001–024 — the slim 025/026 are dig-db-scene-only)
- ingest + transform commands
- enrichment / backfill commands (Quality v2, MB crosswalk)
- `pg_prewarm` warmup steps
- the last known good infrastructure sizing
- `scripts/build-scoped-db.ts` as it stood at cutover

This converts the full-catalog posture from "live cost" into "recoverable archive."

## Product Consequences

The app must be honest about scope:

- **Master-first navigation** — public release/version pages are removed entirely, replaced by `301 → master`
- **Artist pages** are scene-scoped, render `aliases_text` as plain text (no graph traversal of aliases/groups/members)
- **Label pages** are scene-scoped
- **Search** defaults to `entity_type=master`, scene-scoped, ranks by `scene_weight DESC` + FTS rank
- **Tracklists** show one canonical tracklist per master (the Frankenstein) with `source_release_discogs_id` available for outbound to the specific pressing
- **Per-version YouTube** (dubs, instrumentals, B-side mixes) surfaces inline on master pages via `master_videos_unified`, with a Discogs outbound to the source release
- Missing non-scene material is **expected**, not a bug
- Discogs outbound link is the escape hatch on every entity page for users wanting deeper history

This is a product advantage when positioned clearly: Dig becomes a focused, opinionated browsing tool for a specific, deeply-loved scene rather than a broken-feeling general catalog.
