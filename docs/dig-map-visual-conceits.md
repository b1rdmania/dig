# The Dig Map — three visual conceits

> Phase C visual brief. The homepage primitive becomes a map, not a card grid.
> The map *is* the navigation. Click anything, go there.
>
> This doc mocks three directions in ASCII. None of these are the final art —
> they're the structural and emotional brief for the illustrator. The data
> model underneath is the same in all three: scenes, labels, bridges.

---

## Why a map at all

A grid of scene cards solves cold-start. A map solves something deeper:

1. **Spatial memory beats list memory.** People remember "the bit in the
   top-right where Detroit was" better than "the seventh card in row two."
2. **Adjacency tells the story.** When Larry Heard sits next to Mr. Fingers
   sits next to Frankie Knuckles, the lineage is the layout.
3. **It rewards browsing.** You go in for one thing and discover three
   because they're physically near it. The "pulled through" feeling.
4. **It's a poster.** Shareable. Screenshottable. The thing people post
   without being prompted.

Inspiration (in the wall-pinned-reference sense, not the copy-it sense): the
Dorothy *Acid House Love Blueprint*, the London Tube map, Saul Bass's title
sequences, classic Trax / Warp / Tresor sleeve typography, the Detroit
Metroplex circuit-board sleeve, ECM cover grids.

---

## Conceit A — The Subway Map

**The pitch:** Dance music as a transit network. Each line is a scene, each
station is a label, transfers are how scenes connect.

```
                        DETROIT LINE
        ●────●────●────●────●────●────●────●────●────●
       UR   KMS  Trnst Mtpx Axis P-E  430W Subm. Sd.S Mhgni
                  │                    │
                  │              ┌─────┘
                  │              │
        ┌─────────┘              │
        │      BERLIN LINE       │      HOUSE LINE (CHICAGO)
        ●────●────●────●────●    │     ●────●────●────●────●
        BC   Tres Chain Ostg HW  │     Trax DJI  D.M Relf Caj.
                  │              │           │
                  │              │     ┌─────┘
        DUB TECHNO LINE          │     │
        ●────●────●────●         │     │     UK LINE
        Echo Echsp Dpcd ML       │     │     ●────●────●────●────●
                                 │     │     Warp Skam Reph FON  Mo'W
                                 │     │       │
                                 │     └───────┘
                                 │            transfer at "Acid"
                                 │
                            transfer at
                          "Berghain Era"

         interchanges (○):  ACID  ·  ESSENTIAL  ·  CITY-OF-ORIGIN
```

### Visual rules
- **Lines** = scenes. Different solid colors drawn from each scene's hero label palette.
- **Stations (●)** = labels. Size = catalog depth in the cut. Color = palette accent.
- **Interchanges (○)** = bridges between scenes (`/bridge/:slug`). Larger ring, white center.
- **Termini** = scene primers (where a "Detroit Core" line ends, you enter the scene page).
- **Type** is the soul: a stencil-mono lockup. Station names sit perpendicular to the line, like London Underground.
- **Empty space matters.** The map breathes. ~60% of canvas is paper, not type.

### Strengths
- Instantly legible to anyone who's ever held a map.
- The data structure maps 1:1 (lines = scenes, stations = labels, transfers = bridges) — no awkward translation.
- Mono-friendly, fits the ASCII-zine aesthetic.
- Scales gracefully — 6 lines or 60, the format holds.
- Shareable as a poster — would actually look good printed at A1.
- Has cultural precedent (Beck, Vignelli, Garcia) — feels intentional, not novel-for-its-own-sake.

### Weaknesses
- Orthogonal grids fight against the organic genealogy of music. Detroit didn't influence Berlin in a straight line.
- "Stations" implies all labels on a line are equivalent stops. They aren't — UR isn't equivalent to a minor Detroit imprint.
- Hard to show *time*. A subway map is spatial, not temporal. We'd need a separate device for the 1988→2003 arc.

