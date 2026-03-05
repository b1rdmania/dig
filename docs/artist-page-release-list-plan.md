# Artist Page Release List Upgrade Plan

## Objective
Improve artist page release lists so users can quickly find major records and understand release type.

Changes requested:
1. Sort releases by newest first
2. Add type filters (LP/Album vs Singles/EPs)
3. Show compact type badge per release row
4. Keep behavior stable and URL-shareable

---

## 1) Current state

- Artist page currently loads releases from `/v1/artists/:id/masters?limit=30`.
- Traversal links include `title` and `year`, but no release-type classification.
- Order is currently ascending by `discogs_id` in domain traversal logic.

---

## 2) Product behavior (v1)

### Default sort
- `Newest` first
- Sort key: `year DESC NULLS LAST`, tiebreak `discogs_id DESC`

### Filters (chips)
- `All` (default)
- `Albums / LPs`
- `Singles / EPs`
- `Compilations`
- `Other`

### Row badge
- Show one badge per row:
  - `LP`
  - `EP`
  - `Single`
  - `Comp`
  - `Other`

### URL-driven state
- Preserve selection via query params:
  - `?sort=newest`
  - `?release_type=album|single_ep|compilation|other|all`
- This makes views shareable and reload-safe.

---

## 3) Data strategy

Use `master.main_release_discogs_id` to infer type from release formats and notes.

Priority classification rules:
1. If format/descriptions include `Album` or `LP` => `album`
2. If include `Single` or `7"` => `single_ep`
3. If include `EP` or `12"` with short track count heuristics => `single_ep`
4. If title/format indicates compilation (`Compilation`, `Greatest Hits`, etc.) => `compilation`
5. Else => `other`

Important:
- Deterministic rule table only (no AI inference)
- If ambiguous, fall back to `other`

---

## 4) Backend changes

## 4.1 Extend traversal response for artist masters

File:
- `packages/domain/src/traversal.ts`

Changes:
1. Add optional fields for master links:
- `release_type?: "album" | "single_ep" | "compilation" | "other"`
- `release_type_label?: "LP" | "EP" | "Single" | "Comp" | "Other"`

2. Update `getArtistMasters()` query:
- Join `catalog.masters` to `catalog.releases` via `main_release_discogs_id`
- Left join `catalog.release_formats` on main release
- Aggregate format name/descriptions enough for classification

3. Add deterministic classifier in domain layer

4. Update sorting in query/result:
- `ORDER BY year DESC NULLS LAST, discogs_id DESC`

## 4.2 API route contract

File:
- `apps/api/src/routes/v1/traversal.ts`

Changes:
- Parse optional query params:
  - `release_type`
  - `sort`
- Pass through to `getArtistMasters()`
- Validate values with strict enum fallback

---

## 5) Frontend changes

File:
- `apps/web/src/app/artist/[id]/page.tsx`

Changes:
1. Add filter chip UI above releases section
2. Add sort selector (v1 can be fixed `Newest` with hidden param, or visible dropdown)
3. Read query params from page URL
4. Request `/v1/artists/:id/masters` with `release_type` + `sort`
5. Render `release_type_label` badge per row

Styles:
- `apps/web/src/app/artist/[id]/page.module.css`
- Reuse existing pill/chip style language to match site

---

## 6) Type updates

File:
- `apps/web/src/lib/types.ts`

Changes:
- Extend `TraversalLink` with new optional fields:
  - `release_type`
  - `release_type_label`

---

## 7) Backward compatibility

- New fields are additive.
- Existing clients that ignore new fields continue to work.
- `release_type` param optional; default `all`.

---

## 8) Testing plan

## 8.1 Domain/API

1. Unit test classification function with known format inputs
2. Integration test `getArtistMasters()` sort order (newest first)
3. Integration test filter slices:
- `album`
- `single_ep`
- `compilation`
- `other`
4. Contract test: response includes additive fields and still validates

## 8.2 Web

1. Artist page loads with default newest ordering
2. Changing chips updates URL and list contents
3. Badges render correctly
4. Refresh preserves filter state
5. Mobile layout remains readable

---

## 9) Acceptance criteria

GO if all true:
- Artist release list defaults to newest-first
- Filter chips correctly subset list
- Badge is visible and accurate for sampled artists
- URL state is preserved on refresh/share
- No regressions in artist page load behavior

NO-GO if any true:
- Ordering inconsistent between requests
- Filter values produce empty/incorrect lists unexpectedly
- Badge classification is obviously wrong on spot-check sample

---

## 10) Rollout sequence

1. Ship backend additive fields + sort first
2. Verify API output on sampled artists
3. Ship frontend chips/badges
4. Run manual QA sample (10 artists across eras)
5. Deploy web + API
6. Update progress/handoff docs

---

## 11) Sample QA artists

Use a spread of catalog density and era:
- 148 (Larry Heard)
- 3840 (Radiohead)
- 28795 (Prince)
- 12596 (James Brown)
- 38863 (Aretha Franklin)
- 10263 (David Bowie)
- plus 4 lower-volume artists

For each:
- verify newest-first
- verify filter subsets
- verify badge plausibility
