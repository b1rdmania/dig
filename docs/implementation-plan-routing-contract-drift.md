# Routing Contract Drift Fix — Execution Plan

Date: 2026-03-08
Owner: Web/API agent
Priority: P1 UX correctness

## Objective
Eliminate route contract drift so users never hit avoidable interstitial pages.

Contract:
- Canonical album (master) -> `/release/:id`
- Specific pressing/version -> `/version/:id`
- Legacy `/master/:id` remains redirect-only

## Known Drift Symptoms
- Some pages still build `href` using `/release/:pressingId`
- Resolver then shows fallback “This is a specific pressing…” path
- Extra click friction and perceived dead-end behavior

## Non-negotiables
1. One route helper owns all entity-link mapping logic.
2. No inline string URL building for release/version links after this patch.
3. `/release/:pressingId` should auto-redirect server-side to `/version/:id` where possible.
4. Keep hard fallback only for true sparse-data edge cases.

## Scope
In scope:
- `apps/web` route emitters + release resolver behavior + tests + docs

Out of scope:
- DB schema/data migrations
- API response contract changes

## Implementation Steps

### Step 1: Create centralized route helper
Create:
- `apps/web/src/lib/routes.ts`

Add pure functions:
- `hrefForSearchResult(result)`
- `hrefForTraversalLink(link, sourceContext?)`
- `hrefForArtistCredit(credit)`
- `hrefForMasterId(id)`
- `hrefForReleaseId(id)`

Rules:
- master/canonical -> `/release/:id`
- release/pressing -> `/version/:id`

### Step 2: Refactor emitters to use helper
Replace inline href construction in:
- `apps/web/src/components/ResultCard.tsx`
- `apps/web/src/app/artist/[id]/page.tsx`
- `apps/web/src/app/label/[id]/page.tsx`
- any additional results from grep audit

### Step 3: Fix release resolver behavior
File:
- `apps/web/src/app/release/[id]/page.tsx`

Behavior:
1. Query master first.
2. If master found -> render canonical release page.
3. If master not found, query release.
4. If release found -> immediate server redirect to `/version/:id`.
5. If neither found -> not-found/fallback with search CTA.

Do not force manual click-through for normal pressing IDs.

### Step 4: Add route contract tests
Add tests:
- `apps/web/src/lib/routes.test.ts`

Test cases:
- master result -> `/release/:id`
- release result -> `/version/:id`
- traversal release links from artist/label contexts -> `/version/:id`
- traversal master links -> `/release/:id`

### Step 5: Add regression checks
Update/add web regression checks so these are guaranteed:
- `/release/:pressingId` resolves to `/version/:id`
- no interstitial fallback for ordinary pressing IDs

### Step 6: Docs update
Update:
- `docs/operating-implementation-guide.md`

Add rule:
- “Never build release/version hrefs inline; use `lib/routes.ts`.”

## Execution Checklist (copy/paste)

1. Pull latest + create branch
```bash
git pull origin main
git checkout -b codex/routing-contract-drift-fix
```

2. Audit current emitters
```bash
rg -n "href=\{`/(release|version|master)/|router\.push\('/(release|version|master)/|\"/(release|version|master)/" apps/web/src
```

3. Implement helper + refactors + resolver fix

4. Run checks
```bash
npx -y pnpm@10.27.0 --filter @dig/web typecheck
npx -y pnpm@10.27.0 --filter @dig/web build
```

5. Optional targeted route checks (local)
```bash
# start app if needed
npx -y pnpm@10.27.0 --filter @dig/web dev
# then manually verify listed URLs in browser
```

6. Commit
```bash
git add apps/web/src/lib/routes.ts \
  apps/web/src/components/ResultCard.tsx \
  apps/web/src/app/artist/[id]/page.tsx \
  apps/web/src/app/label/[id]/page.tsx \
  apps/web/src/app/release/[id]/page.tsx \
  apps/web/src/lib/routes.test.ts \
  docs/operating-implementation-guide.md
git commit -m "web: fix routing contract drift for release/version links"
```

7. Push
```bash
git push origin codex/routing-contract-drift-fix
```

8. Deploy (if using direct main deploy flow)
```bash
# merge to main first, then:
fly deploy --config fly.web.toml --remote-only
```

## Validation Matrix (must pass)
- `/release/21004` -> canonical page renders
- `/release/9267745` -> redirects to `/version/9267745` without extra manual click
- Artist credits rows open `/version/:id` for pressings
- Label release rows open `/version/:id` for pressings
- Search results open correct route type
- No-dead-ends canary stays green

## Rollback
If regressions appear:
1. Revert web commit
2. Redeploy web
3. Keep resolver fallback as safety net

## Done Criteria
- No known emitters producing `/release/:pressingId`
- No avoidable interstitial in normal navigation
- Contract enforced in helper + tests + operating guide
