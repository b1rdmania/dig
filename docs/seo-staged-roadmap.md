# SEO Staged Roadmap (Execution)

Date: 2026-03-07

## Stage 1 — Foundation (Done)
- Canonical and robots controls on entity pages.
- JSON-LD on artist/release/version/label pages.
- BreadcrumbList schema.
- Sitemap index and partitioned sitemaps.
- Initial quality filters for cohort generation.

## Stage 2 — Wave 1 (Current)
- Publish indexable cohorts:
  - 5k artists
  - 20k releases
  - 2k labels
- Submit `sitemap-index.xml` in Search Console.
- Run 7-day monitoring window and hold changes.

Gate to exit Stage 2:
- Schema validation sample 100% pass
- No critical canonical/robots errors
- API p95 regression <= 20%
- No sustained DB saturation

## Stage 3 — Controlled Expansion
- Increase cohorts in bounded steps (e.g., 2x each wave).
- Keep versions `noindex,follow` unless promotion policy changes.
- Continue quality scoring and thin-page suppression.

Gate to exit Stage 3:
- Stable indexation growth
- No negative SLO trend
- Crawl budget remains efficient (low excluded/duplicate growth)

## Stage 4 — Scale + Refinement
- Artist/label-first coverage near full high-quality corpus.
- Release coverage expanded via scoring rules.
- Add enrichment-driven internal linking improvements.
- Add weekly GSC-to-cohort feedback loop.

## Stage 5 — Content and AI SEO Layer
- Editorial hubs and genre pages (post-technical stability).
- AI citation tracking workflow.
- Developer GTM content linked from indexed entity pages.

## Guardrails (all stages)
1. No heavy uncached request-path queries.
2. No mass indexation without gate pass.
3. Pause and rollback to prior cohort on SLO or canonical regressions.
