# Credits + Remixes: Scope Extraction Plan (and reusable methodology)

Purpose: extract the credit/remix layer from `dig-db` (full Discogs CC0) into `dig-db-scene` (the v2 scoped catalog) **once**, so we can permanently retire `dig-db`. Then formalise the extraction as a reusable **Scope Manifest** pattern so we can spin up a hip-hop scope (or any other) the same way.

This is the operational successor to [`scoped-catalog-90s-house-techno.md`](scoped-catalog-90s-house-techno.md). That doc built the master-first slim model. This doc adds the credit graph that `026` deliberately dropped, and turns the whole pipeline into a parameterised template.

## 1. Problem

The slim refactor (migration `026`) dropped `catalog.tracks`, `catalog.track_credits`, `catalog.release_credits`, `catalog.release_artists`, etc. — the assumption was that v1 didn't need a credit surface. We've since hit two real gaps:

1. **MAW remixes don't appear on the Masters at Work artist page.** The artist page only sources from `master_artists` (primary artist on master). Remixes, productions, and dub mixes that MAW did for other artists' releases are completely invisible.
2. **Label pages don't surface remixers.** A Nu Groove release with a Frankie Bones remix shows only the primary artist on the spine, not the remixer. That's a massive misrepresentation of how the scene actually worked — the remix was the product.

The data exists in `dig-db` (`track_credits` is 86M rows / 8.2GB, `release_credits` is 68M rows / 6.4GB). But we want to retire `dig-db` to save **~$45/mo** and remove the operational surface area of carrying a 300GB legacy DB. So we need to:

- Pull the slice we care about into `dig-db-scene` once
- Verify the v2 product can serve every credit-related query without `dig-db`
- Then snapshot and destroy `dig-db`

## 2. Goals

