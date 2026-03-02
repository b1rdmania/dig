# Dig Staging Alpha — Invite Brief

## What is Dig?

Dig is a music data layer built on the Discogs CC0 catalog. It provides fast, structured access to 24M+ records via REST API, MCP (Model Context Protocol) for AI agents, and a mobile-first search UI.

## What you get

- **Search UI** at `https://app.dig.baby` — search + release detail pages (mobile-first)
- **REST API** at `https://dig-api.fly.dev/v1/` — search, entity detail, graph traversal
- **MCP server** at `https://dig-mcp.fly.dev/sse` — same data, native to Claude Code / Claude Desktop
- **API key** — 300 req/min (vs 60/min anonymous)
- **Quickstart docs** — [quickstart.md](quickstart.md)
- **Direct feedback channel** — [GitHub Issues](https://github.com/b1rdmania/dig/issues)

## Setup

### 1. Web UI (no setup needed)

Visit `https://app.dig.baby` and search. Click any release to see full detail (tracklist, credits, formats, provenance).

### 2. REST API

```bash
# Search for an artist
curl "https://dig-api.fly.dev/v1/search?q=radiohead&type=artist" \
  -H "X-API-Key: YOUR_KEY"

# Get a release
curl "https://dig-api.fly.dev/v1/releases/1" \
  -H "X-API-Key: YOUR_KEY"
```

See [quickstart.md](quickstart.md) for full endpoint reference.

### 3. MCP (Claude Code / Claude Desktop)

```bash
# Claude Code
claude mcp add --transport sse --scope user dig-catalog "https://dig-mcp.fly.dev/sse"

# Then ask Claude: "Search for Radiohead releases using dig-catalog"
```

For Claude Desktop, add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "dig-catalog": {
      "url": "https://dig-mcp.fly.dev/sse"
    }
  }
}
```

## What to know

### This is a staging alpha

- **Full catalog loaded**: 18.9M releases, 584k artists, 2.3M labels, 2.5M masters — all from the February 2026 Discogs CC0 dump.
- **Shared infrastructure** — Fly.io shared CPU VMs in Virginia. Performance is good (p50 ~110ms) but not production-grade.
- **No SLA.** Downtime possible for deploys, scaling, or data migrations.
- **Data is static** — no live sync with Discogs.

### Known limitations

| Area | Limitation |
|------|-----------|
| Broad queries | "music", "love" etc. may return degraded results (recent matches, not ranked) |
| Filtered release search | Genre/style filters use capped fallback — fast but not ranked |
| Popularity ranking | No popularity signal — can't distinguish iconic albums from same-titled obscure ones |
| Release fuzzy | Disabled — 18.9M-row trigram scan exceeds targets |
| Rate limits | 300/min keyed, 60/min anonymous. No burst allowance. |
| Auth | Keys are for rate-limit tiering only, not access control |
| Cover art | Available for ~1.8M releases via MusicBrainz crosswalk. Others show placeholder. |

### What's working well

- **Search**: FTS with exact/prefix name boosting, master-first grouping, FK-based dedup (p50 ~60ms)
- **Entity pages**: release (master) + version (pressing) + artist + label — all with tracks, credits, cover art
- **Track credits**: always-visible per-track credits with artist links, mobile-responsive
- **Cover art**: Cover Art Archive via MusicBrainz crosswalk, Redis-cached (7-day TTL)
- **URL scheme**: `/release/[id]` = canonical album, `/version/[id]` = specific pressing
- **Graph traversal**: 5 link types, cursor-paginated
- **MCP**: all 6 tools verified in Claude Code and Claude Desktop
- **Telemetry**: 5 event types logged (search, clicks, page views, outbound)

## Usage policy

- **CC0 data** — no restrictions on downstream use of the catalog data itself
- **Fair use of the API** — don't scrape the full catalog via the API. If you need bulk data, ask and we'll discuss a dump export.
- **Rate limits enforced** — sustained requests above your tier will get 429'd
- **Abuse** — automated abuse or sustained flooding will result in key revocation
- **No commercial SLA** until Phase 5. This is a community alpha.

## Feedback

We want to hear:
- Queries that return unexpected results (or no results)
- Latency issues on specific query patterns
- Missing fields or data quality issues
- Feature requests for the API, MCP tools, or web UI
- MCP integration issues with your agent setup
- Web UI bugs or mobile rendering issues

File issues at [b1rdmania/dig](https://github.com/b1rdmania/dig/issues) or reach out directly.

## Alpha keys issued

| Key | Issued | Tier |
|-----|--------|------|
| `alpha-tester-01` | 2026-03-01 | 300/min |
| `alpha-tester-02` | 2026-03-01 | 300/min |
| `alpha-tester-03` | 2026-03-01 | 300/min |
| `alpha-tester-04` | 2026-03-01 | 300/min |
| `alpha-tester-05` | 2026-03-01 | 300/min |
