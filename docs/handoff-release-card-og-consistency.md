# Handoff: Release Card / OG Metadata Consistency Audit + Fix

Date: 2026-03-08
Owner: Web agent
Priority: P1 share quality

## 1) Reported issue
Shared release cards sometimes show generic text like "Release dig" instead of real release metadata.

## 2) Root cause identified
In `apps/web/src/lib/seo.ts`, `entityMetadata()` sets OG/Twitter title to a generic type label:
- `ogTitle = TYPE_LABELS[meta.type]` (e.g., "Release page")

This overrides entity-specific titles even when metadata has full title/description and image.

## 3) Required fixes

### Fix A: Use entity title for OG/Twitter title
File: `apps/web/src/lib/seo.ts`
- Replace generic label title assignment.
- New behavior:
  - `openGraph.title = meta.title`
  - `twitter.title = meta.title`
- Keep generic labels only for optional UI copy, not OG title fields.

### Fix B: Preserve strong descriptions
- Ensure `openGraph.description` and `twitter.description` always use entity-specific description.
- Never fallback to a static generic string if entity data exists.

### Fix C: Maintain image priority chain
Current desired chain remains:
1. cover art
2. YouTube thumbnail
3. dynamic OG image endpoint

No change needed unless bugs found.

## 4) Catalog-wide audit job
Create script: `scripts/og-audit.ts`

Inputs:
- Cohort A: top 500 releases by traffic if available (fallback random)
- Cohort B: 500 random releases
- Cohort C: known sparse IDs + known shared IDs

For each URL:
- fetch HTML
- extract tags:
  - `og:title`
  - `og:description`
  - `og:image`
  - `twitter:title`
  - `twitter:description`
  - `twitter:card`

Flag failures:
- generic title pattern (`/^(Artist|Release|Version|Label) page$/i`)
- empty description
- missing og:image

Output:
- `docs/reports/og-audit-YYYY-MM-DD.csv`
- summary markdown with pass/fail counts

## 5) QA checks
Manual spot checks after deploy:
- `/release/1472278`
- `/release/21004`
- `/version/9`
- `/artist/4506398`
- `/label/1`

Validate in:
- X card validator equivalent preview
- WhatsApp share preview (device test)
- Telegram/Slack link unfurl

## 6) Acceptance criteria
1. No generic OG titles on entity pages with known entity data.
2. >= 99% audited pages have non-empty OG title/description/image.
3. Existing image fallback chain still works.

## 7) Implementation order
1. Patch `seo.ts` title mapping.
2. Run typecheck/build.
3. Deploy web.
4. Run OG audit script and publish report.
5. Fix remaining outliers.

## 8) Commands
```bash
git checkout -b codex/og-title-consistency
npx -y pnpm@10.27.0 --filter @dig/web typecheck
npx -y pnpm@10.27.0 --filter @dig/web build
fly deploy --config fly.web.toml --remote-only
```

## 9) Rollback
- Revert seo metadata patch commit and redeploy web.

## 10) Notes
This is not a DB completeness issue. It is metadata composition behavior in web layer.
