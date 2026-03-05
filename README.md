# dig

**Music search. Finally.**

Every AI asked about music guesses — confidently, fluently, wrongly. There's no structured, agent-ready music data layer on the internet. So we're building one.

Dig is a search engine and data layer built on the full [Discogs CC0 dataset](https://data.discogs.com/). 24 million records. 2.5 million masters. 580,000 artists. Every entity cross-linked — artists to releases, releases to credits, credits to labels. Click anything, follow the thread.

**[app.dig.baby](https://app.dig.baby)**

---

## What it does

- **Deep catalog search** — full-text search across 24M+ records, fast on mobile, dark mode
- **Connected entity pages** — every artist, label, release, and master cross-linked with type badges, filter chips, and newest-first sorting
- **Enrichment layers** — MusicBrainz crosswalks, Wikidata context (bios, locations, genres), setlist.fm performance history, Cover Art Archive artwork
- **No AI in the data path** — deterministic retrieval only, structured data, no hallucinations

---

## Stack

TypeScript · Postgres · Next.js · Fastify · Kysely · Redis · Fly.io

---

## Status

Early stage. Active alpha. Building in public.

See the [build log](https://app.dig.baby/progress) and [about page](https://app.dig.baby/about) for more.

---

## Who

Built by [@b1rdmania](https://x.com/b1rdmania).
