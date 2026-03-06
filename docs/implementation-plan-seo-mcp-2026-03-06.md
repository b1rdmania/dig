# Implementation Plan: SEO + MCP Rollout (2026-03-06)

Owner: Product + Platform  
Status: Execution Ready  
Primary objective: Grow discoverability and MCP usage without cost or performance runaway.

## 1. Current State Snapshot

## MCP
- MCP tools are live and functionally validated.
- Batch resolution issue fixed using table-aware batch lookup.
- Traversal table mapping fixed per link type.
- Anonymous launch mode is active (no key required for initial launch).

## SEO Week 1
- Canonical + robots controls implemented on entity pages.
- JSON-LD added for artist/release/version/label pages.
- BreadcrumbList added.
- Version pages set to `noindex,follow` with parent release consolidation signal.

## SEO Week 2 (in progress)
- Cohort endpoint and sitemap partitioning implemented.
- robots.txt points to sitemap index.
- Pending: Search Console submission, validation logs, metrics gating.

---

## 2. Strategic Decisions (Locked)

1. MCP launches now with anonymous limits and spend guardrails.
2. SEO prioritizes artists + labels first, release indexing is score-gated.
3. No full-corpus indexing blast until quality/performance gates pass.
4. No schema-breaking changes to `catalog.*`.
5. Route model remains:
   - `/artist/[id-or-slug]`
   - `/release/[id-or-slug]` (canonical album/master)
   - `/version/[id-or-slug]` (pressing/edition)
   - `/label/[id-or-slug]`

---

## 3. MCP Launch Policy (Week 1-2)

Anonymous limits:
- 20 requests/minute per IP
- 100 requests/day per IP

Protect mode:
- spend >= 80%: tighten anonymous to max 5/min, 20/day
- spend >= 90%: tighten to max 2/min, 10/day
- spend >= 100% (or manual toggle): return `503 BETA_CAPACITY`

Operational rules:
1. Keep endpoint open and frictionless (no key requirement at launch).
2. Monitor 429 rate, timeout rate, p95 latency, daily usage.
3. Clamp down limits same day if spend/load drifts.

Note:
- API key tiers are deferred until real usage data is collected.

---

## 4. SEO Rollout Model (Artist/Label First)

Why:
- Lower duplication risk than full release/version indexing.
- Better crawl efficiency and cleaner intent matching.
- Lower DB/render pressure for early gains.

Indexing priority:
1. Artists: high-quality cohort
2. Labels: high-quality cohort
3. Releases: scored subset only (main/canonical-heavy)
4. Versions: keep `noindex,follow` by default

Release score criteria (minimum):
1. Has `master_discogs_id`
2. Has tracklist + key metadata
3. Has genre/style and artist linkage
4. Is not duplicate-thin
5. Prefer high-link-degree entities

---

## 5. Execution Plan (2-Week Sprint)

## Phase A: Finish Week 2 Foundation (Now)

1. Verify sitemap outputs:
   - `sitemap-index.xml`
   - `sitemap-artists.xml`
   - `sitemap-releases.xml`
   - `sitemap-labels.xml`
   - version sitemap excluded from submission if all version pages are `noindex`
2. Validate schema + canonical + robots on 20 sample URLs:
   - 5 artists / 10 releases / 5 labels
3. Capture baseline metrics before expansion:
   - API p95/p99
   - DB CPU + IO wait
   - 5xx/timeout rates
   - web route p95 on entity pages
4. Submit `sitemap-index.xml` in Google Search Console.

## Phase B: Wave 1 Cohort Publication

1. Cohort caps:
   - artists: 5,000
   - releases: 20,000 (scored)
   - labels: 2,000
2. Ensure noindex URLs are excluded from sitemap submissions.
3. Run 5-7 day observation window.

## Phase C: Controlled Expansion

Expand only if all gates pass:
1. Schema sample pass rate = 100%
2. Canonical/robots critical errors = 0
3. API p95 regression <= 20%
4. No sustained DB saturation
5. No spike in 5xx/timeout rates

If pass:
- Double cohort sizes for next wave.

If fail:
- Roll back sitemap cohorts to previous stable set.
- Fix root cause, re-run validation, then re-attempt.

---

## 6. Agent Task List (Actionable)

1. Finalize sitemap partition + filter logic.
2. Generate and persist current cohort URL sets.
3. Produce `week2-validation-report.md` (schema/canonical/robots checks).
4. Produce `week2-baseline-metrics.md` (API/DB/web baselines).
5. Submit sitemap index and capture GSC acceptance evidence.
6. Run Wave 1 and monitor for 7 days.
7. Prepare Wave 2 proposal with pass/fail evidence.

---

## 7. Human Task List (You)

1. Confirm DNS/domain setup is correct for canonical host.
2. Ensure Search Console property is verified.
3. Submit sitemap index and monitor coverage/errors.
4. Choose risk posture:
   - conservative: strict cohorts + longer observation windows
   - aggressive: larger cohorts, still gate-driven

---

## 8. Deliverables and Artifacts

Required docs:
1. `docs/seo-week2-runbook.md` (execution checklist)
2. `docs/week2-validation-report.md` (new)
3. `docs/week2-baseline-metrics.md` (new)
4. `docs/programmatic-seo-v1.md` (updated progress section)

Suggested ops artifact:
5. Daily KPI snapshot (requests, 429s, p95, spend trajectory)

---

## 9. Risks and Mitigations

Risk: thin-page index bloat  
Mitigation: strict quality filters + noindex defaults

Risk: canonical conflicts  
Mitigation: deterministic canonical matrix + automated checks

Risk: DB/API regression from crawl pressure  
Mitigation: phased sitemap cohorts + hard expansion gates

Risk: MCP cost spike  
Mitigation: anonymous limits + protect mode + same-day clamp-down

---

## 10. Definition of Done (This Sprint)

Done means:
1. MCP is publicly usable under controlled cost limits.
2. Search Console has accepted sitemap index.
3. Wave 1 SEO cohorts are live and validated.
4. No material SLO regression from rollout.
5. Clear evidence package exists for go/no-go on Wave 2.
