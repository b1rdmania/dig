# Dig — Design System

> Canonical reference for the visual language. Every page, component, and
> editorial decision answers to this doc. If something here is wrong, fix the
> doc, then fix the code — never the reverse.

**Status**: v1 (2026-04-16) — written alongside the overnight redesign that
introduced label-color identity, paper backdrop, and the catalog-spine pattern.

---

## 1. Mood

Dig should feel like **a fanzine printed on a risograph by someone who works
at a record shop**. Half typewriter, half record sleeve. Information-dense,
opinionated, made by hand.

Anti-references:

- **Spotify / Apple Music** — colourful album-grid sameness. Algorithmic, glossy, optimised for shuffle. We're the opposite: small, slow, deliberate, opinionated, format-aware.
- **RYM** — text-heavy but sterile. Reads like a database UI. We want to read like an editorial object.
- **Bandcamp** — closer to where we want to be (white space, big type, label identity), but still e-commerce-first. We don't sell anything.
- **Discogs** — necessary evil, the data source, but visually *uniform across every entity*. A 10,000-pressing major-label LP and a rare R&S 12" look identical. We refuse that.
- **Generic AI-default UIs** — gradient cards, rounded-2xl, skeleton-loading-shimmer everything. Lifeless. Don't.

References we *do* aspire to:

- **Wire magazine** — black-and-white density, classified-ad aesthetic, mono captions next to body serif.
- **Cabin magazine, Apartamento, Boat** — paper-cream backdrops, generous gutters, captions that read like sleeve notes.
- **Late-90s zine inserts** — IDM compilation booklets (Warp 10, Mille Plateaux samplers), the Profile/Home Entertainment box-set inserts.
- **A record sleeve** — the back of an LP. Tracklist, credits, catalog number, typeset by someone who cared.

The synthesis: **typewriter zine + skeuomorphic LP + a single canonical color per label.**

---

## 2. Color

### Base palette

```css
--paper:        #f4f1e8;   /* warm cream, the page                          */
--paper-edge:   #ebe6d6;   /* slight shadow at the page edge                */
--ink:          #1a1a1a;   /* near-black for body text                      */
--ink-soft:     #4a4a4a;   /* secondary text, captions                      */
--ink-muted:    #8a8a82;   /* tertiary, metadata, "—" dashes                */
--ink-faint:    #b8b3a4;   /* greyed-out, out-of-scope, "more"              */
--rule:         #d4cfbe;   /* hairline rules, dividers                      */
--surface:      #faf7ee;   /* slightly lighter than paper for cards         */
--surface-edge: #e5dfca;   /* card border                                   */
--ink-inverse:  #f4f1e8;   /* text on dark/coloured fills                   */
```

There is **no dark mode for v1**. The paper aesthetic depends on the warm
backdrop. Dark mode breaks the whole point. Re-evaluate post-launch only if
strong demand.

### Label color identity

Every tier-1 label has a canonical 2-colour palette stored in
`enrich.label_editorial.palette`:

- `accent` — the label's signature ink colour (R&S yellow, Warp grey, Tresor steel-blue, Trax black)
- `accent_ink` — the readable text colour on top of `accent` (usually black or paper-cream)

These get bound at runtime to CSS custom properties:

```css
--label-accent:     var(--accent, #1a1a1a);
--label-accent-ink: var(--accent-ink, #f4f1e8);
```

**Where it's used:**

- Catalog-number sticker on master/label pages (filled with `--label-accent`).
- Hairline above the label name in the page header.
- Tiny coloured dot next to label name in search results.
- Catalog-spine "current decade" marker.
- Nothing else. Restraint.

If a label has no palette, the page falls back to ink-on-paper. The page
should look correct without the colour — colour is identity, not chrome.

### Editorial tones

These are intentional, not configurable per label:

```css
--tier1-accent:     #c8431f;   /* burnt orange — "scene canon" sticker    */
--tier1-accent-ink: #f4f1e8;
--scope-out:        #b8b3a4;   /* unscoped releases on label catalog       */
--rule-bold:        #1a1a1a;   /* the 1px black rule under section heads   */
```

---

## 3. Typography

### Stack