- **Make remix/credit attribution a first-class layer** on artist, master, and label pages.
- **Self-contained scoped DB**: zero runtime dependence on `dig-db`. Postgres FDW is explicitly off the table.
- **Bounded growth**: target +500MB–1GB on `dig-db-scene` (it's currently 10GB volume, 2GB used).
- **Reusable methodology**: same pipeline + same script can produce `dig-db-hiphop` from a scope manifest swap. No hand-rolled SQL per scope.
- **Re-derivable from a fresh dump**: the build pipeline must be runnable end-to-end against a freshly-loaded full Discogs dump (Fly machine, ~24h job) so we don't need `dig-db` to live forever as the source. We rebuild from XML + the same scope manifest if/when we want a fresh cut.

## 3. Source data inventory (what's in `dig-db` that matters)

| Source table (full DB) | Rows | Size | Carry into scoped DB? |
|---|---:|---:|---|
| `catalog.tracks` | 168M | 16GB | **No** — too large. We project track titles + positions onto a scoped derivation. |
| `catalog.track_credits` | **86M** | **8.2GB** | **Yes, scoped slice only** — gold for remixers, producers, mixers. |
| `catalog.release_credits` | 68M | 6.4GB | **Yes, scoped slice only** — release-level "Mastered By", "Engineered By", "A&R", etc. Lower priority than track credits but small slice once filtered. |
| `catalog.release_artists` | 23M | 2GB | **Yes, scoped slice only** — release-level artist credits with role. Some remixers live here too. |
| `catalog.releases` | 19M | 5.5GB | **No new pull** — `release_shadow` already carries the membership ledger. |
| `catalog.artist_aliases` | small | small | **Already denormed** in `026` as `aliases_text`. Skip. |
| `catalog.artist_groups`, `artist_members` | small | small | **Add** if we go for "members of group" graph (UR collective members, MAW = Louie + Kenny). Cheap. |

## 4. The scope rule — what to pull

There are **two membership rules** for a credit row to be IN-scope:

### Rule A: "Track on a scope release"

The credit's track belongs to a release that's already in `dig-db-scene.catalog.release_shadow`. This catches everything internal to the scene — every track listing on every Trax release, every Underground Resistance 12", etc.

```sql
-- Conceptual
INSERT INTO scoped.master_track_credits (...)
SELECT ...
FROM full.track_credits tc
JOIN full.tracks t ON t.id = tc.track_id
JOIN full.releases r ON r.discogs_id = t.release_discogs_id
WHERE r.discogs_id IN (SELECT release_discogs_id FROM scoped.release_shadow);
```

### Rule B: "Cross-scope credit by a scope artist"

The credit's artist is in `dig-db-scene.catalog.artists` AND the role matches a remix/mix/production allowlist AND the host release year is within the scope window. This catches **MAW remixing Madonna**: Madonna's "Music" isn't in our house/techno scope, but MAW's Funk Mix of it is a key MAW work and belongs on their artist page.

Role allowlist (case-insensitive, regex on `role` text):

```
remix | re-?mix | mix | edit | dub | re-?work | reconstruction
producer | produced by
```

Year gate: same as the parent scope (1985–2003 for v2 house/techno).

```sql
INSERT INTO scoped.cross_scope_credits (...)
SELECT ...
FROM full.track_credits tc
JOIN full.tracks t ON t.id = tc.track_id
JOIN full.releases r ON r.discogs_id = t.release_discogs_id
WHERE tc.artist_discogs_id IN (SELECT discogs_id FROM scoped.artists)
  AND tc.role ~* '(remix|mix|edit|dub|re-?work|reconstruction|produced by|producer)'
  AND r.released_year BETWEEN 1985 AND 2003
  AND tc.track_id NOT IN (SELECT track_id FROM scoped.master_track_credits);  -- de-dup vs Rule A
```

### Why two rules

- Rule A makes the scoped DB *complete* for everything the scene released.
- Rule B catches the **cross-scope catalog** — every time a scope artist did work on a non-scope release. This is the MAW-on-Madonna case. Without Rule B, the artist pages systematically under-credit the artists.
- Rule B is bounded: ~5–10k scope artists × avg ~50 cross-scope credits each ≈ **500k rows max**, and most artists have far fewer.

### Estimated row count for the credit slice

- Rule A: scope releases (~100k) × avg ~10 tracks × avg ~3 credits ≈ **3M rows** (most tracks have 1 credit; a few have 10+).
- Rule B: ~500k rows.
- Total: **~3.5M rows added**. At ~200B/row that's ~700MB on disk, ~200MB compressed. Comfortably inside the existing 10GB volume.

## 5. Target schema (what lands in `dig-db-scene`)

We don't carry `tracks` as a separate table. We carry **per-master track credits** denormed at scope-build time, mirroring how `master_tracks` already works:

### 5.1 New: `catalog.master_track_credits`

```sql
CREATE TABLE catalog.master_track_credits (
  id                  BIGSERIAL PRIMARY KEY,
  master_discogs_id   INTEGER NOT NULL,
  track_position      TEXT,           -- joins to master_tracks.position
  track_title         TEXT,           -- denormed for fast render
  artist_discogs_id   INTEGER NOT NULL,
  artist_name         TEXT NOT NULL,
  anv                 TEXT,           -- artist name variation as printed
  role                TEXT NOT NULL,  -- normalised: 'Remix' | 'Producer' | 'Mixed By' | 'Engineered By' | ...
  role_raw            TEXT,           -- original Discogs role string for forensics
  source_release_id   INTEGER NOT NULL,
  built_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- For "all credits on this master" (master page tracklist with credits)
CREATE INDEX idx_mtc_master ON catalog.master_track_credits (master_discogs_id, track_position);

-- For "all masters where this artist did X" (artist page remix/production sections)
CREATE INDEX idx_mtc_artist_role ON catalog.master_track_credits (artist_discogs_id, role);

-- For label-page remix surface (join via master.primary_label_discogs_id)
-- (no extra index needed — composite on master is enough)
```

### 5.2 New: `catalog.master_release_credits`

For **release-level** credits ("Mastered By", "Cover Photography", "A&R") that don't attach to a specific track. Denormed to master via `release_shadow`.

```sql
CREATE TABLE catalog.master_release_credits (
  id                  BIGSERIAL PRIMARY KEY,
  master_discogs_id   INTEGER NOT NULL,
  source_release_id   INTEGER NOT NULL,
  artist_discogs_id   INTEGER NOT NULL,
  artist_name         TEXT NOT NULL,
  role                TEXT NOT NULL,
  role_raw            TEXT,
  built_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mrc_master ON catalog.master_release_credits (master_discogs_id);
CREATE INDEX idx_mrc_artist_role ON catalog.master_release_credits (artist_discogs_id, role);
```

### 5.3 New: `catalog.cross_scope_credits` (Rule B catch)

These don't have a corresponding `master_discogs_id` in our scope (the host release isn't a scoped master). Carry the minimum needed to render an artist-page entry pointing back to Discogs.

