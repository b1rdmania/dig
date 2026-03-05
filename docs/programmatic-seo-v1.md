# Programmatic SEO v1 (Safe Rollout Plan)

Date: 2026-03-05  
Owner: Growth + Platform  
Status: Ready for execution

## 1. Goal

Increase qualified organic discovery for Dig entity pages (artist, release, version, label) without degrading core API/MCP/web performance.

Success is:
- Higher indexed page count for high-quality entities
- Rising organic impressions/clicks
- No material regression in DB/API SLOs

## 2. Scope

In scope:
- Structured data (JSON-LD) on existing entity pages
- Canonical and indexability policy
- Partitioned sitemap generation
- Controlled cohort publishing (not full-corpus blast)
- Monitoring + expansion gates

Out of scope (v1):
- Indexing all 115k+ pages immediately
- Breaking route changes
- Heavy request-path joins for SEO rendering
- New monetization/pricing flows

## 3. Non-Negotiables

1. Do not mutate `catalog.*` design for SEO.
2. Do not add expensive uncached request-path queries.
3. Roll out in cohorts with measurable gates.
4. Enforce canonical/noindex before expansion.
5. Pause expansion on any SLO regression.

## 4. Route and Canonical Model (Current Dig IA)

Use existing product model:
- `/artist/[id-or-slug]`
- `/release/[id-or-slug]` (canonical album/master)
- `/version/[id-or-slug]` (pressing/edition)
- `/label/[id-or-slug]`

Canonical policy:
- Artist: self-canonical.
- Release: self-canonical.
- Version:
  - `index,follow` only if content-rich and distinct.
  - else `noindex,follow` and canonical to parent `/release/[id]`.
- Label: self-canonical.

## 5. Indexability Rules

Mark `index,follow` only when page has minimum quality:

Artist:
- Name present
- At least one linked release/master
- Non-empty profile OR enrichment bio

Release:
- Title + primary artist
- Tracklist length > 0
- At least one of labels/genres/styles/credits

Version:
- Distinct metadata vs parent release (country/year/format/labels/etc.)
- Not duplicate-thin

Label:
- Name present
- At least N linked releases (set N=5 for v1)

Everything else:
- `noindex,follow`

## 6. Structured Data Plan (JSON-LD)

Add JSON-LD on server-rendered page output.

Artist page:
- `MusicGroup`
- Include: name, genre, foundingDate (if known), sameAs, album refs (limited)

Release page:
- `MusicAlbum`
- Include: name, byArtist, datePublished, genre, track (`MusicRecording[]` subset)

Version page:
- `MusicAlbum` (edition instance semantics)
- Include edition metadata + track subset when available

Label page:
- `Organization` (music label context)
- Include name, url, sameAs

Rules:
- Only emit fields we actually have.
- Never fabricate unknown values.
- Keep payload size bounded (top tracks only, not full large arrays).

## 7. Data and Render Architecture

v1 safe path:
- Use existing API/domain responses already powering pages.
- Compute SEO metadata and JSON-LD from that payload.
- Cache with existing ISR/revalidate strategy.

Optional v1.1 additive layer:
- `seo.*` materialized payload tables for precomputed meta/JSON-LD
- background refresh jobs

Do not block v1 on new DB objects.

## 8. Cohort Rollout Strategy

Do not publish all pages at once.

Wave 1 (indexable):
- 5,000 artists
- 20,000 releases
- 2,000 labels

Wave 2:
- Expand by quality score + performance outcomes

Wave 3:
- Long-tail expansion if search-console and SLO signals stay healthy

Quality score inputs:
- Completeness (profile/credits/genres/etc.)
- Link graph degree (internal references)
- Entity richness (tracklist, labels, relationships)
- Existing traffic signal (if available)

## 9. Sitemaps

Generate partitioned sitemaps:
- `sitemap-artists.xml`
- `sitemap-releases.xml`
- `sitemap-versions.xml`
- `sitemap-labels.xml`
- `sitemap-index.xml`

Rules:
- Include only currently indexable cohort URLs.
- Exclude `noindex` URLs from sitemaps.
- Regenerate daily (or on cohort update).

## 10. Internal Linking Requirements

Must avoid orphan pages and improve crawl paths:
- Artist -> releases, labels, related artists
- Release -> artist, label, versions
- Version -> parent release, artists, labels
- Label -> releases, artists

Limit link blocks for UX and performance:
- Top-N with “view more” where needed

## 11. Technical Execution (Next.js App Router)

Use current app stack (App Router), not Pages Router.

Implement:
1. `generateMetadata()` per entity route:
   - title
   - description
   - canonical
   - robots
   - og/twitter
2. JSON-LD component per entity route (`<script type="application/ld+json">`)
3. Sitemap generation scripts + route handlers
4. Cohort selector util (id lists or score threshold)

## 12. Performance + Safety Guardrails

Before each expansion wave:
1. Compare API p95/p99 vs baseline
2. Check DB CPU/IO trend
3. Check timeout/error rates

Stop expansion if any:
- API p95 regression > 20%
- timeout/error trend crosses incident threshold
- DB saturation sustained over configured window

## 13. Measurement Framework

Track weekly by entity type:
- Indexed pages
- Impressions
- Clicks
- CTR
- Avg position
- Organic -> key conversions (MCP/API/web)

Product health alongside SEO:
- API p95/p99
- DB CPU and IO wait
- 5xx/429/timeout rates

## 14. Timeline (4-6 Weeks)

Week 1:
- Canonical/noindex matrix
- JSON-LD on existing routes
- Sitemap index + partitions

Week 2:
- Wave 1 cohort published
- Search Console submissions
- Instrumentation + dashboard checks

Week 3-4:
- Fix crawl/index issues
- Expand to Wave 2 if gates pass

Week 5-6:
- Long-tail trial (Wave 3)
- Tune cohorts and templates by performance

## 15. Task Breakdown (Agent-Executable)

1. Define indexability matrix in code (artist/release/version/label)
2. Implement `generateMetadata()` canonical + robots for each entity route
3. Add JSON-LD serializer utils:
   - `toMusicGroupJsonLd()`
   - `toMusicAlbumJsonLd()`
   - `toLabelJsonLd()`
4. Add JSON-LD blocks to:
   - artist page
   - release page
   - version page
   - label page
5. Build sitemap generators and sitemap index route
6. Add cohort filter and first-wave URL lists
7. Add Search Console submission runbook entry
8. Add monitoring checklist for expansion gates

## 16. Acceptance Criteria

Must pass before Wave 1 go-live:
1. Schema validation passes for sample URLs
2. Canonical/robots matrix verified on all entity types
3. Sitemaps accessible and valid
4. No orphan entity pages in first-wave cohort
5. Lighthouse/TTFB within current acceptable envelope
6. No SLO regression in API/DB after rollout

## 17. Risks and Mitigations

Risk: Thin or duplicate index bloat  
Mitigation: strict indexability thresholds + noindex defaults for weak pages

Risk: Crawl pressure on weak pages  
Mitigation: sitemap cohorting and phased expansion

Risk: Request-path load spikes  
Mitigation: ISR caching + no heavy runtime joins

Risk: Cannibalization between release/version pages  
Mitigation: hard canonical policy and route hierarchy

## 18. Go / No-Go

Go Wave 1 if:
- Technical acceptance criteria pass
- Monitoring baseline is stable
- Canonical/noindex policy is live

No-Go if:
- Schema/canonical errors unresolved
- DB/API regressions appear
- Cohort contains high thin-page ratio
