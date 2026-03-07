# Migration Parity Audit — 2026-03-07

Purpose: keep production schema/index state aligned with repository migrations.

## Scope

This audit covers migration files in:

- `packages/db/migrations`

and known critical parity risks from recent sessions:

- filtered-release performance indexes
- release/master traversal index
- SEO cohort indexes
- artist credits indexes
- entity quality table/indexes

## Repo-Side Status

Expected migration range: `001..015`  
Current status: contiguous, no gaps.

Critical files present:

1. `007_release_filtered_perf_indexes.ts`
2. `008_release_master_index.ts`
3. `012_seo_cohort_indexes.ts`
4. `013_seo_cohort_outer_indexes.ts`
5. `014_artist_credits_indexes.ts`
6. `015_entity_quality.ts`

## Verification Commands

Run static audit:

```bash
npm run audit:migrations
```

Run production parity checks (target DB):

```sql
SELECT name, timestamp
FROM kysely_migration
ORDER BY timestamp;
```

```sql
SELECT indexname
FROM pg_indexes
WHERE schemaname='catalog'
  AND indexname IN (
    'idx_releases_year_discogs',
    'idx_releases_master',
    'idx_release_credits_artist_batch',
    'idx_track_credits_artist_batch'
  );
```

```sql
SELECT indexname
FROM pg_indexes
WHERE schemaname='enrich'
  AND indexname IN (
    'idx_entity_quality_status',
    'idx_entity_quality_discogs_id'
  );
```

## Operating Rule

If any production schema/index was applied manually:

1. Add matching migration file immediately.
2. Insert parity marker in `kysely_migration` for already-applied migration.
3. Record evidence in this audit doc or session closeout.

## Weekly Cadence

Run `npm run audit:migrations` once per week and before every broad rollout gate.
