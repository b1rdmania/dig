# Gate Closeout — 2026-03-08

## Work completed this session

| Commit | Change |
|--------|--------|
| `3d8bbcd` | Usage V2 — migration 017, daily window counters, KPI table + funnel |
| `c4a4df2` | LLM grounding — ResponseMode, evidence tracking, CRITICAL RULES |
| `57aeb97` | LLM fixes — mode labels, video awareness, markdown links |
| `ff66247` | Auto-fetch credits when releases thin |
| `a49fbca` | Forbid external site recommendations |
| `78a6f77` | Fix credits batchId (catalog.release_credits) |
| `69c5b9a` | Artist releases parity — getArtistCatalogReleases, section reorder |
| _(pending)_ | Dead-end fallback copy for sparse version pages |

---

## 1. Kasra V parity — before / after

**Before** (`getArtistMasters` only):
- Releases shown on artist page: **1** (Akasa EP)
- LLM response: "nothing coming up in the database" → recommended Bandcamp

**After** (`getArtistCatalogReleases`):
- Expected releases shown: **≥12** (from `release_artists` table)
- LLM auto-fetches credits via corrected `catalog.release_credits` batchId

_Agent to paste: actual count from `app.dig.baby/artist/4506398` after deploy, screenshot or DOM count_

---

## 2. LLM mode distribution — sample

_Agent to paste: 5–10 representative queries with observed `mode` values from API responses_

| Query | mode | evidence count | notes |
|-------|------|----------------|-------|
| "show me releases by kasra v" | _(paste)_ | _(paste)_ | |
| "records by radiohead" | _(paste)_ | _(paste)_ | |
| "italian house mid 90s" | _(paste)_ | _(paste)_ | |
| "hi are you working?" | _(paste)_ | 0 | should be grounded_empty, no note shown |
| "who produced loveless?" | _(paste)_ | _(paste)_ | |

---

## 3. Usage windows — population proof

After deploy + first API traffic, `/v1/usage` should return non-null windows.

_Agent to paste: abbreviated `/v1/usage` response showing `windows.last_24h` populated_

```json
{
  "windows": {
    "last_24h": {
      "requests_total": _,
      "errors_total": _,
      "telemetry_events_total": _
    },
    "last_7d": null,
    "last_30d": null
  }
}
```

_(last_7d and last_30d will be null until those time windows have data — expected)_

---

## 4. Open items resolved this session

| Item | Status |
|------|--------|
| Migration 014 not in kysely_migration | **Resolved** — row confirmed present (`2026-03-07T18:26:45`) |
| pool.on('error') missing | **Not a bug** — already present in `packages/db/src/index.ts` |
| release/1 dead end | **Fixed** — sparse fallback copy added to version page |

---

## 5. Remaining open items

| Item | Priority | Notes |
|------|----------|-------|
| No-dead-ends Phase 2 | P2 | Domain/API invariant tests + CI gate not implemented |
| Entity sitemaps (Week 2 SEO) | P2 | Runbook at `docs/seo-week2-runbook.md` |
| Migration 014 batchId note | P3 | Timestamp format differs from others (ISO vs yyyyMMddTHHmmss) — cosmetic |