### Mobile collapse
- Each line becomes a horizontal strip. Vertical scroll = move between scenes. Tap a station = label page. Pinch-zoom = zoom on the map.

---

## Conceit B — The Constellation Chart

**The pitch:** Dance music as a night sky. Labels are stars (size = catalog
depth, color = palette). Constellations are scenes, traced in faint ink with a
named figure.

```
                        ✦  · DETROIT  ·  ✦
                       ╲                  ╱
                ✦       ●────────●       ✦
              ●  KMS    UR     METRO       ●
              ╲    ╲     │      ╱        TRANSMAT
               ╲    ╲    ●     ╱            ●
                ╲    ╲  AXIS  ╱            ╱
                 ●────●─────●─────────────●  PLANET-E
                       ╲ │ ╱
                        ╲│╱
                  ───── ✺ ─────  acid bridge
                        ╱│╲
                       ╱ │ ╲
                  ●───●─── ●          BERLIN  ✦
                BPITCH  TRESOR  BASIC ─── CHAIN
                                   ╲       │
                                    ╲      ●
                                     ╲   ECHOCORD
                                      ╲   │
                                       ●──●  DUB CONSTELLATION
                                     MOD.LOVE

              · CHICAGO ·       · UK ·       · COLOGNE ·
                ●  ●  ●          ●  ●  ●        ●   ●
              TRAX DJI DM       WARP REPH SKAM  KMP PRFN

         Hover any star → palette glow + label preview
         Tap any constellation name → /scene/:slug
         Tap any star → /label/:id
```

### Visual rules
- **Stars (●)** = labels. Size on a 4-step scale by catalog depth. Filled with the label's palette accent (or the default ink color for unstyled labels).
- **Constellations** = scenes. Drawn with thin connecting lines between member labels, named with a curated lockup (DETROIT, BERLIN, CHICAGO, UK, COLOGNE, TOKYO, etc.).
- **Bridges (✺)** = star-burst markers at points where two constellations connect (Detroit→Berlin, Chicago→UK).
- **Background** is paper, but darker — closer to the recto of an old astronomical chart. Type is still ink-on-paper.
- **Star glyphs** vary subtly: 4-point for techno-family labels, 6-point for house, 5-point for "everything else." A small but felt code.

### Strengths
- Beautiful. Naturally non-linear, which fits how genealogies actually flow.
- Scales infinitely — just add stars. Doesn't need to redraw the whole canvas.
- Romantic in a way that fits the editorial publication tone.
- Distinctive — nobody else in this space has done it.
- Easy to make scene-level zooms ("zoom on Detroit" = same map, just one constellation foregrounded).

### Weaknesses
- Risk of being beautiful but illegible. If the constellations don't read as recognizable shapes, it's just dots.
- Adjacency is fuzzier — without orthogonal lines, "X is near Y" loses precision.
- Harder to show direction in a bridge than the subway map. A line from Detroit→Berlin is a transfer; a line of stars between two constellations needs more visual work to read as causal.
- Dark backgrounds are a departure from dig's existing paper aesthetic. Could be a jarring shift, or a deliberate "after-hours" mode for the homepage only — both are options.

### Mobile collapse
- Tricky. Probably degrades to a vertical scroll of constellation tiles, each containing its own mini-chart. Loses the unified-sky feeling.

---

## Conceit C — The Sleeve Mosaic

**The pitch:** A wall of tiny sleeve thumbnails clustered by scene, label
palettes giving the regions their color. Looks like the wall behind a
record-shop counter.

