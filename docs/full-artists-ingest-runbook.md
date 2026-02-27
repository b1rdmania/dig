# Full Artists Ingest Runbook

Removes `CAVEAT:partial-artists` from Gate B. Only 289,500 artists were ingested from a partial dump file. The full Discogs artists dump contains ~9.9M artists.

## Prerequisites

1. Download the full `discogs_YYYYMMDD_artists.xml.gz` from Discogs data dumps
2. Verify file size: expect ~1.5 GB compressed (~10 GB uncompressed)
3. Ensure Docker Postgres is running with sufficient disk (current DB: 192 GB; artists add ~5-10 GB)
4. Verify batch exists: `e0050fc3-6176-491a-8d78-0fc02a6464f7`

## Command Sequence

### 1. Verify current state

```bash
# Check current artist count
docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c \
  "SELECT count(*) FROM ingest.raw_entities WHERE entity_type = 'artist' AND batch_id = 'e0050fc3-6176-491a-8d78-0fc02a6464f7';"
# Expected: 289,500

docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c \
  "SELECT count(*) FROM catalog.artists WHERE batch_id = 'e0050fc3-6176-491a-8d78-0fc02a6464f7';"
# Expected: 289,500
```

### 2. Apply Postgres bulk load tuning

```bash
docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c "ALTER SYSTEM SET synchronous_commit = off;"
docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c "ALTER SYSTEM SET max_wal_size = '2GB';"
docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c "SELECT pg_reload_conf();"
```

### 3. Ingest raw artists

```bash
cd "/Users/andy/Documents/New project/dig-baby-mvp"

DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
  pnpm --filter @dig/ingest ingest -- artists \
  --file ./path/to/discogs_YYYYMMDD_artists.xml.gz \
  --batch-id e0050fc3-6176-491a-8d78-0fc02a6464f7
```

The ingest uses `ON CONFLICT DO NOTHING` — existing 289,500 artists will be skipped. Only new artists will be inserted.

**Expected duration**: ~25-30 min at ~5,000/s for ~9.6M new rows.

### 4. Run artists transform

```bash
DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
  pnpm --filter @dig/ingest transform -- \
  --batch-id e0050fc3-6176-491a-8d78-0fc02a6464f7 --type artists
```

Cursor-based resume will skip the 289,500 already transformed and process only new artists.

**Expected duration**: ~25-30 min at ~5,000-6,000/s.

### 5. Populate FTS search vectors for new artists

```bash
docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c \
  "UPDATE catalog.artists SET search_vector = to_tsvector('english', COALESCE(name, '') || ' ' || COALESCE(real_name, '')) WHERE search_vector IS NULL;"
```

### 6. Verify counts

```bash
docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c "
SELECT 'raw_artists' as check, count(*) FROM ingest.raw_entities WHERE entity_type = 'artist'
UNION ALL SELECT 'catalog_artists', count(*) FROM catalog.artists
UNION ALL SELECT 'artist_aliases', count(*) FROM catalog.artist_aliases
UNION ALL SELECT 'artist_groups', count(*) FROM catalog.artist_groups
UNION ALL SELECT 'artist_members', count(*) FROM catalog.artist_members
UNION ALL SELECT 'artist_name_variations', count(*) FROM catalog.artist_name_variations
UNION ALL SELECT 'artist_urls', count(*) FROM catalog.artist_urls
ORDER BY 1;"
```

### 7. Run QA report

```bash
DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig \
  pnpm --filter @dig/ingest qa -- \
  --batch-id e0050fc3-6176-491a-8d78-0fc02a6464f7
```

## Post-Run QA Checklist

- [ ] Raw artist count >= 9,500,000 (threshold from qa-gate-spec)
- [ ] Catalog artist count matches raw count (100% coverage)
- [ ] artists.name null rate < 0.01%
- [ ] FTS search for common artists works ("Radiohead", "Beatles", "Miles Davis")
- [ ] pg_trgm fuzzy on full artist set < 500ms p95

## After Verification

1. Update `docs/phase1-handoff-snapshot.md` — replace artists row counts
2. Update `docs/qa-gate-spec-phase1.md` — mark artists threshold as PASS
3. Remove `CAVEAT:partial-artists` from:
   - `docs/implementation-plan-agent-first.md` (Gate B section)
   - `docs/phase1-handoff-snapshot.md` (Gate B decision section)
4. Update `progress.html` if needed
5. Commit: `docs: remove CAVEAT:partial-artists after full artists ingest`

## Resume/Idempotency

Both ingest and transform are fully idempotent:
- Ingest: `ON CONFLICT DO NOTHING` on `(batch_id, entity_type, discogs_id)`
- Transform: cursor resumes from `MAX(discogs_id)` in catalog table

Safe to re-run at any point without data duplication.
