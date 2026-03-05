# OG Share Cards — YouTube Thumbnail Fallback Plan

## Objective
Add YouTube thumbnail fallback for `og:image` on release/version pages so shared cards always have rich media.

## Final image priority
1. Cover art URL (existing)
2. YouTube thumbnail from first valid video URL
3. Dynamic OG image (`/api/og?...`)

---

## 1) Scope

### In scope
- Metadata generation only (`generateMetadata` path)
- Release + version pages
- URL parsing + thumbnail derivation
- Validation recipe for A/B/C fallback cases

### Out of scope
- UI media section changes
- YouTube API calls
- Downloading/proxying thumbnails (v1)

---

## 2) Files to change

1. `apps/web/src/lib/seo.ts`
2. `apps/web/src/app/release/[id]/page.tsx`
3. `apps/web/src/app/version/[id]/page.tsx`
4. Optional tests:
   - `apps/web/src/lib/seo.test.ts`

---

## 3) Implementation details

## 3.1 `seo.ts`

Add helper functions:

1. `extractYouTubeId(url: string): string | null`
- Support:
  - `https://www.youtube.com/watch?v=XXXXXXXXXXX`
  - `https://youtu.be/XXXXXXXXXXX`
  - `https://www.youtube.com/embed/XXXXXXXXXXX`
- Validate with regex: `^[A-Za-z0-9_-]{11}$`
- Return `null` for invalid/non-YouTube URLs

2. `youtubeThumbUrl(videoUrl: string): string | null`
- Parse ID with helper
- Return `https://img.youtube.com/vi/${id}/hqdefault.jpg`

3. Extend metadata helper input type:
- Add optional `videos?: Array<{ url?: string | null }>` (match existing page data shape)

4. Update image selection logic:
- If `coverUrl` exists => use it
- Else if `videos` has first valid YouTube URL => use derived thumbnail
- Else fallback to `/api/og?...`

## 3.2 `release/[id]/page.tsx`

In `generateMetadata`:
- Pass release/master video list into `entityMetadata(...)`
- Keep existing title/description logic unchanged

## 3.3 `version/[id]/page.tsx`

In `generateMetadata`:
- Pass version video list into `entityMetadata(...)`
- Keep existing title/description logic unchanged

---

## 4) Guardrails

1. No runtime YouTube fetches in metadata path (URL derivation only)
2. Keep `twitter.card = summary_large_image`
3. Keep canonical URL logic unchanged
4. No regression to existing cover usage
5. If parsing fails, always fall through to dynamic OG

---

## 5) Validation plan (A/B/C)

### A) Has cover art
Expected: `og:image` = cover URL (not YouTube)

### B) No cover + has YouTube
Expected: `og:image` = `https://img.youtube.com/vi/<id>/hqdefault.jpg`

### C) No cover + no valid YouTube
Expected: `og:image` = `https://app.dig.baby/api/og?...`

---

## 6) Fast query recipe to find test IDs

Use API responses to identify candidates quickly:

1. Cover case:
- pick a known covered page (e.g. current `/version/9`)

2. YouTube fallback case:
- find a version/release with videos but no cover in metadata
- verify `release.videos` includes at least one valid YouTube URL

3. Dynamic fallback case:
- pick entity with empty/invalid videos and missing cover

Command pattern:

```bash
curl -sS "https://dig-api.fly.dev/v1/releases/<id>" | jq '.release.videos | length'
curl -sS "https://app.dig.baby/version/<id>" | rg 'og:image'
```

---

## 7) Build + deploy checklist

1. Build:

```bash
pnpm --filter @dig/web build
```

2. Commit + push
3. Deploy web:

```bash
fly deploy --config fly.web.toml
```

4. Validate page source for A/B/C URLs
5. Validate external preview:
- X card validator
- Slack/Discord paste tests

---

## 8) Commit message

`web: add youtube thumbnail fallback for release/version og images`

Include in notes:
- fallback order implemented
- no API contract changes
- no UI behavior changes
- A/B/C cases validated

---

## 9) Optional v1.1 follow-up

1. Add image-host allowlist for metadata safety
2. Add lightweight thumbnail availability probe (background)
3. Add telemetry field for fallback source (`cover` | `youtube` | `dynamic`)
