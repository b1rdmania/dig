# dig

**Music search. Finally.**

Every AI asked about music guesses — confidently, fluently, wrongly. There's no structured, agent-ready music data layer on the internet. So we're building one.

Dig is a search engine and data layer built on the full [Discogs CC0 dataset](https://data.discogs.com/). 24 million records. 2.5 million masters. 580,000 artists. Every entity cross-linked — artists to releases, releases to credits, credits to labels. Click anything, follow the thread.

**[app.dig.baby](https://app.dig.baby)** — search it now.

---

## Use it

### Search the web app

Go to [app.dig.baby](https://app.dig.baby) and type. That's it.

### Connect via MCP

Point any MCP-compatible client (Claude Desktop, Claude Code, Cursor, etc.) at the server:

```json
{
  "mcpServers": {
    "dig": {
      "url": "https://dig-mcp.fly.dev/sse"
    }
  }
}
```

Six tools: `search_catalog`, `get_artist`, `get_label`, `get_master`, `get_release`, `traverse_links`.

### Hit the REST API

```bash
# Search
curl "https://dig-api.fly.dev/v1/search?q=radiohead"

# Get an artist
curl "https://dig-api.fly.dev/v1/artists/3840"

# Get a release
curl "https://dig-api.fly.dev/v1/releases/1234"

# Traverse the graph
curl "https://dig-api.fly.dev/v1/artists/3840/masters"
```

No keys required. No signup. Full [API docs](https://app.dig.baby/progress).

---

## What's in the box

- **REST API** — Fastify, every route under `/v1/`, cursor-based pagination, structured error responses
- **MCP server** — TypeScript MCP SDK, remote SSE transport, 6 tools wired to the full catalog
- **Web frontend** — Next.js, server-rendered, mobile-first, dark mode
- **Enrichment layers** — MusicBrainz crosswalks (1.8M releases, 1.2M artists), Wikidata context (bios, locations, genres for 200K artists), setlist.fm performance history
- **Cover art** — Cover Art Archive integration with Redis-cached lookups

All built on Postgres full-text search + pg_trgm. No external AI in the data path. Deterministic retrieval only.

---

## Stack

TypeScript · Node.js · Postgres · Kysely · Fastify · Next.js · Redis · Fly.io

---

## Status

Early stage. Active alpha. Building in public.

The API, MCP server, and web frontend are all live. See the [build log](https://app.dig.baby/progress) for where things stand.

---

Built by [@baborelux](https://x.com/baborelux)
