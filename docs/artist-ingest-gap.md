# Artist Catalog Ingest Gap — CLOSED

## Resolution

**Status: RESOLVED** as of 2026-03-05, commit `156e931`.

Full artist ingest completed successfully:
- **10,207,045 artists** in `catalog.artists` (up from 289,500 partial)
- Max discogs_id: **17,254,783** (up from 399,622)
- All 6 artist tables populated and ANALYZE'd

### Final Counts

| Table | Rows |
|-------|------|
| `catalog.artists` | 10,207,045 |
| `catalog.artist_aliases` | 5,263,371 |
| `catalog.artist_name_variations` | 5,543,424 |
| `catalog.artist_groups` | 2,532,887 |
| `catalog.artist_members` | 2,580,904 |
| `catalog.artist_urls` | 2,372,842 |

### Process

1. **Parser backpressure fix**: Root cause of prior OOM failures was `void onEntity()` in parser.ts discarding async callback promises, causing unbounded memory growth. Fixed by switching to `for await` stream iteration with proper `await onEntity()`.

2. **Ingest**: 9,917,545 artists parsed from `discogs_20260201_artists.xml.gz` in ~3.7 hours (746/s). Zero skipped, no OOM with 4GB heap.

3. **Transform**: Raw entities → catalog tables. Initially ran at 140/s. Optimized with transaction wrapping + chunk size increase (500→2000), achieving 735/s. Completed in ~98 minutes for the second half.

4. **ANALYZE** run on all 6 tables. Query planner stats refreshed.

### Verification

- **Spot-check: James Brown (12596)** — all profile refs resolved, related artists show real names, 30 releases listed
- **Spot-check: James Brown & The Famous Flames (386724)** — 16+ members resolved with links
- **Spot-check: Artist 6,481,253** — previously unresolvable, now loads with full data (47 members, aliases)
- **High-ID coverage**: IDs up to 17.2M covered (Discogs ID space is sparse above 10M)
- **Profile markup**: `[aXXXXXX]` refs now resolve to clickable artist name links
- **Enrichment edges**: MusicBrainz relationship targets show real names instead of "Artist XXXXXX"

### Batch Details

- Batch ID: `d29bc406-2bfb-473f-8b23-90c1d0e722b2`
- Dump date: 2026-02-01
- Dump file: `discogs_20260201_artists.xml.gz` (458MB)

---

## Original Problem (for reference)

We only had **289,500 artists** in `catalog.artists`, with a max `discogs_id` of 399,622. The Discogs dump contains ~10M artists. The import was never completed — only a partial load from an earlier dev phase made it in.

This caused:
- Profile markup broken: refs like `[a2505753]` couldn't resolve to names
- Related artist names missing: showed "Artist 6481253" instead of real names
- 97% of artists were unsearchable
