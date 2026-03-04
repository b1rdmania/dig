# Artist Catalog Ingest Gap

## Problem

We only have **289,500 artists** in `catalog.artists`, with a max `discogs_id` of 399,622. The Discogs dump contains ~8M+ artists. The import was never completed on Fly — only a partial load from an earlier dev phase made it in.

This causes:
- **Profile markup broken**: Label and artist profiles use Discogs refs like `[a2505753]` which we can't resolve to names
- **Related artist names missing**: MusicBrainz enrichment edges reference artist IDs we don't have, showing "Artist 6481253" instead of real names
- **Incomplete search**: 97% of artists are unsearchable

## Current State

| Table | Rows | Notes |
|-------|------|-------|
| `catalog.artists` | 289,500 | Max ID: 399,622 — partial load |
| `catalog.labels` | 2,339,085 | Appears complete |
| `catalog.masters` | 2,521,111 | Appears complete |
| `catalog.releases` | 18,876,362 | Complete (full dump ingest on record) |

Only the releases ingest has a `dump_batches` record. Artists, labels, and masters were loaded in an earlier phase without proper batch tracking.

## Available Dump Files

```
/Users/andy/Downloads/discogs_20260101_artists.xml.gz  (456MB)
/Users/andy/Downloads/discogs_20260201_artists.xml.gz  (458MB)
```

Labels and masters dump files may have been deleted during Docker cleanup. Need to verify.

## Required Work

### 1. Full artist ingest (critical)

Run `pnpm --filter @dig/ingest ingest -- artists --file /path/to/discogs_20260201_artists.xml.gz` against the Fly DB.

- Estimated: ~8M artists, 30-60 min depending on approach
- The ingest CLI uses batch inserts with ON CONFLICT upsert, so it's safe to run over existing data
- Populates: `catalog.artists`, `artist_aliases`, `artist_groups`, `artist_members`, `artist_name_variations`, `artist_urls`

### 2. Verify labels and masters completeness

Check if labels (2.3M) and masters (2.5M) match expected Discogs totals. If not, those dumps need re-ingesting too.

### 3. Proxy reliability

The Fly proxy (`fly proxy 15432:5432 -a dig-db`) drops connections after ~30-60 min of sustained use (ECONNRESET). Options:
- **Option A**: Run ingest locally through proxy, accept potential crashes, rely on ON CONFLICT upsert for idempotent restart
- **Option B**: Upload dump to Fly machine, SSH in, run ingest directly (no proxy middleman)
- **Option C**: Use `fly postgres connect` for a more stable connection

### 4. Post-ingest

- Run `ANALYZE` on all artist tables
- Verify profile refs resolve (spot-check 20 labels/artists)
- Verify related artist names display on artist pages
- Update `ingest.dump_batches` with artist ingest record

## Impact

Once complete:
- All profile `[aXXXXXX]` refs become clickable artist name links
- All enrichment edge names resolve (no more "Artist 6481253")
- Artist search covers the full catalog
- Artist pages exist for all referenced artists

## Questions to Verify

1. Do we still have the labels dump (`discogs_20260201_labels.xml.gz`)? If not, need to re-download from Discogs.
2. Do we still have the masters dump? Same question.
3. Is the current ingest CLI (`apps/ingest`) capable of resuming mid-file, or does it need to re-parse from the start?
