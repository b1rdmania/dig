# Discussion: Next Directions for Dig

*Working doc — not a spec. Intent is to think through the big moves before committing to any of them.*

---

## 1. SSR Timeout Fix (P1, prerequisite for everything else)

### What's actually happening

Next.js SSR fetches data from `dig-api.internal` during the render pass. For high-catalog entities — Nirvana, Blue Note, Kind of Blue — the API query takes >10 seconds, Next.js hits its internal fetch timeout, and the page streams a TIMEOUT error instead of content. The entity exists, the data is there, the page just never gets it.

The canary shows 79/100 entities doing this. These aren't edge cases — they're the most-searched, most-linked pages on the site. A new user landing on `/release/21491` (OK Computer) gets a broken page.

### Why it's happening

Two compounding problems:

1. **The API query is slow for large entities.** A high-catalog artist like Nirvana has hundreds of masters, thousands of releases, complex credits. The traversal queries weren't written with streaming in mind — they block until complete.

2. **Next.js SSR is synchronous by default.** Everything fetches in parallel but the render waits for all of it before streaming. One slow fetch poisons the whole page.

### The fix: Suspense boundaries + streaming SSR

Next.js App Router supports streaming out of the box via `<Suspense>`. The pattern:

```tsx
// Instead of awaiting everything at the top:
export default async function ArtistPage({ params }) {
  const artist = await fetchArtist(id);  // fast — single row lookup

  return (
    <>
      <ArtistHeader artist={artist} />   {/* renders immediately */}

      <Suspense fallback={<SectionSkeleton />}>
        <ArtistReleases id={id} />       {/* streams in when ready */}
      </Suspense>

      <Suspense fallback={<SectionSkeleton />}>
        <ArtistCredits id={id} />        {/* streams in independently */}
      </Suspense>
    </>
  );
}
```

Each `<Suspense>` boundary is an async server component that fetches its own data. Next.js streams the shell immediately, then flushes each section as it resolves. If credits take 8 seconds, the user sees the artist header and releases first — not a blank page.

### What needs to change

- Split each artist/label/release page into a shell component (fast: single entity lookup) + section components (slow: traversal queries)
- Shell renders synchronously: name, image, basic metadata
- Each section is its own async component wrapped in `<Suspense>`
- The `SectionSkeleton` component already exists — we just need to use it at the right level
- API timeout on the internal fetch can stay at 10s; the user experience is transformed because the shell is never blocked

### Effort

Medium. The component split is mechanical but affects 4 pages (artist, label, release/master, version). The existing `<SectionSkeleton>` and `<Suspense>` imports are already in the codebase — this isn't new infrastructure, it's reorganising what's already there.

### Impact

Transformative. Every page becomes instantly responsive. The 79 canary timeouts become 79 pages that load progressively. This is the prerequisite for everything else — there's no point building new features on top of broken page loads.

---

## 2. Graph Traversal UI

### The idea

The data model is a graph. Artists → releases → labels → credits → other artists. Right now pages are flat lists: "here are Nirvana's albums", "here are the credits on Nevermind". What the data can actually do is much richer: *path-finding*.

Who connects Kurt Cobain to Miles Davis? What labels have released both jazz and electronic music? Which session musicians played on the most influential records of the 90s? These are answerable questions with the data we have, and they're unanswerable on Discogs.

### What this looks like in practice

**Degree-of-separation paths**
`/connect/artist/125246/artist/23755` — find the shortest path between Nirvana and Miles Davis through shared collaborators, labels, or releases. Display as a chain: `Nirvana → Butch Vig (producer) → Sonic Youth → Lee Ranaldo → ... → Miles Davis`. Real answers, not speculation.

**Label constellations**
On a label page: instead of a flat list of releases, show the artists as nodes. Cluster by decade or genre. Click a node to see what connects them. Blue Note's web of interconnected jazz musicians is genuinely beautiful as a graph.

**"Also worked with" chains**
On an artist page, after the releases: *"If you're interested in [artist], these are the people who connect them to..."* — not recommendations (no LLM, no ML), just graph traversal. Pure structural data presented as discovery.

### Technical approach

The traversal API already works. The domain layer can follow edges. What's missing is:

1. **A path-finding query** in `packages/domain` — Dijkstra or BFS over the entity graph using the existing relationship tables. The graph is large but well-indexed. BFS with depth limit 4 is fast enough for most interesting paths.

2. **A new API endpoint** — `GET /v1/connect?from=artist/125246&to=artist/23755` returning the path as an array of entities and edge types.

3. **A frontend for it** — a `/connect` page that's actually just a visualisation of the API response. Could start as a simple linear chain display (no canvas needed) and graduate to a proper graph component later.

The first version doesn't need D3 or a graph library. A chain of linked pills — `[Nirvana] —produced by→ [Butch Vig] —also produced→ [Sonic Youth]` — is already compelling and is just styled flex boxes.

### Why this matters

