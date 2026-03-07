# No-Dead-Ends Audit Spec v1

Date: 2026-03-07

---

## 1. Definition

A page is a **dead end** if ALL of the following are true:
1. HTTP 200 — page loaded successfully
2. Entity exists (not a 404)
3. No actionable internal links are rendered
4. No explicit fallback message explains the absence

---

## 2. Per-Page Rules

### Artist (`/artist/:id`)

Required: at least one non-empty actionable section from:
- Releases (masters list)
- Credits & Appearances (release_credits / track_credits)
- Related Artists (aliases, members, groups)

If ALL are empty:
- Must render: `"No releases, credits, or connections found for this artist."`
- Must render: outbound link to `https://www.discogs.com/artist/:id`

Minimum actionable link count: 1

---

### Label (`/label/:id`)

Required: at least one:
- Releases list (label_releases)

If empty:
- Must render: `"No linked releases found for this label yet."`
- Must render: outbound link to `https://www.discogs.com/label/:id`

Minimum actionable link count: 1

---

### Release (`/release/:id`)

Required: at least one of:
- Artist links (in hero section)
- Label links (in metadata)
- Versions list (pressing count link)
- Tracklist (implies navigable content)

If no artist or label links:
- Must render warning with outbound Discogs link.

Minimum actionable link count: 1

---

### Version (`/version/:id`)

Required:
- Parent release link (`/release/:master_id`) — always rendered if master_discogs_id exists
- At least one of: artist links, label links, tracklist

If `master_discogs_id` is null:
- Must render: `"Parent release not found — this version may be unlisted."`
- Must render: outbound link to `https://www.discogs.com/release/:id`

Minimum actionable link count: 1

---

## 3. Allowed Fallback Copy (Canonical)

| Context | Fallback text |
|---------|---------------|
| Artist — no releases, credits, or connections | "No releases, credits, or connections found for this artist." |
| Artist — has credits but no primary releases | "No primary releases — see Credits & Appearances above." |
| Label — no releases | "No linked releases found for this label yet." |
| Release — no artist links | "Artist information unavailable." |
| Version — no parent release link | "Parent release not found — this version may be unlisted." |
| Generic empty section | Do NOT use — must use entity-specific copy |

---

## 4. Exemptions

The following are NOT dead ends even if they have no internal links:
- Artist pages with a rich profile text and outbound Discogs URL
- Label pages with >0 releases (even if not paginated in UI)
- Version pages with a valid parent release link

Dead-end determination is based on rendered actionable links, not underlying data completeness.

---

## 5. Evaluation Method

For each canary entity:
1. Fetch page HTML
2. Count `<a href="/(artist|label|release|version|master)/...">` links in main content (exclude nav/footer)
3. Check fallback copy blocks are present when actionable count = 0
4. Flag violations: zero links + no fallback

Exit code: non-zero if any violation found.
