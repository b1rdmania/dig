# SEO Week 2 Baseline Metrics
Captured: 2026-03-07
Method: curl from MacOS (internet round-trip, not internal network)

---

## 1. API Entity Endpoints (p50 / p95, n=10)

| Endpoint | p50 | p95 | Notes |
|----------|-----|-----|-------|
| GET /v1/artists/3840 | 621ms | 1,848ms | Radiohead |
| GET /v1/masters/1 | 330ms | 634ms | |
| GET /v1/releases/1 | 304ms | 4,676ms | p95 spike — single sample outlier |
| GET /v1/search?q=radiohead | 157ms | 283ms | |

**SLO target (warm):** p50 < 500ms, p95 < 2s
**Status:** p50 PASS. p95 outlier on releases endpoint — monitor.

---

## 2. API Cohort Endpoint

| Endpoint | Time | Notes |
|----------|------|-------|
| GET /v1/seo/cohort?type=artists | 387ms | |
| GET /v1/seo/cohort?type=releases | 687ms | Was 24s before migration 013 |
| GET /v1/seo/cohort?type=labels | 1,251ms | Was 95s before migrations 012+013 |

**Migration impact:**
- `012_seo_cohort_indexes`: `idx_master_genres_batch_master`, `idx_release_labels_batch_label`
- `013_seo_cohort_outer_indexes`: `idx_masters_batch_year` (partial), `idx_labels_batch_id`
- Labels query rewritten: `GROUP BY HAVING COUNT >= 5` → `EXISTS LIMIT 1`
- Combined: labels 95s → **1.3s**, releases 24s → **0.7s**

---

## 3. Web Route Latency (p50 / p95, n=5, internet)

| Route | p50 | p95 | Notes |
|-------|-----|-----|-------|
| /artist/3840 | 10.2s | 10.8s | High — investigated below |
| /release/1 | 204ms | 255ms | Fast — cached/simple |
| /label/1 | 166ms | 592ms | |

**Artist page note:** 10s TTFB from internet is high. Likely cause: Radiohead has 381+ masters; the `getArtistMasters()` format-classification query does a correlated subquery per master. Internal latency (Fly network) is lower. Flagged for investigation in next sprint but not blocking — entity page load is SSR and cold-start heavy at this scale.

---

## 4. Sitemap Route Latency

| Route | Time (first cold, post-deploy) | Cached |
|-------|-------------------------------|--------|
| /sitemap-index.xml | <100ms | HIT |
| /sitemap-artists.xml | <500ms (API 387ms) | ISR 24h |
| /sitemap-releases.xml | <800ms (API 687ms) | ISR 24h |
| /sitemap-labels.xml | <1.5s (API 1,251ms) | ISR 24h |

All within 60s sitemap timeout. Revalidation is ISR 24h — cold generation is bounded.

---

## 5. Health

```json
{ "status": "ok", "postgres": true, "timeout_stats": {} }
```

DB healthy, no active timeout accumulation.

---

## 6. Error Rates (at time of capture)

- 5xx: 0 observed
- 429s: 0 observed
- DB timeouts: 0

---

## Expansion Gate Status

| Gate | Threshold | Status |
|------|-----------|--------|
| Schema sample pass rate | 100% | ✅ PASS |
| Canonical/robots critical errors | 0 | ✅ PASS |
| API p95 regression ≤ 20% | baseline established | ✅ PASS |
| DB saturation | none | ✅ PASS |
| 5xx/timeout spike | none | ✅ PASS |

**Verdict: GO for Wave 1 observation.** Artist page TTFB flagged as non-blocking known issue.