```
       ┌────────────────── DETROIT ──────────────────┐
       │ ▣▣▣▣▣▣▣▣ ▣▣▣▣▣ ▣▣▣▣▣▣ ▣▣▣ ▣▣▣▣▣▣▣ ▣▣▣ ▣▣▣ │
       │ ▣▣▣▣▣▣ ▣▣▣ ▣▣▣▣▣▣▣▣▣ ▣▣▣▣▣▣ ▣▣▣ ▣▣▣▣▣▣▣ ▣ │
       │ ▣▣▣▣ ▣▣▣▣▣▣▣ ▣▣▣ ▣▣▣▣▣ ▣▣▣▣▣▣▣ ▣▣ ▣▣▣▣▣▣ │
       └─────────────────────────────────────────────┘
        ┌── CHICAGO ──┐  ┌──── BERLIN ────┐
        │ ▣▣▣▣ ▣▣▣ ▣▣ │  │ ▣▣▣ ▣▣▣ ▣▣▣ ▣▣ │
        │ ▣▣▣▣▣ ▣▣▣▣▣ │  │ ▣▣▣▣▣ ▣▣▣ ▣▣▣ │
        │ ▣▣▣ ▣▣▣▣▣▣▣ │  │ ▣▣▣ ▣▣▣▣ ▣▣▣ │
        └─────────────┘  └─────────────────┘

       ┌──────── UK ─────────┐  ┌── COLOGNE ──┐
       │ ▣▣▣▣▣ ▣▣▣ ▣▣▣▣▣▣ │  │ ▣▣▣ ▣▣▣ ▣▣ │
       │ ▣▣▣▣▣▣▣ ▣▣▣ ▣▣▣  │  │ ▣▣ ▣▣▣ ▣▣▣ │
       └─────────────────────┘  └────────────┘

       Each ▣ = one master, sized 32×32 / 48×48.
       Hover → blow up + label/title overlay.
       Tap → /master/:id.
       Cluster background = label palette tint at 8% opacity.
```

### Visual rules
- **Each tile** is a master release's cover art (or a typographic fallback when no cover exists).
- **Clusters** are scenes, framed with a thin rule and a typeset scene name.
- **Within a cluster**, tiles group by label — a faint palette wash behind a sub-cluster signals "these are all on Tresor," "these are all on UR."
- **Density** is the point. A scene might have 200 tiles visible at a glance.
- **No grid lines between tiles** — it should feel like a record-shop wall, not a spreadsheet.

### Strengths
- Visceral and dense. Looks like a music product, not a software product.
- The cover art carries the work — each tile is already the design from a label and an artist who cared about it. Dig is just the wall.
- High information density per pixel. A user can scan dozens of records per second.
- Easy to ship — we already have the Cover Art Archive integration. Layout is the only new piece.
- Doubles as the OG image with no extra art direction.

### Weaknesses
- Cover art coverage is uneven. Many in-scope masters don't have a CAA hit — those would fall back to a typographic plate. If 30% of tiles are plates, the wall starts looking patchy.
- Rights — Cover Art Archive is permissive, but a wall of 1000+ thumbnails is a much more visible use than a single thumbnail on a master page. Worth a legal check.
- Lower legibility of *scene* relationships. You see lots of records; you don't see "Berlin came after Detroit." Adjacency tells label-cluster stories but not genealogical ones.
- Closer to "Pinterest for records" than to "the map of an era." Less editorial, more catalog.

### Mobile collapse
- Natural — it's already a grid. Just smaller tiles, vertical scroll, scenes stack instead of sit side-by-side.

---

## Side-by-side comparison

| Axis | Subway | Constellation | Mosaic |
|---|---|---|---|
| Legibility | High | Medium | Medium-low at scene level |
| Distinctiveness | Medium (familiar metaphor) | High | Medium (Pinterest adjacent) |
| Tells genealogy | Excellent | Good | Weak |
| Tells era / time | Weak | Weak | Weak |
| Editorial weight | Medium | High | Low |
| Mobile fidelity | Good | Poor | Excellent |
| Shareability as poster | Excellent | Excellent | Strong |
| Engineering cost | Medium (hand-positioned SVG layout) | Medium-high (positions need art direction) | Low (auto-grid from data) |
| Art-direction cost | Medium-high (typographic system) | High (every star + constellation is a design decision) | Low (cover art carries it) |
| Risk of "AI slop" feel | Low | Medium | Low |

---

## Recommendation: **Subway map**, with a constellation flourish for label-cluster zooms

The subway map wins for the homepage because:

