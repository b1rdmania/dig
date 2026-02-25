# Image Strategy v1

## Decision

**Primary source: Cover Art Archive (CAA)** via MusicBrainz release mappings.
**Fallback: placeholder images** (generated SVG or static assets by format type).

Discogs dump images: **confirmed absent** (profiled 500k releases, zero `<images>` elements found). Discogs API images: deferred — subject to API ToS and 60 req/min rate limit, not viable for bulk backfill.

## Architecture

### Mapping Pipeline

1. **MB dump import** (weekly): Download MusicBrainz database dump, extract `l_release_url` → `url` table relationships where URL matches `https://www.discogs.com/release/*`
2. **Store mapping**: `catalog.mb_mappings` table: `(discogs_release_id, mb_release_mbid)`
3. **Estimated coverage**: ~25–35% of Discogs releases have a corresponding MB release with a Discogs URL link

### CAA Fetch Pipeline

1. **Lazy fetch on first request**: When a release is requested via API and has an MB mapping but no cached CAA data, queue a CAA lookup via Redis
2. **CAA API call**: `GET https://coverartarchive.org/release/{mbid}` — no auth required
3. **Store in cache table**: `catalog.caa_cache` (mb_release_mbid, images JSON, front_250_url, front_500_url, license, fetched_at)
4. **Cache TTL**: 30 days (CAA data is stable)

### License Filtering

**Critical**: CAA images have per-image licenses. Not all are commercially usable.

| License | Can Proxy/Serve? | Action |
|---------|:---:|--------|
| CC0 (Public Domain) | Yes | Proxy through our CDN |
| CC BY | Yes | Proxy with attribution in metadata |
| CC BY-SA | Conditional | Proxy if share-alike compliance is acceptable |
| CC BY-NC | No | Return URL only, let client hotlink |
| CC BY-NC-SA | No | Return URL only |
| All Rights Reserved | No | Return URL only |

Safe licenses for proxying:
```typescript
const PROXY_SAFE_LICENSES = [
  'http://creativecommons.org/publicdomain/zero/1.0/',
  'https://creativecommons.org/publicdomain/zero/1.0/',
  'http://creativecommons.org/licenses/by/3.0/',
  'http://creativecommons.org/licenses/by/4.0/',
  'https://creativecommons.org/licenses/by/3.0/',
  'https://creativecommons.org/licenses/by/4.0/',
];
```

### API Response

Every release response includes an `images` field:

```json
{
  "images": {
    "front_small": "https://api.dig.baby/v1/images/release/249504/front-250",
    "front_large": "https://api.dig.baby/v1/images/release/249504/front-500",
    "source": "coverartarchive",
    "license": "CC0",
    "available": true
  }
}
```

When no image is available:
```json
{
  "images": {
    "front_small": null,
    "front_large": null,
    "placeholder": "https://api.dig.baby/v1/images/placeholder/vinyl",
    "source": null,
    "available": false
  }
}
```

### Serving Policy (v1)

**Direct URL passthrough** — not proxying in v1.

Return the CAA thumbnail URLs directly in API responses. This avoids:
- Bandwidth costs for serving images
- CDN setup complexity
- Legal exposure from redistributing images

The API returns the archive.org CDN URLs for images. Clients fetch directly from archive.org.

**v2 upgrade path**: Add a proxy/CDN layer if direct URLs become a reliability problem or if we want to control image sizing/optimization.

### Placeholder Strategy

Placeholder images by format type:
- Vinyl → vinyl record SVG
- CD → CD case SVG
- Cassette → cassette tape SVG
- Digital → waveform SVG
- Default → generic disc SVG

Placeholders are static assets, not generated per-request.

## Coverage Estimates

| Metric | Estimate | Notes |
|--------|----------|-------|
| Discogs releases | ~18M | From dump profiling |
| MB releases with Discogs link | ~5–6M | ~30% of Discogs catalog |
| Of those with CAA art | ~3–4M | ~65% of MB releases have CAA art |
| Net coverage | ~17–22% | Of total Discogs releases |
| Coverage for popular releases | ~50–70% | Major label releases much better covered |

### Launch Threshold

**Minimum for Phase 3 (API alpha)**: Image pipeline functional, placeholder fallback working. No minimum coverage % required — API returns `available: false` gracefully.

**Target for Phase 4 (human UI)**: >20% of releases displayed in search results have images. This is achievable with CAA alone for typical search queries (which skew toward popular/well-known releases).

## Schema Additions (Phase 1)

```sql
-- MusicBrainz mapping table
CREATE TABLE catalog.mb_mappings (
  discogs_release_id INTEGER PRIMARY KEY,
  mb_release_mbid UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mb_mappings_mbid ON catalog.mb_mappings(mb_release_mbid);

-- CAA cache
CREATE TABLE catalog.caa_cache (
  mb_release_mbid UUID PRIMARY KEY,
  front_250_url TEXT,
  front_500_url TEXT,
  front_1200_url TEXT,
  license TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Legal Posture

1. **CAA images**: Per-image licenses. We only serve/proxy CC0 and CC-BY images. NC/AR images: return URL for client-side fetch only.
2. **Discogs dump data**: CC0 — no restrictions on metadata. Images are NOT in the dump.
3. **Discogs API images**: Subject to Discogs API ToS. Not used in v1.
4. **MusicBrainz data**: CC0 for metadata. Used for Discogs→MBID mapping.
5. **Placeholder images**: Our own assets, no license concerns.

## Backfill Timeline

1. **MB dump import** (one-time, then monthly): ~2–4 hours to import relevant relationships
2. **CAA fetch** (lazy, ongoing): Amortized over API usage. Cold start: could pre-warm top 100k most-linked releases in ~28 hours at 1 req/sec MB rate limit
3. **Total time to reach steady state**: ~1 week after Phase 1 import completes

## Future Image Sources (v2+)

- **Discogs API**: Higher coverage but rate-limited (60 req/min). Could supplement CAA for releases not in MB. Requires Discogs API key and compliance with their ToS.
- **User-submitted images**: Phase 5+ (requires moderation pipeline)
- **AI-generated placeholders**: Considered and rejected — adds complexity without value for a data product.

## MusicBrainz API Usage

When not using the MB dump for bulk mapping, the MusicBrainz API can be used for individual lookups:

```
GET https://musicbrainz.org/ws/2/url?resource=https://www.discogs.com/release/{discogs_id}&inc=releases&fmt=json
User-Agent: Dig/0.1 (hello@dig.baby)
```

Rate limit: **1 request per second** (strictly enforced). User-Agent header **required**.
