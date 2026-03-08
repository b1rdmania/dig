# Gate Closeout — Item 2: No-Dead-Ends v2

- **Gate ID**: Better-Than-Discogs Track / Item 2
- **Date**: 2026-03-08
- **Owner**: Claude Code
- **Decision**: `GO WITH CAVEATS — SSR BLOCKER`
- **Status**: ⚠️ NOT FULLY CLOSED

## Scope

- In scope:
  - canary set expansion
  - no-dead-ends checker improvements
  - CI integration of dead-end gate
- Out of scope:
  - full SSR performance remediation
  - broad frontend architecture rewrite

## Current Evidence Snapshot

1. Canary rebuilt with verified live IDs:
   - 100 entities total (artists/labels/releases/versions)
2. Structural dead ends:
   - 0 FAIL (no hard dead-end link failures)
3. Timeout profile:
   - 79 TIMEOUT (non-structural; SSR latency on high-catalog pages)

## Explicit P1 Blocker

### Blocker ID
`SSR_TIMEOUT_HIGH_CATALOG`

### Impact

Large artist/label/release pages can exceed SSR fetch budget, causing timeout outcomes in canary checks. This masks “true” no-dead-ends quality and degrades user experience.

### Exit Criteria (required to fully close Item 2)

1. Timeout count reduced from current baseline to `<10` on the 100-entity canary.
2. Structural dead-end failures remain `0`.
3. Regression smoke remains green (`npm run smoke:regression`).
4. No increase in API 5xx/error rates attributable to SSR changes.

## Plan to Close Blocker

1. Split entity pages into fast shell + streamed sections (Suspense boundaries).
2. Mark slow sections fail-soft (render page shell even if one section times out).
3. Re-run canary and store before/after report.

## Verification Required Before Final GO

1. `npm run smoke:regression`
2. `npx tsx scripts/no-dead-ends-check.ts` (or CI equivalent)
3. Canary result table: PASS / FAIL / TIMEOUT with previous baseline comparison

## Rollback

1. Revert SSR streaming changes by page route if regressions occur.
2. Keep no-dead-ends checker operational in warning mode until fixed.

## Final Sign-off (pending)

- Operationally safe to proceed: `yes` (with caveat)
- Fully closed: `no`
- Next action: execute SSR timeout remediation, then re-run canary gate.