1. **It maps to the data model 1:1.** Lines are scenes, stations are labels, transfers are bridges. We don't have to invent a translation layer.
2. **It's the most legible cold-start surface.** A first-time visitor knows what to do without any onboarding — even if they've never heard of Tresor or UR. They see lines, they tap stops.
3. **Genealogy works in straight lines for the era.** 1988–2003 dance music actually does flow in fairly direct bursts: Chicago→Detroit→Berlin, Detroit→UK bleep→Warp IDM. The subway diagram doesn't have to fight the data.
4. **Mobile works.** Constellation collapses badly on phone; subway scales by line.
5. **It's already a poster.** People print and frame transit maps. The dig map could live on a wall the day it ships.

The constellation should still exist — but as the **label-cluster zoom**. When you tap a station and land on `/label/23528` (Warp), the page header carries a small constellation showing Warp + Skam + Rephlex + the bridges between them. The two visual languages reinforce each other: subway = the city, constellation = the neighbourhood.

The mosaic gets relegated to a third-tier device: it powers the **scene page hero** (`/scene/detroit-core` opens with a wall of mastered Detroit covers, then the prose, then the spine). It's not the map; it's the scene's "wall."

So three surfaces, three visual languages, all from the same data:

| Surface | Language |
|---|---|
| Homepage | Subway map of the whole genre |
| Label page | Constellation of the label's immediate neighbourhood |
| Scene page | Sleeve mosaic of the scene's essentials |

That's the full visual system.

---

## What we need to commission

Assuming the subway direction is approved:

1. **A typographic system.** Stencil-mono station names, line-name lockups (DETROIT LINE / BERLIN LINE / etc.), bridge interchange glyph, terminus glyph, scale rules for station-size-by-catalog-depth.
2. **A line palette.** Six base line colors that don't fight the existing label palettes when they appear inline. Likely darker/desaturated relative to the label accents so the stations pop.
3. **A reference layout.** Hand-drawn first pass of the canonical 6-line / 30-station map at A2. The illustrator's job is to find the right physical arrangement of the data we hand them — Detroit top-left, UK bottom, Berlin centre, Chicago left-of-centre, etc.
4. **An SVG export with named ids.** So the renderer can swap palettes per session, hover-highlight a line, and inject live data (which station is currently the user's "you are here").

Once the reference layout exists, the engineering side is:

- New route: `/` becomes the map (search becomes `/search`).
- Data model: scenes, labels, bridges as already specified.
- Renderer: takes the SVG template + live data, outputs a hydrated, clickable, palette-tinted map. Tooltips, hover states, mobile pan/zoom.
- OG image: pre-rendered PNG of the canonical map at 1200×630.
- Estimated build (post-art-delivery): ~12 hours.

---

## What I'd ship before the map lands

While the illustrator is working (probably a 2-4 week turnaround for a real designer), I'd ship:

1. **The Scene primitive** (`/scene/:slug`, `/scenes` index) — works as a card grid in the interim.
2. **Essential masters** on label pages — independent of the map.
3. **Trail breadcrumb** in the page header — independent of the map.

That way the moment the map drops, every node in it already has a real destination. No empty links.

---

## Open questions

1. **Illustrator** — internal candidate, or do we go to brief? Names worth considering: someone in the Trapped In Suburbia / The Designers Republic lineage; someone who's done a transit map for fun (Cameron Booth, Jug Cerović); someone from the modular-synth poster scene. If you have a candidate already I'll write them a brief.
2. **Ship-with-grid-then-map, or hold-everything-until-map?** I'd vote ship grid first — momentum and coverage matter more than the map being the first thing people see. The grid is fine as a bridge.
3. **Constellation as a real second device, or scope-cut?** Genuinely useful, but adds art-direction cost. Could ship the subway alone first, add constellations to label pages in a second wave.
4. **Mosaic — do we have rights clearance?** Scene-page mosaic of dozens of cover thumbnails is a different use than single-thumbnail-per-master. Worth a 30-min legal check before committing.
