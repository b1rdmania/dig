# dig

**The house & techno catalog, browsable.**

Dig is a scene browser for house and techno, 1985–2008 — built on the [Discogs CC0 dataset](https://data.discogs.com/), scoped hard to the music that matters. Masters, artists, labels, and fifteen curated scenes, every entity cross-linked. Click anything, follow the thread. Pressing-level detail links out to Discogs, where it belongs.

**[app.dig.baby](https://app.dig.baby)**

---

## What it does

- **Scene pages** — fifteen curated scenes (Chicago house, Detroit techno, UK garage, …) with eras, key labels, and core runs
- **Master-first search** — full-text search across the scoped catalog: artists, labels, master releases
- **Connected entity pages** — labels with their essential runs, artists with close collaborators, masters with notable pressings
- **Enrichment layers** — MusicBrainz crosswalks, Wikidata context, Cover Art Archive artwork
- **No AI in the data path** — deterministic retrieval only, structured data, no hallucinations

---

## How it's built

The production database is a **build artifact**: each Discogs dump cycle, the full catalog is ingested locally, scoped by style/era manifests, and shipped as a small (~10GB) scene database. No always-on big-data infrastructure.

TypeScript · Postgres · Next.js · Fastify · Kysely · Redis · Fly.io

---

## Status

Repositioning for relaunch as the house & techno scene browser. Building in public.

---

## Who

Built by [@b1rdmania](https://x.com/b1rdmania).
