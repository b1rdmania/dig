# Dig Staging Alpha — Invite Brief

## What is Dig?

Dig is a music data layer built on the Discogs CC0 catalog. It provides fast, structured access to 24M+ records via REST API and MCP (Model Context Protocol) for AI agents.

## What you get

- **REST API** at `https://dig-api.fly.dev/v1/` — search, entity detail, graph traversal
- **MCP server** at `https://dig-mcp.fly.dev/sse` — same data, native to Claude Code / Claude Desktop
- **API key** — 300 req/min (vs 60/min anonymous)
- **Quickstart docs** — [quickstart.md](quickstart.md)
- **Direct feedback channel** — [GitHub Issues](https://github.com/b1rdmania/dig/issues)

## What to know

### This is a staging alpha

- **50,000 releases** out of 18.9M total. If you search for a release and get no results, it's probably not in the sample. Artists (584k), labels (2.3M), and masters (2.5M) are complete.
- **$3/mo VM** — shared CPU, 512MB RAM, Virginia datacenter. Performance is representative but not production-grade.
- **No SLA.** Downtime possible for deploys, scaling, or data migrations.
- **Data from February 2026 Discogs dump.** No live sync with Discogs.

### Known limitations

| Area | Limitation |
|------|-----------|
| Release coverage | 50k sample (0.3% of full catalog) |
| Fuzzy search | Slow on labels/masters at p95 (~3s). Disabled for releases. |
| Cross-entity broad queries | "music", "love" etc. can take 3-6s |
| Release fuzzy | Disabled — 18.9M-row trigram scan exceeds all targets |
| Rate limits | 300/min keyed, 60/min anonymous. No burst allowance |
| Auth | Keys are for rate-limit tiering only, not access control |

### What's working well

- Artist/label/master search: fast, accurate FTS + fuzzy fallback
- Entity detail: full Discogs data with tracks, credits, formats, identifiers
- Graph traversal: 5 link types, cursor-paginated
- MCP: all 6 tools verified in Claude Code and Claude Desktop
- Latency: p50 ~110ms over internet (faster than Discogs API in all categories)

## Usage policy

- **CC0 data** — no restrictions on downstream use of the catalog data itself
- **Fair use of the API** — don't scrape the full catalog via the API. If you need bulk data, ask and we'll discuss a dump export
- **Rate limits enforced** — sustained requests above your tier will get 429'd
- **Abuse** — automated abuse or sustained flooding will result in key revocation
- **No commercial SLA** until Phase 5. This is a community alpha.

## How to get started

1. Read the [quickstart](quickstart.md)
2. Try a curl:
   ```bash
   curl "https://dig-api.fly.dev/v1/search?q=radiohead&type=artist"
   ```
3. Set up MCP in Claude:
   ```bash
   claude mcp add --transport sse --scope user dig-catalog "https://dig-mcp.fly.dev/sse"
   ```
4. Ask for an API key via [GitHub Issues](https://github.com/b1rdmania/dig/issues) if you want the 300/min tier

## Feedback

We want to hear:
- Queries that return unexpected results (or no results)
- Latency issues on specific query patterns
- Missing fields or data quality issues
- Feature requests for the API or MCP tools
- MCP integration issues with your agent setup

File issues at [b1rdmania/dig](https://github.com/b1rdmania/dig/issues) or reach out directly.
