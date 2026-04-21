# Seeds

CSV-format seed data loaded into `enrich.*` tables on the scoped DB. Seeds are loaded by [scripts/seed-label-editorial.ts](../../../scripts/seed-label-editorial.ts) which:

1. Resolves each `name` to a `discogs_label_id` via `catalog.labels.name` lookup (case-insensitive trim match, fallback to fuzzy via `pg_trgm` similarity ≥ 0.85).
2. Logs unresolved names to stderr (these are usually labels not in scope and can be ignored).
3. Inserts resolved rows into `enrich.label_editorial`.

Run after the scoped DB is built:

```bash
DATABASE_URL=postgres://... pnpm exec tsx scripts/seed-label-editorial.ts
```

## `label_editorial_tier1.csv`

Curated list of canonical scene-pillar labels for 1985–2008 electronic dance.

- `name` — label name as it appears in `catalog.labels.name`
- `tier` — `tier1` (canonical, badge in UI) or `denylist` (junk, suppressed everywhere)
- `notes` — short editorial reason

This is a **starter set** intended to be refined collaboratively after Phase 1 sizing yields the top-100 labels report. Bias should stay toward inclusion: if a label has clear scene weight, mark it `tier1`. If a label is bootleg / spam / aggressively low-quality, mark it `denylist`. Anything in between gets no editorial flag and lives in the body of the catalog without special treatment.

Target size:

- `tier1`: ~120–200 entries (currently ~120)
- `denylist`: <50 entries (populate from sizing report)

## Maintenance

When the seed list changes:

1. Edit the CSV.
2. Re-run `scripts/seed-label-editorial.ts` — it does an UPSERT on `(discogs_label_id)`.
3. Commit the CSV diff. Migrations don't need re-running for seed-only changes.