```sql
CREATE TABLE catalog.cross_scope_credits (
  id                       BIGSERIAL PRIMARY KEY,
  artist_discogs_id        INTEGER NOT NULL,        -- the scope artist
  artist_name              TEXT NOT NULL,
  role                     TEXT NOT NULL,
  role_raw                 TEXT,
  host_release_id          INTEGER NOT NULL,        -- Discogs release id (links out)
  host_release_title       TEXT NOT NULL,
  host_release_year        INTEGER,
  host_primary_artist_name TEXT,                    -- e.g. "Madonna"
  host_label_name          TEXT,                    -- e.g. "Maverick"
  track_position           TEXT,
  track_title              TEXT,
  built_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_csc_artist ON catalog.cross_scope_credits (artist_discogs_id, role);
```

These render as outbound cards: "MAW Funk Mix of *Music* by Madonna (Maverick, 2000) → Discogs". No traversal into them — they're terminal.

### 5.4 Normalisation: `role` vocabulary

Discogs `role` strings are messy: `"Remix"`, `"Remixed By"`, `"Remix [Vocal Mix]"`, `"Re-Mix"`, etc. At build time we normalise to a canonical short list:

| Canonical | Matches (regex, case-insensitive) |
|---|---|
| `Remix` | `^remix(\b\|ed\|er)\|^re-?mix` |
| `Mixed By` | `^mix(ed)?\sby$\|^mix$` (when not "remix") |
| `Edit` | `\bedit(\b\|ed by)` |
| `Dub` | `\bdub(\b\|\smix)` |
| `Producer` | `^produc(er\|ed by)$` |
| `Co-Producer` | `^co.?produc` |
| `Engineer` | `^engineer\|^engineered by` |
| `Mastered By` | `^master(ed by)?$` |
| `Written By` | `^writ(ten by\|er)` |
| `Vocals` | `^vocal` |
| `Other` | fallback |

Only `Remix`, `Mixed By`, `Edit`, `Dub`, `Producer`, `Co-Producer` are surfaced on the **public artist remix tab**. The rest are visible on the master credit panel only.

`role_raw` always preserves the original — we can re-normalise without re-extracting if we change the vocab.

### 5.5 Optional: artist members/groups (small, cheap)

Migration `026` dropped `artist_members` + `artist_groups`. Bringing them back as scoped slices (only edges where one side is a scope artist) costs ~10k rows. Worth it for "Members of Underground Resistance" / "Members of Masters at Work" sidebars.

```sql
CREATE TABLE catalog.artist_group_members (
  id                BIGSERIAL PRIMARY KEY,
  group_artist_id   INTEGER NOT NULL,
  member_artist_id  INTEGER NOT NULL,
  -- both must be scope artists; we never carry edges to non-scope artists
  PRIMARY KEY (group_artist_id, member_artist_id)
);
```

## 6. Build pipeline changes

`scripts/build-scoped-db.ts` is already 1,406 lines and modular. We extend it with three new phases that run after `buildArtistLabelClosure()` and before `dumpAll()`:

```
buildScopeOnSource()
  → computeSceneWeight()
  → pruneByWeight()
  → buildArtistLabelClosure()
  → buildMasterDenorms()
  + buildMasterTrackCredits()        ← NEW (Rule A, track-level)
  + buildMasterReleaseCredits()      ← NEW (Rule A, release-level)
  + buildCrossScopeCredits()         ← NEW (Rule B)
  + buildArtistGroupMembers()        ← NEW (optional)
  → dumpAll()
  → pipeIntoTarget()
  → postLoadBackfill()
```

Each new phase:

1. Builds a workspace temp table on the **source** (`dig-db`) using the scope ledger from `release_shadow` + `artists` already populated by earlier phases.
2. Outputs to a workspace table named `scope_workspace.master_track_credits` etc.
3. Gets dumped via `dumpTable()` and piped into the target along with everything else.

CLI surface stays the same:

```bash
pnpm exec tsx scripts/build-scoped-db.ts \
  --year-min 1985 --year-max 2003 \
  --quality-active-only \
  --scene-weight-min 5 \
  --include-credits \                 # ← new flag, defaults to true for v2
  --remix-role-allowlist 'remix|mix|edit|dub|producer' \  # ← new flag, has sane default
  --output /tmp/dig-scene.sql \
  --target $TARGET_DATABASE_URL
```

## 7. Migration sequence (the actual rollout)

Numbered migrations on `dig-db-scene`:

| # | What | Notes |
|---|---|---|
| `030_credit_tables` | `CREATE TABLE` for the four new tables + indexes | No data, idempotent |
| `031_credit_backfill_marker` | inserts a row into `enrich.scene_scope_audit` with `phase = 'credit_v1'` | provenance |

