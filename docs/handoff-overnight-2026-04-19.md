# Handoff: Overnight Image Harvest + Hip-Hop Scope Status — 2026-04-19

Date: 2026-04-19 (evening, BST)
Owner: handoff from Cursor agent session (b171ddf0)
Scope: image harvesting wrap-up + hip-hop scope readiness + dig-db retirement gating

## TL;DR

- **Images**: harvest pipeline is **done for now**. Final coverage: 15,548 distinct artists / 1,025 distinct labels. Tier-1 label coverage sits at **11/112 (9.8%)** — the rest do not have a free image documented in either Wikidata (P18/P154) or MusicBrainz URL-relationships. Pulled the plug on the MB URL-rels long-tail pass after 800 labels @ 0% yield (script logs `/tmp/img-mb-labels.log`).
- **Hip-hop scope**: fully scoped. Manifest v0.2 locked at `packages/db/scope-manifests/hip-hop-1979-1999.json`; `scene_weight_min` bumped from `0` → `10` based on histogram findings. Tier-1 seed (82 labels) and docs (`docs/hip-hop-1979-1999-scope.md`) are in place. **Not yet materialised** into any database.
- **dig-db retirement**: still gated. Two open decisions that need a human (cost / infra) — see §4.

## 1. What ran overnight

| Step | Result |
| ---- | ------ |
| Wikidata image rerun (both entities, 23k QIDs) | +149 label / +686 artist images. Most newly-resolved QIDs from the MBID reverse-lookup did not have P18/P154 statements. |
| MusicBrainz URL-rels — labels (tier-1 first, 1.1s/req) | 800 labels processed, **0 images** found, terminated. The 113 tier-1 labels with MBIDs all completed without yielding a Commons URL. |
| MusicBrainz URL-rels — artists | Never started (skipped after labels yielded 0%). |

## 2. Image coverage as of now

```
 entity_type | distinct_entities | image_rows | source
-------------+-------------------+------------+-----------
 artist      |             15548 |      15955 | wikidata
 label       |              1025 |       1262 | wikidata
```

Tier-1 (v2 house+techno) labels: 11 of 112 have an image. The 101 missing breaks down roughly:

- ~40 have a Wikidata QID but no P18/P154 → would need user-uploaded Commons image or a Wikipedia infobox image. Both options are manual-curation territory.
- ~50 have only an MBID, no QID, and no MB URL-rels image → essentially uncovered by free graph data.
- ~10 have neither MBID nor QID → hand-curate or skip.

### Possible follow-up paths (none ran tonight)

1. **Hand-curate tier-1 missing images** (~101 labels, ~30s each = ~50 min of work). A small CSV (`label_logo_overrides.csv`: `discogs_id, image_url, attribution`) plus a tiny ingester would close the gap permanently.
2. **Cover Art Archive for label compilations**: pull a representative release cover and mark it as `kind = 'release_proxy'`. Already gives every label *something* to render, even if it's a release jacket.
3. **Discogs label profile images**: only available via authenticated API, against ToS for cached redistribution. Not recommended.

My recommendation: option (1) for tier-1 + option (2) as fallback for tier-2/tier-3 labels.

## 3. Hip-hop scope: pipeline-proof complete, not built

Decisions baked in by the agent (no further changes needed before a build run):

- Manifest version: `0.2.0`
- Style allowlist: 18 canonical Discogs styles (regional descriptors stripped after histogram showed 0 hits).
- Year window: 1979–1999.
- `scene_weight_min`: `10` (was `0`; bumped per histogram §2a in the scope doc — keeps 26,485 of 26,550 masters and drops the noisiest comp-rap bottom).
- Tier-1 boost will be applied **post-build on the target DB**, not on `dig-db` (path 2 in the scope doc) — keeps `dig-db` untouched ahead of retirement.
- Credit phases (Rule A + Rule B + group_members) all enabled with hip-hop-tuned role allowlists. Dry-run validated end-to-end against `dig-db`: 250k track / 165k release / 9.6M cross-scope / 33k group-member rows expected.

### What's needed to actually build

The build requires a target Postgres. **Two options, both need a human call:**

**Option A — new Fly Postgres app (`dig-db-hiphop`)**
- Pros: clean schema isolation, easy to retire later, supports per-scope DBs as a model.
- Cons: ~$30–50/mo extra (matching `dig-db-scene` size at ~30k masters scope; can probably go smaller — $15–20/mo on shared-cpu-1x w/ 4GB).
- Steps: `fly apps create dig-db-hiphop`, `fly postgres create`, run `pnpm --filter @dig/db migrate:up` against it, then `SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=… pnpm exec tsx scripts/build-scoped-db.ts --manifest packages/db/scope-manifests/hip-hop-1979-1999.json`.

**Option B — multi-tenant `dig-db-scene`**
- Pros: $0 marginal cost, single connection string for the API.
- Cons: requires migration to add `scope_id` partition columns to all `catalog.*` tables and update every API route to filter by it. Real engineering work; would invalidate v2-house-techno query plans temporarily.
- Not recommended unless cost is critical.

I did **not** provision anything tonight because it crosses a cost threshold the user should sign off on.

## 4. `dig-db` retirement — still blocked

Cannot retire safely until either:

1. Hip-hop scope is materialised (Option A or B above).
2. The user explicitly says hip-hop materialisation can wait until after a snapshot-restore cycle (in which case we snapshot `dig-db` to Tigris, scale to 0, and revive only when needed for the build).

**Recommended path**: snapshot-then-scale-to-zero now. `dig-db` is a 300GB read-only catalogue source; a Tigris snapshot is a one-time ~$3 charge and brings the running cost to $0/mo. We can revive it in ~10 min when we want to run the hip-hop build (and any future scopes). Per the open backup CLI inconsistency in `docs/handoff-fly-backup-enable-issue-2026-03-16.md`, the snapshot may need to be taken via volume snapshot rather than `fly pg backup`.

## 5. Files touched in this session

- `packages/db/scope-manifests/hip-hop-1979-1999.json` — `scene_weight_min: 0 → 10` (per histogram).
- `packages/domain/src/images.ts` — force `https://` on Wikimedia Commons URLs (mixed-content fix).
- `apps/web/src/components/LabelHeroImage.tsx` — same fix at the render layer for the hero background-image style.
- `apps/api/src/routes/v1/entities.ts` — `getBatchForTable` for the artist credits endpoint now resolves against `catalog.masters` (not the credit tables, which have no `batch_id`).
- `apps/api/src/routes/v1/traversal.ts` — removed legacy `gone()` stub for `/v1/artists/:discogs_id/credits` that was colliding with the real route.
- `scripts/harvest-mb-images.ts` — new harvester (MB URL-rels fallback).
- `scripts/harvest-entity-images.ts` — added `mbid` reverse-lookup phase (Wikidata MBID → QID → P18/P154).
- `docs/hip-hop-1979-1999-scope.md` — full scope doc with histogram results.

## 6. Open todos

- [ ] **User decision** — Option A or B for hip-hop target DB (see §3).
- [ ] **User decision** — snapshot + scale `dig-db` to 0 (see §4).
- [ ] (Optional) hand-curate tier-1 label logo overrides for the 101 labels missing an image (see §2 follow-up 1).
- [ ] (Optional) Cover Art Archive release-proxy fallback for tier-2/3 labels (§2 follow-up 2).
- [ ] DJ / scratch credits as a normalised role bucket (deferred from hip-hop scope §5(5)).
- [ ] Featuring-artist surfacing for hip-hop (deferred from hip-hop scope §5(2)).