```css
--font-mono:   "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;
--font-sans:   "IBM Plex Sans", "Söhne", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
--font-serif:  "Iowan Old Style", "Charter", "Source Serif Pro", Georgia, serif;
```

Loaded via Google Fonts (subset to latin + extended). Self-hosted in
production once we have a moment to wire it through `next/font`.

### Voice mapping

| Use | Family | Why |
| --- | --- | --- |
| **Headings, big titles** | `--font-sans`, weight 600 | Crisp, neutral. Lets label colour do the talking. |
| **Body running text** | `--font-sans`, weight 400, 15px | Neutral, easy to scan. |
| **Editorial blurbs** ("liner notes") | `--font-serif`, italic, 16px | Signals "this is a hand-written paragraph, not data." |
| **Catalog numbers, tracklist positions, year, durations, tags** | `--font-mono`, 13px | All numeric and tabular content. Aligns into columns. |
| **Sidebar/footer metadata, provenance** | `--font-mono`, 11px, `--ink-muted` | Unobtrusive, clearly secondary. |
| **The wordmark** | `--font-mono`, weight 600 | Looks like a stamped sticker. |

### Scale

Modular, mostly powers of ~1.25:

```css
--fs-xs:   11px;   /* metadata, provenance                  */
--fs-sm:   13px;   /* mono captions, tracklist position     */
--fs-base: 15px;   /* body                                  */
--fs-md:   16px;   /* serif blurb body                      */
--fs-lg:   20px;   /* section heading                       */
--fs-xl:   28px;   /* page title (label name)               */
--fs-2xl:  44px;   /* hero (homepage only)                  */
```

Line-heights:

- Display / titles: 1.1
- Sans body: 1.55
- Serif blurbs: 1.65
- Mono tabular rows: 1.4

Letter spacing:

- Mono captions: `0.04em` (slight loosening, looks like keyed-in text)
- Section headings: `0.02em`
- Body: `0` (default)

### The wordmark

The previous wordmark "Dig." (serif, with period) is replaced by:

```
[ dig ]
```

- Mono, lowercase, square brackets, weight 600.
- The brackets read as a label-tag / catalog-number sticker.
- Always in `--ink` on `--paper`. Never coloured per page.
- In the nav, always followed by a `——` em-rule and the build status (`alpha`).

---

## 4. Layout

### Page rhythm

```
[paper backdrop, full bleed]
  [container, max-width 880px, padded 32px sides]
    [section, separated by 56px vertical and a hairline rule]
      [heading]
      [content, indented 0 — left-aligned to the rule]
```

`880px` was chosen so a tracklist fits on one line at desktop without feeling
spaced-out, and a label catalog spine has room for: position number, title,
year, format, scope-tick. On wide screens the layout doesn't grow — it just
gets more whitespace, like a book.

### Spacing scale

```css
--sp-1:  4px;
--sp-2:  8px;
--sp-3: 12px;
--sp-4: 16px;
--sp-5: 24px;
--sp-6: 32px;
--sp-7: 48px;
--sp-8: 64px;
--sp-9: 96px;
```

### Rules and hairlines

Three weights, that's it:

- `1px solid var(--rule)` — section dividers, table rows
- `1px solid var(--ink)` — emphasis under section heads (the "stamped" rule)
- `2px solid var(--label-accent)` — the single coloured rule above a label name

No box-shadows. No card chrome. The only "depth" cue is hairlines.

### Borders & radii

Rounded corners are **forbidden** except on the catalog-number sticker
(`4px`) and the favicon. Everything else is square. The aesthetic depends on
this.

---

## 5. Components

The shared components live in `apps/web/src/components/design/`. Each is
exported with a stable, low-level API. Pages compose them; pages do not
override styling.

### `<Page>`

Wraps the paper backdrop. Sets `--label-accent` / `--label-accent-ink` from
props if a label palette is available. All entity pages must use this.

```tsx
<Page accent="#f5d000" accentInk="#1a1a1a" entityType="label" entityId={123}>
  ...
</Page>
```

### `<Sticker>`

The catalog-number sticker. A small inline-block with the label accent
colour, mono text, `--ink-inverse` foreground. Used for catalog numbers on
master pages, tier-1 badges, and label pills in search.

