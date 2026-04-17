# Redesign — Implementation Plan

> Companion to [docs/design-system.md](./design-system.md). Tracks what
> shipped, what's deferred, and the order operations were performed in for
> the overnight 2026-04-16 build.

---

## Phase A — Foundations *(this overnight build)*

### A1. Design tokens — `apps/web/src/app/globals.css`

- Replaced the `:root` block with the full token set from the design system
  doc: paper, ink, rule, label-accent, font stacks, spacing scale, font sizes.
- Removed the `prefers-color-scheme: dark` block. v1 is paper-only.
- Replaced `body` font from `Times New Roman` to the new sans stack.
- Loaded `JetBrains Mono` + `IBM Plex Sans` via Google Fonts in `layout.tsx`.

### A2. Shared design components — `apps/web/src/components/design/`

Each component ships with its `.module.css`. No external deps.

| Component | Purpose |
| --- | --- |
| `Page.tsx` | Wraps a page in the paper backdrop, sets `--label-accent` from props. |
| `Sticker.tsx` | The catalog-number / tier-badge sticker. |
| `Stamp.tsx` | The bracketed inline tag (`[ MAIN ]`, `[ TIER 1 ]`). |
| `Rule.tsx` | Hairline divider, with `default` / `bold` / `accent` variants. |
| `MetaRow.tsx` | Mono row of key-value separated by `·`. |
| `CatalogSpine.tsx` | The numbered-rows label catalog timeline. |
| `RosterColumn.tsx` | Top-N artists block for label pages. |
| `LinerNotes.tsx` | The bordered "back-of-sleeve" credits block. |
| `MonoTable.tsx` | Generic mono-aligned tabular layout (subgrid). |
| `TerminalListing.tsx` | The search-results listing. |
| `Wordmark.tsx` | The `[ dig ]` mark (used in nav + favicon). |

### A3. Database — `enrich.label_editorial` extended

Migration `027_label_editorial_palette.ts` adds:

- `palette JSONB` — `{ accent: "#hex", accent_ink: "#hex" }`
- `blurb TEXT` — editorial blurb (≤50 words, serif italic on the page)
- `founded_year INTEGER`
- `location TEXT` — "Ghent, BE"
- `is_active BOOLEAN` — for `1984—` vs `1984–2008` rendering
- `closed_year INTEGER`

Migration is idempotent (`ADD COLUMN IF NOT EXISTS`).

### A4. Seed data — 30 tier-1 labels with palettes + blurbs

`packages/db/seeds/label_editorial_v2.csv` extends the existing tier-1
list with palette + blurb columns for the 30 most canonical scene labels.
Loaded via `scripts/seed-label-editorial.ts` (new) which:

1. UPSERTs into `enrich.label_editorial` keyed on `discogs_label_id`.
2. Resolves names via case-insensitive trim match against `catalog.labels`.
3. Logs unresolved names to stderr.

Initial palette set (curated):

R&S Records · Warp · Tresor · Trax · Strictly Rhythm · Underground Resistance · Transmat · Metroplex · KMS · Plus 8 · Ninja Tune · Mute · Ovum · Kompakt · Basic Channel · Chain Reaction · Perlon · Apollo · DJAX-Up-Beats · Music Man · Soma · Junior Boy's Own · XL · Hyperdub-era equivalents · Force Inc · Mille Plateaux · Dance Mania · Cajual · Relief · M-Plant.

### A5. API — extend label endpoint

`apps/api/src/routes/v1/entities.ts` and
`packages/domain/src/retrieval/label.ts` updated to return:

- `editorial.palette: { accent, accent_ink } | null`
- `editorial.blurb: string | null`
- `editorial.founded_year: number | null`
- `editorial.location: string | null`
- `editorial.closed_year: number | null`
- `editorial.is_active: boolean`

Added `/v1/labels/:id/spine` — returns the chronological catalog spine for a
label, including unscoped pressings (greyed in UI), with format and catalog
number columns. Server-side ordered by year ASC, position ASC. Capped at 200
masters, paginated.

Added `/v1/labels/:id/roster` — top-N artists by master count on the label,
with first/last year and master count.

### A6. Pages refreshed

| Page | Status |
| --- | --- |
| `/label/[id]` | **Production-ready** — full identity strip + blurb + catalog spine + roster + liner-notes + provenance. |
| `/master/[id]` | Refreshed to match — paper backdrop, label-tinted, sticker for catalog number, MonoTable tracklist, side-A/B grouping for LP-derivatives. |
| `/` (search results) | Refreshed — TerminalListing, mono columns, single unified ranking. |
| `/artist/[id]` | Chrome inheritance only (full rework deferred to Phase B). |
| `/about`, `/mcp`, `/llm-beta`, `/usage`, `/feedback`, `/progress` | Chrome inheritance only — paper backdrop + new wordmark + new nav, no content rework. |

### A7. Site chrome

- `Nav.tsx` — `[ dig ] —— alpha`, mono wordmark, search input restyled.
- `Footer.tsx` — left-aligned mono, Discogs/MusicBrainz/CC0 attribution split out as a separate caption row.
- `layout.tsx` — wrapped in paper backdrop at the body level.

### A8. Documentation + ops

- `docs/design-system.md` — canonical reference (this doc's sibling).
- `docs/ops-runbook.md` — append a "rollback design" section (single
  `git revert` of the design tokens commit reverts everything).
- `CLAUDE.md` — add "Design language" section pointing to design-system doc.

### A9. Deployment

Continuous: each coherent commit deploys via `fly deploy --config fly.web.toml --remote-only`.

---

## Phase B — Polish *(next session, ~1–2 days)*

Out of scope tonight, queued for the morning:

- **Homepage hero rework.** Replace the giant "Dig." with the new wordmark
  treatment, plus a mini-essay paragraph and 4–6 example queries.
- **Artist page deep refresh.** Discography wall (similar to catalog spine
  but anchored on artist), credit family breakdown, label affiliations
  card.
- **Track-level credits surfacing on master page.** Producers, engineers,
  vocalists pulled in. Requires a small backend join we don't have yet.
- **Primary-artist column in search results.** Requires
  `master_artists_text` to be returned in the search payload — small API
  change.
- **Cover Art Archive "white label" fallback.** Custom rendered placeholder
  using the label palette when no cover is found.
- **Format-aware layouts.** 7" / 12" / LP / CD render slightly different
  hero proportions.
- **Keyboard navigation.** `/` to focus search, `j/k` to walk results,
  `g + h` to go home.
- **Editorial blurb expansion.** Aim for 80–100 tier-1 labels covered
  (currently ~30).

## Phase C — Stretch *(post-alpha)*

- **Per-master "session notes"** — an editorial sentence on the most
  important masters (tier-1 label + scene-weight ≥ 50). ~200 entries to
  start, hand-curated.
- **Decade essays** — short editorial pieces accessible from the homepage
  (`/essay/1991-bleep-techno`, etc.) that link to in-scope masters.
- **DJ chart imports** — pull in classic DJ charts (Mixmag end-of-year, the
  fader, Wax Poetics) and surface "as charted by X" provenance on master
  pages.

---

## Rollback

The design tokens, components, and the new pages are introduced in coherent
single-purpose commits. To revert the entire visual redesign:

```bash
git log --oneline --grep="redesign:" --grep="design:" --since="2026-04-16"
git revert <commit-sha>...
fly deploy --config fly.web.toml --remote-only
```

The data model changes (`enrich.label_editorial` columns) are additive and
idempotent — no rollback required for the DB layer.
