# SEO v1 Week 2 Runbook

Date: 2026-03-06  
Owner: Growth + Platform  
Status: Ready for execution

## 0. Objective

Ship safe cohort indexing with clean sitemap partitioning and validation, without impacting product SLOs.

## 1. Build partitioned sitemaps

Create:
1. `/sitemap-index.xml`
2. `/sitemap-artists.xml`
3. `/sitemap-releases.xml`
4. `/sitemap-labels.xml`
5. `/sitemap-versions.xml` (optional file; exclude from submissions if all versions are `noindex`)

Rules:
- Include only URLs intended for indexing.
- Do not include `noindex` URLs in submitted sitemaps.
- Submit sitemap index as the primary entry in Search Console.

## 2. Apply indexability filters to sitemap generation

Use deterministic include rules:
1. Artist: has `name` and (`profile` OR linked releases/masters)
2. Release: has `title`, primary artist, and non-empty tracklist
3. Label: has `name` and at least minimum linked releases
4. Version: include only if explicitly indexable under current policy

Output:
- Cohort list per entity type (IDs/slugs).
- Persist list as generated artifact or deterministic query output.

## 3. Cohort scope for Week 2

Initial caps:
1. Artists: 5,000
2. Releases: 20,000
3. Labels: 2,000
4. Versions: 0 (if policy remains `noindex,follow`)

Sort cohort by quality score:
- completeness
- graph connectivity
- entity richness

## 4. Validate metadata + schema on samples

Sample set:
- 5 artists
- 10 releases
- 5 labels

Checks per URL:
1. Canonical is correct
2. Robots meta is correct
3. JSON-LD validates
4. BreadcrumbList validates
5. OG/Twitter metadata is coherent

Validation tools:
- Google Rich Results Test
- Schema.org validator

Record pass/fail in a validation log table.

## 5. Search Console submission

1. Submit `/sitemap-index.xml`
2. Confirm acceptance/crawl status
3. Track:
   - indexed count by entity type
   - schema/enhancement warnings
   - crawl errors

Do not submit per-entity sitemaps separately unless debugging.

## 6. Baseline performance capture (before expansion)

Capture and store:
1. API p95/p99
2. DB CPU and IO wait
3. 5xx and timeout rates
4. Web page p95 for entity routes

This snapshot is the comparison baseline for rollout decisions.

## 7. Expansion gate (must pass)

Proceed to larger cohorts only if all conditions pass:
1. Schema sample pass rate = 100%
2. No major canonical/robots violations
3. No API p95 regression >20%
4. No sustained DB saturation
5. No spike in 5xx/timeouts

If any fail: pause expansion, fix issues, re-validate.

## 8. Deliverables to commit this week

1. Sitemap partition implementation
2. Cohort filter and generation logic
3. Week 2 schema validation log
4. Search Console submission notes
5. Baseline performance snapshot
6. Progress update in `/docs/programmatic-seo-v1.md`

## 9. Suggested commit sequence

1. `seo: add sitemap index and partitioned entity sitemaps`
2. `seo: apply indexability filters and cohort caps`
3. `docs: add week2 schema validation + gsc baseline report`

## 10. Fast rollback plan

If regressions appear:
1. Revert sitemap index to core static pages only
2. Remove cohort-generated URLs from sitemap outputs
3. Keep existing canonical/robots/schema logic
4. Re-run baseline checks and compare