This is the feature that makes dig *dig*. It's the thing that Discogs, AllMusic, and Rate Your Music cannot do. It's structurally differentiating, not incrementally better. And it plays directly into the MCP angle — an agent asking "connect these two artists" is a natural tool call.

---

## 3. The MCP Showcase

### The problem

The MCP server exists and works. 50/50 smoke tests pass. But there's no demonstration of what it can actually do, and "we have an MCP server" is not a reason for anyone to care.

### What a good demo looks like

A single, memorable, concrete example. Not "search for artists" — that's just a search box. Something only the graph makes possible:

*"Find every musician who played on both a Miles Davis record and a John Coltrane record."*

This is a two-hop graph query: `release_credits WHERE artist = Miles Davis` ∩ `release_credits WHERE artist = John Coltrane`. The intersection is the answer. Claude can do this with `traverse_links` + some reasoning, and the answer — names like Bill Evans, Cannonball Adderley, Paul Chambers — is genuinely interesting to anyone who cares about jazz.

### What to build

- A `/demo` page (or section of `/about`) with 3–5 example prompts people can run against the live MCP
- The prompts are pre-written and shown as chat-style exchanges: "I asked Claude..." / "Claude answered..."
- Each example shows a different traversal capability: credits intersection, label constellation, degree of separation
- Link to the MCP endpoint for developers who want to connect their own Claude

This is marketing, but it's accurate marketing. The data does this. The MCP does this. It just needs to be shown.

---

## 4. Collections

### The idea

Discogs users maintain collections — records they own, records they want. Dig doesn't touch this yet. But the intersection of "what I own" with the graph is valuable:

- "Show me pressings of records in my collection I might upgrade"
- "Find artists connected to records I own that I haven't explored"
- "What do I own that connects to this artist?"

### The constraint

Discogs has a public API for collection data. We'd need OAuth or an API key from the user — we don't store their credentials, we just pass through. This is an auth flow we haven't built.

### Why it's worth thinking about now (even if not building)

Collections are *intent signal*. A user who connects their Discogs collection is telling us what they care about. That's the highest-quality data we could have for personalisation, for recommendations (even structural ones), for "you own the original — here's what else came from that session".

The design principle: collections should be read-only, ephemeral (never stored server-side), and used purely to contextualise traversal. Not a social feature. Not a "rate this record" feature. Just: *your collection as a lens on the graph*.

### What to build (when ready)

- OAuth flow with Discogs — they have a standard OAuth 1.0a endpoint
- Client-side collection fetch (never stored) — pull once, use as filter context
- "In your collection" badge on version pages
- "Connected to your collection" traversal on artist/label pages

This is a Phase 5+ feature but worth designing now so we don't paint ourselves into an architectural corner.

---

## 5. Mobile

### Current state

The pages render on mobile but they weren't designed for it. The search works. The entity pages are readable. But they feel like desktop pages viewed on a phone, not a mobile-first experience.

### What mobile-first means for dig specifically

dig is a *browsing* tool. You're at a record shop, you pick up a record, you scan a barcode or type the title. You want to know: is this a good pressing? What year? Who played on it? Is there a better version?

That's a very specific mobile use case — point-of-sale lookup — and it suggests a different page shape than "here's everything we know about this artist."

**The mobile version page should answer: should I buy this?**
- Pressing details (year, country, label, catalogue number) — top of fold
- Cover art large
- Tracklist collapsed by default
- Credits collapsed by default
- One prominent link: "See all pressings" (cheapest to most expensive by Discogs standard)
- "More by this artist" — 3 records, not 30

**The mobile artist page should answer: who is this?**
- Name, image, one-line genre/era summary
- 5 best-known records (highest quality score, newest first)
- One tap to "see all"

### What this requires

Mostly CSS and component restructuring. The data layer doesn't change. The API doesn't change. It's about responsive design, touch targets, and information hierarchy — showing the right 20% on small screens and burying the rest behind a tap.

The one new thing: a "summary" field on artist and release pages — a single sentence. Right now we surface Discogs profile text which is long-form and inconsistent. A computed summary (could be deterministic: "Electronic artist, active 1993–2010, 12 studio albums") would serve mobile well.

---

## Priority Order

Given where we are:

1. **SSR timeout fix** — nothing else matters until pages load. Medium effort, transformative impact. Do this first.

2. **Graph traversal UI** — the core differentiator. Start with the linear chain display for "connect two artists", build the path-finding query, ship `/connect`. No graph library needed for v1.

3. **MCP showcase** — relatively cheap. A few static example exchanges on `/about` or `/demo`. Unlocks developer interest without building anything new in the backend.

4. **Mobile** — ongoing, improves with every page you touch. Start it as a constraint on new feature work: every new page/component gets mobile-first treatment.

5. **Collections** — highest value, highest effort, needs auth flow. Design the data model now, build later.

---

## What this isn't

No social features. No ratings. No "you might also like" ML recommendations. No user accounts. Not because those things are bad but because they dilute what dig is: a clean, fast, structural view of the music graph. The value is the data and the traversal. Everything else is noise until that's fully realised.