```tsx
<Sticker tone="label">RS 8056</Sticker>
<Sticker tone="tier1">SCENE CANON</Sticker>
```

### `<Stamp>`

The bracketed label-tag (e.g. `[ TIER 1 ]`, `[ MAIN ]`). All-caps mono,
tight bracket. Used for inline tags inside metadata rows.

### `<Rule>`

A hairline separator. Variants: `default`, `bold`, `accent`.

### `<MetaRow>`

A row of mono key:value pairs, separated by `·`, e.g.:

```
1995 · 12" · BE · 6 tracks · 28:14
```

### `<CatalogSpine>`

The defining component of the redesign. A vertical timeline of releases for
a label, rendered as a numbered list with year markers, format pill, and a
greyed-out treatment for unscoped pressings.

```
01 │ 1991 │ ████ │ Joey Beltram — Energy Flash             │ RS 91040 │ 12"
02 │ 1991 │ ░░░░ │ Aphex Twin — Digeridoo                   │ AMB LP3922│ 12"
03 │ 1992 │ ████ │ Sun Electric — Lost & Found             │ RS 92020 │ 12"
   │      │      │ + 2 unscoped 7"/CD pressings            │           │
04 │ 1992 │ ████ │ Robert Leiner — Visions of the Past      │ RS 92038 │ LP
```

- Position numbers use `--font-mono`, padded to 2 digits.
- Year column is sticky-feeling, dim until it changes.
- Greyed releases (unscoped) use `--ink-faint`. Black-text releases (in scope) use `--ink`.
- Format column is a `<Sticker tone="ghost">` if mono, plain mono otherwise.
- Rows are clickable (master link), with hover-underline on the title only.

### `<RosterColumn>`

For label pages. Two-column on desktop, single-column on mobile. Artists
sorted by # of in-scope masters on the label, descending. Each row: artist
name (link), `mono · n masters · first–last year`. Capped at top 12 with a
"+ N more" affordance.

### `<LinerNotes>`

A bordered block (1px `--ink`) styled to look like the back-cover credits
panel of an LP. Inside: tighter type, mono headings (`PROFILE`, `URLS`,
`ALSO KNOWN AS`), serif body for the editorial blurb.

### `<MonoTable>`

Tabular row component. All children align on column gutters using CSS
subgrid. Used by tracklists, catalog spine, version lists.

### `<TerminalListing>`

The search-results style. Mimics `ls -la` output:

```
master  Plastic Dreams                Jaydee            R&S       1992  IT  ●●●●
master  Plastic Dreams (Remixes)      Jaydee            R&S       1993  BE  ●●●○
artist  Jaydee                                                          ●●○○
label   R&S Records                   Ghent             1984—       ●●●●
```

Mono-aligned, faintly-ruled, no card chrome. Type column · Title · Artist · Label · Year · Country · Confidence dots.

---

## 6. The label-page anchor

The label page is the single most important surface in the new design. It's
where the aesthetic is most concentrated, and the showcase that justifies
everything else. Order of elements:

1. **Identity strip** (1× viewport-height-ish):
   - 2px coloured rule (`--label-accent`)
   - `[ LABEL ]` mono tag
   - The label name in `--fs-xl` sans
   - `[ TIER 1 ]` stamp if applicable
   - One-line meta: founded year, location, parent label, # of masters in scope

2. **Editorial blurb** (~50 words, serif italic, indented).
   - Hand-written by editorial. Not auto-generated.
   - Voice: knowledgeable record-store clerk. Terse, factual, slightly opinionated.
   - For unrated labels: skip this section entirely (it should feel absent, not empty).

3. **The catalog spine**:
   - Numbered chronological list of every master released on the label.
   - Greyed rows for unscoped pressings.
   - Year column doubles as decade markers (small text label every 10 rows or new decade).
   - Sticky decade strip on the right at desktop widths (`<aside>`).

4. **Roster column** (right-rail at desktop, below spine on mobile):
   - Top 12 artists by master count on the label.

5. **Liner-notes footer**:
   - The Discogs profile (cleaned up via existing `<DiscogsProfile>` parser).
   - URLs, aliases, parent-label / sublabels.
   - Bandcamp/Instagram linkouts if present.
   - Provenance (catalog batch + dump date).