The build script writes the data; migrations only define shape. This keeps migrations small and reviewable.

## 8. Sequencing — do this BEFORE retiring `dig-db`

The retirement of `dig-db` is gated on **two** things landing successfully:
- (a) v2 (house/techno) credit add complete and verified
- (b) hip-hop scope manifest written, sized, and a smoke build proves the pipeline parameterises cleanly

This protects us against "we built v2 well but the pipeline only works for v2" — which we'd discover too late once the source DB is gone.

```
Day 0  Write + review migrations 030/031.
Day 0  Extract Scope Manifest plumbing from build-scoped-db.ts
       (refactor current hard-coded house/techno params behind a
       --manifest flag; current behaviour becomes the v2 manifest).
Day 0  Extend build-scoped-db.ts with the 3+1 new credit phases
       (gated on manifest.credits.enabled).
       Local smoke against a small batch (one scene, e.g. Detroit only).
Day 1  Run the credit-only delta build for v2 on a Fly machine
       (source = dig-db, target = dig-db-scene).
       Estimated runtime: ~6–12h for ~3.5M rows + indexes.
Day 1  Verify v2: API + UI for MAW, Frankie Knuckles, Joey Negro,
       Roger S., King Britt, MK — top-N remixers smoke.

— Hip-hop pipeline-proof gate (decision #6) —

Day 2  Write packages/db/scope-manifests/hip-hop-1979-1999.yaml.
       Curate style allowlist + denylist + tier-1 labels CSV.
Day 2  Run --histogram against dig-db with the hip-hop manifest.
       Inspect distribution + sample masters per scene_weight bucket.
       Pick threshold.
Day 3  Provision dig-db-hiphop (Fly Postgres, iad, shared-cpu-1x, 10GB).
       Apply migrations 001–031.
Day 3  Run a SMOKE build of hip-hop: cap at top tier-1 labels only
       (Def Jam, Tommy Boy, Cold Chillin', Loud, Rawkus, Rap-A-Lot).
       Target ~5k masters, ~10k artists, ~5k labels, ~150k credits.
       Confirms: (i) build script is manifest-clean, (ii) credits
       phases work for a different scope, (iii) the schema fits.
       Does NOT need to be the full hip-hop catalog yet.
Day 3  Verify hip-hop smoke: load the API pointed at dig-db-hiphop,
       verify a known artist page (e.g. Pete Rock, DJ Premier) shows
       primary masters AND remix/production credits. Quick eyeball.

— Retirement gate —

Day 4  If both v2 (full) and hip-hop (smoke) verified:
       Snapshot dig-db.
       Scale dig-db machine to 0 (volume stays for 7d safety).
Day 11 If nothing's regressed and snapshot is verified restorable:
       Destroy dig-db volume.
       Saves ~$45/mo.

— Optional, post-retirement —

Later  Run the FULL hip-hop build (drop the tier-1-only smoke cap).
       Source: a fresh Discogs CC0 dump on a temporary Fly machine.
       Demonstrates end-to-end re-derivation without dig-db.
```

The build script is **idempotent**: each phase truncates its target table before insert and uses the same `batch_id`, so we can re-run if something fails midway.

### What "smoke build of hip-hop proves"

The whole point of the smoke build is to flush out hidden assumptions in the current `build-scoped-db.ts`. Things like:

- Hard-coded year ranges that should come from the manifest
- Hard-coded style names in helper functions
- `tier1_labels` paths assumed to be the v2 path
- API contract code (e.g. cover-art proxy) that assumes one specific DB

If the hip-hop smoke build fails or produces wrong data, that's the moment to fix the script — while we still have `dig-db` to test against. After retirement we'd have to spin up a fresh dump (a 24h job + ~$50 of compute) to test any pipeline change.

## 9. API surfaces this enables (separate ship)

These are what the credit data unlocks. None of them require `dig-db` once the build above lands.

### 9.1 Artist page — new "Credits & remixes" section

Three tabs (only show if non-empty):
- **As remixer** — `master_track_credits` WHERE artist + role='Remix', PLUS `cross_scope_credits` WHERE role='Remix'. Cards show host master/release + outbound.
- **As producer** — same but role IN ('Producer', 'Co-Producer').
- **As mixer / engineer** — role IN ('Mixed By', 'Engineer', 'Mastered By').

Endpoint: `GET /v1/artists/:id/credits?role=remix&limit=50&cursor=...`

