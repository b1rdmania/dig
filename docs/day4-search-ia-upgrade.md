# Day 4: Search IA Upgrade

## Changes

### 1. SQL-Level Exact/Prefix Name Boost

Previously, FTS `ts_rank_cd` gave identical scores to all single-word matches ("Prince" the artist and "Prince Strickland" both scored 0.2). This meant the per-type LIMIT cut exact matches in favor of newer records.

**Fix:** Added SQL-level CASE expression to boost exact name matches (+10) and prefix matches (+2) before the LIMIT. This ensures the canonical "Prince" artist survives ranking regardless of discogs_id order.

### 2. Tighter Cross-Type Scoring Weights

Old weights: artist=400, master=300, release=200, label=100.
New weights: artist=150, master=120, release=80, label=40.

The large gap meant non-relevant artists (e.g., "Prince Strickland") always ranked above relevant masters. Tighter weights let exact-match bonuses (+1200 exact, +220 prefix, +80 substring) drive cross-type ordering.

### 3. Per-Type Result Cap (Multi-Type Searches)

Multi-type searches now cap each entity type at `ceil(limit * 0.4)` instead of `limit`. This prevents a single type from monopolizing the result set.

### 4. `is_main_release` Signal

Added `is_main_release` boolean to search results for releases. Main releases (canonical pressings) get a +50 scoring bonus, surfacing them above variant pressings.

### 5. FK-Based Dedup (Frontend)

Replaced fuzzy title+year dedup with exact `master_discogs_id` FK matching. A release is collapsed only if its master already appears in results — no false positives from title normalization.

### 6. Section Heading Update

Frontend section headings now use user-facing terminology:
- "Masters" → "Releases"
- "Releases" → "Versions"
- Collapse message: "N versions collapsed under matching releases."

### 7. Per-Section Display Cap

Frontend caps each section at 5 results with a "+N more" overflow indicator to prevent UI clutter.

### 8. Single-Type Search Bonuses

Previously, explicit type searches (`?type=artist`) used pure FTS rank with no name-match bonuses. Now exact (+500) and prefix (+100) bonuses apply, plus `is_main_release` (+50) for releases.

## Before/After Examples

### "prince" (high-intent artist query)

**Before:**
```
artist    28795  Prince                                     ← correct but fragile
artist   365770  Prince Strickland                          ← noise
artist   342899  Prince Rogers Nelson                       ← noise
artist   308400  Prince Sampson                             ← noise
artist   194807  Prince (2)                                 ← noise
artist   398928  Prince Conley                              ← noise
artist   396634  Prince Valiant (2)                         ← noise
master  1387534  Prince In Jazz - A Jazz Tribute To Prince  ← first music result at #8
```

**After:**
```
artist    28795  Prince                    ← exact match, #1 (guaranteed by SQL boost)
master  1461988  Prince                    ← self-titled album
master   770561  Prince                    ← self-titled album
master   707306  Prince                    ← self-titled album
master    22513  Prince                    ← self-titled album
release 36370615 Prince                    ← exact-title release
```
Exact match artist is #1. Self-titled albums surface immediately. Non-matching artists pushed down.

### "miles davis" (artist + discography)

**Before:**
```
artist    23755  Miles Davis                           ← correct
master  4068178  Miles Davis (compilation)              ← ok
master  3379063  Miles Davis (compilation)              ← clutter
master  3367594  Miles Davis (compilation)              ← clutter
label    670613  Miles Davis                           ← noise at position 5
artist   284743  Miles Davis And His Orchestra          ← related
artist   262586  Miles Davis All Stars                  ← related
master  3557530  Miles Davis No. 3                     ← more compilations...
```

**After:**
```
artist    23755  Miles Davis                           ← exact match, #1
master  4068178  Miles Davis                           ← self-titled/compilations
master  3379063  Miles Davis                           ← grouped with above
...
label    670613  Miles Davis                           ← label entity
artist   284743  Miles Davis And His Orchestra          ← related artists
```
Artist is #1. Exact-title masters grouped. Label appears naturally. Fewer noise results.

### "blue train" (album search)

**Before:**
```
artist    13099  Blue Train                            ← artist entity
master  3128220  Blue Train (1992)                     ← some "Blue Train" master
master  3055283  Blue Train (1994)                     ← another one
... (John Coltrane's "Blue Train" master 2179750 NOT in results)
```

**After:**
```
artist    13099  Blue Train                            ← artist
master  3128220  Blue Train (1992)
master  3055283  Blue Train (1994)
master  2179750  Blue Train                            ← John Coltrane (now appears!)
master  2084572  Blue Train
...
```
Coltrane's Blue Train (master 2179750) now surfaces. Exact title matches prioritized.

### "dark side of the moon" (iconic album)

**Before:**
```
master  1809592  Dark Side Of The Moon (2008)
master  1801159  Dark Side Of The Moon (2020)
master  1411610  Dark Side Of The Moon (1973)           ← Pink Floyd, but no differentiation
release 36325339 Dark Side Of The Moon                  ← orphan release
label    808234  Dark Side Of The Moon Records          ← noise at #8
```

**After:**
```
master  1809592  Dark Side Of The Moon
master  1801159  Dark Side Of The Moon
master  1411610  Dark Side Of The Moon                  ← Pink Floyd (1973)
master  1263391  Dark Side Of The Moon
master   239231  Dark Side Of The Moon
master   194951  Dark Side Of The Moon                  ← Pink Floyd (master)
master   125017  Dark Side Of The Moon
master   113859  Dark Side Of The Moon
release 36325339 Dark Side Of The Moon
...
label    808234  Dark Side Of The Moon Records          ← pushed down
```
All exact-title masters now surface. Without popularity data, we can't distinguish Pink Floyd from others — but all candidates are visible. Labels pushed below music results.

## Latency Verification

| Query | Server ms | SLO p95 target | Status |
|-------|-----------|----------------|--------|
| prince | 90ms | < 300ms | PASS |
| miles davis | 34ms | < 300ms | PASS |
| blue train | 61ms | < 300ms | PASS |
| dark side of the moon | 43ms | < 300ms | PASS |
| radiohead | 31ms | < 300ms | PASS |
| love (broad) | 392ms | < 2,000ms | PASS |
| jazz (broad) | 119ms | < 2,000ms | PASS |
| miles + Jazz genre (filtered) | 904ms | < 2,000ms | PASS |

No latency regression. All queries within SLO envelope.

## Known Limitations

1. **No popularity signal.** Without have/want counts or play data, we can't rank Pink Floyd's DSOTM above another album with the same title. Future: MusicBrainz enrichment could provide release-group popularity.
2. **Title-only FTS for masters.** Searching "prince" finds masters titled "Prince" (self-titled compilations) but not "Purple Rain" or "1999". Artist names aren't in the master search vector. Future: weighted tsvector with artist names.
3. **Per-type cap reduces variety on exact-match-heavy queries.** When many records share the exact same title, the top results are all the same title. The frontend section cap (5 per section) mitigates this visually.