6. **Outbound** — single Discogs link, mono, footer-inline.

The pattern is: **identity → opinion → catalog → roster → fine print.**
That's the same shape as the back of an LP sleeve.

---

## 7. The master page

The master page borrows from a 12" sleeve. Rough order:

1. **Header strip** with cover art (square, 220px), title, primary artist,
   primary label (linked), 2px coloured rule above the label name (`--label-accent`).
2. **Catalog sticker**: the main release's catalog number in a `<Sticker>` of `--label-accent`.
3. **Side-A / Side-B tracklist** (`<MonoTable>` rows).
   - When > 6 tracks and the format is LP-derivative, group by side header (`A1, A2…`, then `B1, B2…`).
   - Always show duration column right-aligned mono.
4. **Liner notes**: artist credits text (denormed `artists_credit_text`), notes blurb, provenance.
5. **Notable versions** (existing component, restyled to match `<MonoTable>`).
6. **Listen rail**: YouTube embeds for each pressing-with-video.

---

## 8. The search page

The search results become a `<TerminalListing>` (see component). Sections
remain (Releases / Versions / Artists / Labels) but are rendered as a single
unified listing with a `type` column on the left, indistinguishable rows
otherwise. Confidence (`relevance`) is shown as a faint mono dot pattern
(`●●●○`) at the right.

The empty-state on `/` (no query) is a single hero:

```
[ dig ]
————
A music data layer.
For the long-tail of recorded music.

Try: plastic dreams · daft punk · r&s records · juan atkins
```

The "Try" line uses the existing search bar functionality so each token is a
clickable link that fills the input and submits.

---

## 9. Voice (editorial)

When writing label blurbs, master notes, or any human-written copy:

- **Terse.** ≤50 words for a label, ≤25 for a master note.
- **Factual.** Founding year, founders, location, key artists, peak era. Don't invent. If you don't know it, leave it out.
- **Opinionated** but not florid. "Berlin's techno temple, 1991—" yes. "An iconic and visionary label that revolutionised electronic music" no.
- **British-ish English.** "Colour", "centre", "favourite" — matches the zine vibe.
- **Em-dashes**, not commas-with-pauses.
- **No exclamation marks. Ever.**
- **Never refer to dig in copy.** The data speaks for itself.

Sample: *R&S Records — Ghent, 1984. Renaat Vandepapeliere's house started as Belgian new beat, then opened the door for everyone who mattered between Detroit and Sheffield: Beltram, Aphex on Apollo, Sun Electric, the Ferox lineage. Jet-yellow sleeves. Run by feel.*

---

## 10. What's deliberately not in v1

- **Dark mode.** Paper aesthetic doesn't translate. Reassess post-alpha.
- **Per-label custom typography.** One canonical type stack; identity comes
  from colour and editorial copy, not type.
- **Skeuomorphic textures (paper grain, vinyl gloss, dust scratches).** The
  *idea* of paper/sleeves is enough. Rendering them would be kitsch.
- **Animation.** No transitions, no fades, no shimmer skeletons. Pages snap
  in or stream in plainly. The exception: the search input cursor blinks.
- **Iconography.** A handful of single-glyph svgs (▶ for play, the vinyl
  placeholder). No icon system.
- **Generic component library.** No shadcn, no MUI, no headless-ui. Every
  component is hand-written and lives in `components/design/`.

---

## 11. Implementation rules

1. **No inline `style={{…}}` for colour or typography.** Always use design
   tokens. Inline styles are tolerated only for one-off layout (`marginTop:
   "0.5rem"`).
2. **CSS modules per component.** No CSS-in-JS, no Tailwind. The point is
   that a designer can read the CSS file directly.
3. **Mono is for tabular content; sans is for prose; serif is for editorial.**
   Picking the wrong one is a code-review block.
4. **Every page must work at 360px width.** No exceptions.
5. **Every section that loads remote data must show a graceful skeleton or
   a clear empty state.** Spinners are forbidden; skeletons are mono dashes
   (`────`) at the row positions.
6. **Provenance is always shown at the bottom of a detail page.** It's not
   optional. It's the contract with the data source.