### 9.2 Master page — full per-track credits

Tracklist becomes interactive: each track shows its credits inline.

```
A1   Pacific State                    7:55
       Written By: Graham Massey, Martin Price, Gerald Simpson
       Mixed By:   Steve Osborne   ← clickable
A2   ...
```

Endpoint: `GET /v1/masters/:id/credits` — already exists in skeleton, populates with new data.

### 9.3 Label page — remix credits inline on the spine

Optional inline row under each release on the catalog spine:

```
NM016   1993   Plastikman    Spastik
                 + remix by  Mike Banks · Robert Hood
```

Endpoint: `GET /v1/labels/:id/releases?include_remix_credits=true`.

### 9.4 Search — credit-aware results

Searching "Roger Sanchez" returns:
- 12 masters as primary artist
- "remixed 87 tracks · go to remix list"  ← deep link to artist remix tab

Cheap to add — same endpoint, new optional facet.

## 10. Reusable methodology — the Scope Manifest pattern

Now the reusable part. The whole pipeline is parameterised on a **Scope Manifest** YAML/JSON. Every scope (current house/techno v2, future hip-hop, future dub reggae, future jazz) is one manifest file.

### 10.1 Manifest shape

```yaml
# packages/db/scope-manifests/v2-house-techno.yaml
slug: house-techno-1985-2003
db_app: dig-db-scene
db_region: lhr
year_min: 1985
year_max: 2003
quality_active_only: true
scene_weight_min: 5

# Inclusion: a release is IN if it has any of these styles.
# Source of truth: catalog.release_styles in the full Discogs DB.
style_allowlist:
  - Acid House
  - Acid Techno
  - Chicago House
  - Deep House
  - Detroit Techno
  # ... full list

# Exclusion overrides (negative): drop releases whose ONLY in-scope
# style is in this list AND year > X.
year_gates:
  - styles: [Breakbeat, Hardcore]
    drop_if_year_gt: 1994

# Hard exclusions: never include even if other styles match.
style_denylist:
  - Drum n Bass
  - Jungle
  - Speed Garage
  - 2-step

# Editorial layer (optional): tier-1 labels get +10 scene_weight
# AND a badge on the UI.
tier1_labels_csv: packages/db/seeds/label_editorial_tier1.csv

# Credit + remix layer
credits:
  enabled: true
  remix_role_regex: '(remix|mix|edit|dub|re-?work|reconstruction|produced by|producer|co-?produc)'
  cross_scope_year_min: 1985    # defaults to year_min
  cross_scope_year_max: 2003    # defaults to year_max
  surface_roles: [Remix, Mixed By, Edit, Dub, Producer, Co-Producer]

# Editorial scenes (curated wall content) — separate seed
scenes_seed: packages/db/seeds/scenes/v2-house-techno/
```

### 10.2 Scope Manifest → DB instance mapping

Each manifest produces **one** Postgres DB. Naming convention:

| Manifest slug | Fly app | Region |
|---|---|---|
| `house-techno-1985-2003` | `dig-db-scene` | lhr |
| `hip-hop-1979-1999` | `dig-db-hiphop` | iad |
| `dub-reggae-1968-1985` | `dig-db-dubreggae` | lhr |

Each runs the **same** schema migrations (`001`–`030`+) and the **same** build script. The manifest is the only thing that varies.

The runtime app picks which DB to talk to per route, OR we deploy one frontend per scope (`app.dig.baby/house-techno`, `app.dig.baby/hip-hop`). The latter is simpler and cleaner — one repo, one frontend, scope-aware routing. We don't need to decide that now; the data extraction is the same either way.

### 10.3 Reproducibility contract

Anyone with:
1. A fresh Discogs CC0 dump (monthly XML download)
2. A Fly Postgres instance
3. The repo at the right SHA
4. A Scope Manifest YAML

…can reproduce a v2 scoped DB end-to-end without `dig-db` ever existing. The full Discogs DB is **a build dependency, not a runtime dependency**. We bring it up on Fly when we want to do a fresh build, run the pipeline, then tear it down.

This is why retiring `dig-db` is safe: the methodology to recreate it is encoded in `scripts/build-scoped-db.ts` + the manifest. The state of `dig-db` itself is replaceable.

## 11. Worked example: hip-hop scope

To prove the methodology, here's what a hip-hop manifest looks like — what changes vs house/techno:

