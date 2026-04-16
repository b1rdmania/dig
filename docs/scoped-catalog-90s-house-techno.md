# Scoped Catalog Plan: 90s House + Techno

Purpose: replace the full live Discogs runtime database with a smaller working Dig catalog focused on 90s house and techno, while preserving a clear rebuild path back to full catalog if needed later.

## Decision

Do not prune the current live `dig-db` in place.

Instead:

1. Measure the scoped subset against the current live/full database.
2. Build a new smaller Postgres instance for the scoped catalog.
3. Cut API and web over to the smaller instance.
4. Keep the full-catalog rebuild path documented.
5. Delete the large full-catalog database only after the scoped stack is verified.

Reason:

- In-place deletes are risky on a working DB.
- Deleting rows does not guarantee lower hosted disk cost.
- A new smaller DB gives cleaner rollback and cleaner pricing.

## Scope Defaults

Default scene profile:

- Years: `1988-2002`
- Genres: `House`, `Techno`
- Styles:
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

These are defaults, not locked doctrine. Adjust after the first sizing report if the subset is still too large or if obvious scene gaps appear.

## Closure Rules

The scoped DB should preserve product functionality, not just direct release rows.

### Seed selection

Start with releases whose effective year falls inside the target window and whose release or parent master matches the selected genre/style profile.

Effective year:

- `catalog.releases.release_year`
- fallback to `catalog.masters.year` when release year is null

### Master closure

Keep masters referenced by seeded releases, plus masters that directly match the scene profile.

### Release closure

Default rule: keep **all releases attached to in-scope masters**.

Why:

- master pages stay usable
- version browsing keeps working
- the app avoids “selected master exists but versions are missing” failure modes

This means some reissues outside the strict year window may remain. That is acceptable because it preserves record-collector workflows.

### Artist closure

Keep artists connected through:

- `catalog.master_artists`
- `catalog.release_artists`
- `catalog.release_credits`
- `catalog.track_credits`

Also keep second-degree artist references used by page chrome and navigation:

- aliases
- groups
- members

Artist pages become **Dig-scoped artist pages**, not full Discogs-complete careers.

### Label closure

Keep labels connected through:

- `catalog.release_labels`
- `catalog.release_companies`

Also keep parent labels used for page resolution.

Label pages become **Dig-scoped label pages**, not full Discogs-complete catalogs.

### Supporting tables

Keep supporting rows for all included entities:

- release formats, genres, styles, identifiers, videos
- tracks and track credits
- master genres, styles, videos
- label URLs
- artist URLs, aliases, groups, members, name variations
- `enrich.entity_quality` for included entities
- `enrich.label_linkouts` for included labels

Do not carry over:

- auth/user tables
- raw ingest payloads
- full-catalog enrich rows unrelated to included entities

## Repo Artifact Added

Use the new scope-sizing script to estimate the subset before any infra changes:

```bash
DATABASE_URL=postgresql://... pnpm scope:90s:report
```

Optional overrides:

```bash
DATABASE_URL=postgresql://... pnpm scope:90s:report --year-min 1990 --year-max 1999
DATABASE_URL=postgresql://... pnpm scope:90s:report --genre House --genre Techno --style "Deep House"
DATABASE_URL=postgresql://... pnpm scope:90s:report --exclude-master-versions
```

What it reports:

- seeded release count
- final release/master/artist/label/track counts
- supporting row counts for key child tables
- top labels by included releases
- year spread

The script is non-destructive and only creates temp tables inside the current session.

## Cutover Sequence

### 1. Size the subset

Run `pnpm scope:90s:report` against the current full database and record:

- release count
- track count
- label count
- artist count
- support-table counts

Use that to choose the target DB size instead of guessing.

### 2. Provision a smaller database

Create a new Fly Postgres instance sized for the scoped dataset rather than the full 300GB posture.

### 3. Apply migrations to the new database

Run the existing Kysely migrations so the target schema matches application expectations.

### 4. Load the scoped subset

Load only:

- active batch row in `ingest.dump_batches`
- included `catalog.*` rows
- included `enrich.*` rows

Preserve the same `batch_id` on copied catalog rows so runtime batch resolution still works.

### 5. Verify the scoped DB before cutover

Minimum checks:

- counts match the scope report
- `/v1/health` passes
- search returns artists, labels, masters, releases
- entity pages load for representative artist/label/master/release/version IDs
- traversal works for artist masters, label releases, master releases

### 6. Point runtime to the scoped DB

Cut `dig-api` and `dig-web` over only after verification succeeds.

### 7. Delete the large full DB

Only after:

- scoped runtime is healthy
- recovery instructions are updated
- rebuild inputs are preserved

## Recovery Bundle

Before deleting the full DB, preserve:

- exact Discogs dump filenames + checksums
- migration state
- ingest + transform commands
- enrichment/backfill commands that matter
- warmup steps (`pg_prewarm`, search verification)
- the last known good infrastructure sizing

This converts the current full-catalog posture from “live cost” into “recoverable archive.”

## Product Consequences

The app must be honest about scope:

- artist pages are scene-scoped
- label pages are scene-scoped
- search is scene-scoped
- missing non-scene material is expected, not a bug

That is a product advantage if positioned clearly: Dig becomes a focused collector/browsing tool rather than a broken general catalog.
