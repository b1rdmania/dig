# Editorial roadmap

Longform narrative surfaces we could build on top of the catalog data.
Nothing in here is committed work — this is the backlog of scene-writing
ideas that came up while designing the artist/label pages. Each item
should be pitched separately before implementation.

## Principles

- **Narrative, not chat.** No open-ended prompts, no social feed. The
  editorial surfaces are *authored* (by us, initially) and play the role
  of liner notes / sleevenotes for the catalog.
- **Data-backed.** Every claim should cite a credit row, release, or
  discography slice that a reader can click through to verify. If the
  claim doesn't fall out of the catalog, either don't make it or surface
  it as "per Resident Advisor / Mixmag / [source]".
- **Scope-native.** House/techno 88–08 has its own vocabulary (12-inch,
  the B-side dub, white labels, remix packages, label nights, mastering
  engineers). Future scopes (hip-hop 79–99) will need their own framing.
  Do not reuse band/album language from rock.
- **Shareable objects.** Every editorial surface should be a stable URL
  with a good OG card — "Frankie Knuckles' Def Mix circle" is a link
  people send to their group chat, not something you find by searching.

## Candidate surfaces

### 1. Artist deep-dives — "The circle around ___"

One longform page per tier-1 artist. Built from the `collaborators`
endpoint + hand-authored framing. Sections:

- **Studio circle** — the credit constellation (Def Mix, Murk, etc.),
  annotated with who did what.
- **Vocalist line** — the singers they returned to (Knuckles →
  Jamie Principle / Adeva / Roberta Gilliam; Todd Terry → Martha Wash).
- **The releases that matter** — 8–12 masters, chosen editorially, each
  with a sentence on what made it land.
- **The labels they shaped / were shaped by** — the A&R relationships.
- **What came next** — who they mentored, who carried the sound.

First five candidates (in priority order):
1. Frankie Knuckles (Def Mix lens)
2. Larry Heard (Trax → Alleviated lens)
3. Masters At Work (Strictly Rhythm → MAW Records lens)
4. Derrick May (Transmat lens; tricky because the alias mess is real)
5. Theo Parrish (Sound Signature lens; small discography, high density)

### 2. Label deep-dives — "A&R axis of ___"

One page per tier-1 label showing the label as a curatorial act. Sections:

- **Founders + A&R** — who chose the records.
- **Signature producers** — 4–8 artists who defined the sound (from
  `getLabelTopCredits`).
- **Core run** — the releases that mattered (handpicked, not "top 10 by
  scene_weight"; use scene_weight as a candidate list then author).
- **Offshoots** — sublabels, spinoffs, artists who migrated away.
- **The year** — when the label peaked and what records marked it.

First three candidates:
1. Strictly Rhythm (NYC, 1989–)
2. Trax Records (Chicago, 1984–)
3. Transmat / Metroplex / Underground Resistance (Detroit axis —
   could be one "Detroit axis" piece or three connected ones)

### 3. Scene map — house & techno 88–08 as a visual

Not a schematic (the Dorothy record-map is an example of what this
isn't). Closer to a *constellation diagram* — nodes are artists/labels
sized by scene_weight, edges are credit connections, colored by city.
Rendered as SVG, pannable, with each node linking to its page.

Questions to answer before building:
- Do we hand-author the node positions (good but doesn't scale to other
  scopes) or compute them (force-directed layout, might look generic)?
- How many nodes before it stops being legible? (Probably ≤60. The
  long-tail artists shouldn't be on the map.)
- Mobile story? (Probably a simplified vertical list on <768px, full
  pannable map on desktop.)

### 4. Year pages — "1992 in house"

One page per year in range. Sections:
- 10 defining masters released that year (editorial pick, cite
  scene_weight / credit density as supporting)
- New labels that opened
- First records from artists who'd later matter
- Tracks that broke (if we can source chart data — stretch)

Generates 16 pages (1988–2003), all stable URLs, good SEO, each links
back into artist/label pages. Low per-page effort if we hand-author the
framing and the data fills in the supporting lists.

### 5. Remix-lineage pages — "The history of ___"

Pick iconic tracks that had 20+ remixes over 10+ years (e.g. "Can You
Feel It" by Mr. Fingers, "Promised Land" by Joe Smooth). Each page walks
the remix history chronologically, showing who picked it up and what
they did with it. The catalog has all this; we just need to select the
tracks and write the connective tissue.

## Explicitly not doing

- **"Remixed by" as a full artist tab.** Major-label remix packages mean
  any tier-1 artist's "remixed by" list is a noisy pile of 4×12" A-side
  remixers from contractual obligations. The signal is low. We surface
  remix work in two better places:
    - inbound: the artist's own "Remixes" tab (their external remix work)
    - outbound: the per-master credit list (who remixed this record)
  The editorial version (remix-lineage pages, above) is a curated
  alternative that preserves the useful signal.
- **User-authored content.** No comments, no reviews, no favorites, no
  accounts. The editorial voice is house voice — ours, credited, like a
  magazine.

## How this ties to the build

The `collaborators` endpoint and `label_top_credits` are the
infrastructure for (1) and (2) respectively. (3) needs a new scoring
endpoint ("give me the 60 most-connected nodes in this scope"). (4)
needs per-year release slices (already trivial from the catalog). (5)
needs a remix-lineage query (trivially derivable from
`master_track_credits` filtered to role='Remix').

The editorial voice itself is the unresolved problem — who writes, how
it gets reviewed, whether it sits in Markdown in this repo or in a CMS.
Park that until we pick the first piece.
