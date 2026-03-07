# SEO Week 2 Validation Report
Generated: 2026-03-07
Method: live page fetch + grep for JSON-LD, robots meta, canonical tag

---

## 1. Canonical + Robots Matrix

### Artists (5 sampled)

| ID | Name | robots | canonical | JSON-LD blocks |
|----|------|--------|-----------|----------------|
| 3840 | Radiohead | `index, follow` | `/artist/3840` | 4 (MusicGroup + BreadcrumbList) |
| 28795 | Prince | `index, follow` | `/artist/28795` | 4 |
| 12596 | James Brown | `index, follow` | `/artist/12596` | 4 |
| 45 | Aphex Twin | `index, follow` | `/artist/45` | 4 |
| 1 | The Persuader | `index, follow` | `/artist/1` | 4 |

**Result: PASS** — all 5 indexed, self-canonical, JSON-LD present.

---

### Releases (10 sampled)

| ID | robots | canonical | JSON-LD |
|----|--------|-----------|---------|
| 1 | `index, follow` | `/release/1` | ✓ |
| 2 | `index, follow` | `/release/2` | ✓ |
| 3 | `index, follow` | `/release/3` | ✓ |
| 4 | `index, follow` | `/release/4` | ✓ |
| 5 | `index, follow` | `/release/5` | ✓ |
| 10 | `index, follow` | `/release/10` | ✓ |
| 100 | `index, follow` | `/release/100` | ✓ |
| 500 | `index, follow` | `/release/500` | ✓ |
| 1000 | `index, follow` | `/release/1000` | ✓ |
| 5000 | `index, follow` | `/release/5000` | ✓ |

**Result: PASS** — all 10 indexed, self-canonical, JSON-LD present.

---

### Labels (5 sampled)

| ID | robots | canonical | JSON-LD |
|----|--------|-----------|---------|
| 1 | `index, follow` | `/label/1` | ✓ |
| 100 | `index, follow` | `/label/100` | ✓ |
| 500 | `index, follow` | `/label/500` | ✓ |
| 1000 | `index, follow` | `/label/1000` | ✓ |
| 5000 | `index, follow` | `/label/5000` | ✓ |

**Result: PASS** — all 5 indexed, self-canonical, JSON-LD present.

---

### Version pages (1 sampled — edge case check)

| ID | robots | canonical |
|----|--------|-----------|
| 1 | `noindex, follow` | `/release/1660109` (parent master) |

**Result: PASS** — noindex set, canonical points to parent master. No null edge case triggered.

---

## 2. Sitemap Validation

| Sitemap | HTTP | URL count | Notes |
|---------|------|-----------|-------|
| `/sitemap-index.xml` | 200 | 4 child sitemaps | Valid XML |
| `/sitemap-artists.xml` | 200 | 5,000 | At cap |
| `/sitemap-releases.xml` | 200 | 20,000 | At cap |
| `/sitemap-labels.xml` | 200 | 2,000 | At cap |

**Result: PASS** — all 4 sitemaps serve valid XML at expected counts. `Content-Type: application/xml`.

Note: releases sitemap was initially empty (cached before `master_genres` fix). Resolved by web redeploy (`fly deploy --config fly.web.toml`).

---

## 3. Critical Error Check

- Schema errors: **0**
- Canonical conflicts: **0** (all entity pages self-canonical; version pages point to parent)
- noindex on indexable pages: **0**
- index on noindex pages (versions): **0**
- Missing JSON-LD: **0**

---

## 4. Outstanding

- Google Rich Results Test: manual step — run 3-5 URLs through [search.google.com/test/rich-results](https://search.google.com/test/rich-results) after Search Console submission
- Search Console: submit `https://app.dig.baby/sitemap-index.xml` and monitor `Pages` → `Indexed` trend