| Field | v2 house/techno | hip-hop scope |
|---|---|---|
| `slug` | `house-techno-1985-2003` | `hip-hop-1979-1999` |
| `year_min` / `year_max` | `1985` / `2003` | `1979` / `1999` (Sugar Hill → end-of-golden-era) |
| `style_allowlist` | Acid House, Detroit Techno, Deep House, Tribal House, Minimal Techno, … | Hip Hop, Boom Bap, Conscious, East Coast Hip Hop, West Coast Hip Hop, Hardcore Hip Hop, Gangsta, G-Funk, Jazzy Hip-Hop, Electro, Old School Hip Hop |
| `style_denylist` | Drum n Bass, Jungle, 2-step | Trap (post-2010 era), Crunk, EDM, Pop Rap |
| `year_gates` | Breakbeat / Hardcore ≤ 1994 | Electro ≤ 1986 (else swallows electro-house) |
| `tier1_labels_csv` | Trax, Tresor, Warp, R&S, … | Def Jam, Tommy Boy, Cold Chillin', Loud, Rawkus, Rhymesayers, Rap-A-Lot, … |
| `credits.remix_role_regex` | same | same — same roles in hip-hop |
| `credits.surface_roles` | Remix, Mixed By, Edit, Dub, Producer | Remix, Producer, Co-Producer, Sampled, Featuring (hip-hop weights producer credit higher) |
| `scenes_seed` | Detroit Core, Berlin Techno, Chicago House, … | South Bronx, Marley Marl Crew, Native Tongues, Wu-Tang Affiliated, Death Row Era, Rawkus 99, Roots Crew, … |

Build command is the same:

```bash
pnpm exec tsx scripts/build-scoped-db.ts \
  --manifest packages/db/scope-manifests/hip-hop-1979-1999.yaml \
  --source $FULL_DISCOGS_URL \
  --target $TARGET_HIPHOP_URL
```

Outputs: `dig-db-hiphop`, ~30k masters, ~50k artists, ~30k labels, ~2M credits. Estimated DB size: ~1–1.5GB. Same shape as v2 house/techno. Same API contract works against it.

## 12. Decisions (locked 2026-04-19)

1. **Cross-scope catch (Rule B)**: **YES** — included by default. Without it artist pages systematically under-credit (the MAW-on-Madonna case).
2. **Surface `Edit` and `Dub` on the artist remix tab**: **YES**. Pagination + role sub-filter handles the Theo Parrish 200-edits case.
3. **`master_release_credits`**: **YES** — pull the data even though we may not surface it immediately. Storage cost is small (~500MB) and re-extracting later requires `dig-db` to still exist, which it won't. Pull once, surface when needed.
4. **`artist_group_members` slice**: **YES**. Cheap (~10k rows), enables "Members of UR / MAW / Wu-Tang" sidebars now and later.
5. **One frontend vs per-scope frontend**: **defer**. Probably keep one frontend, decide per-scope when we ship. Doesn't affect this build.
6. **Hip-hop scope timing**: **fully scope it out NOW before retiring `dig-db`**. Concretely: write the hip-hop manifest, run `--histogram` against `dig-db` to confirm sizing, run a minimal real build (`dig-db-hiphop` provisioned, top tier-1 labels only, ~5k masters) to prove the pipeline end-to-end. Full hip-hop content build can come later, but the **pipeline must be proven on a second scope before we lose the source DB**. This is the safety net for any future scope (dub reggae, jazz, ambient, etc.) — if the pipeline runs cleanly on a 2nd scope, it'll run on the Nth scope from a fresh Discogs dump.

## 13. Cost summary

| Item | $/mo |
|---|---:|
| `dig-db-scene` after credit add (volume already 10GB, no resize needed) | unchanged at ~$13 |
| `dig-db` retired (snapshot kept ~$5/mo, volume destroyed) | **−$45 → +$5** |
| **Net DB savings** | **~$40/mo** |

Plus future cost per new scope: **~$13/mo** for a `dig-db-{slug}` instance. So a hip-hop scope adds ~$13/mo, dub-reggae another ~$13/mo, etc.

## 14. What this doc deliberately does NOT cover

- The actual API endpoint shapes for the new credit surfaces — that's a separate `implementation-plan-credit-surfaces-v1.md`.
- The frontend UI — same.
- Whether scopes get separate subdomains or path-based routing — open product question.
- The hip-hop **scenes seed** (curated walls) — that's an editorial task for whoever writes the hip-hop scenes content, not an engineering task.
- Retirement of `dig-mcp` — already done in [`apps/mcp/README.md`](../apps/mcp/README.md).
