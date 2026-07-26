# dig-mcp

> **Status: revived 2026-07-26.** The hosted MCP at `https://dig-mcp.fly.dev/sse`
> is live again, serving the scene-scoped catalog from `dig-db-scene`. The
> machine scales to zero when idle, so steady-state cost is pennies.
> (Previously archived 2026-04-16 — history below.)

## Why archived

Built before the in-product chat existed. Targeted external agents (Claude
Desktop, IDE plugins). Negligible traffic in practice — the only real
consumer became the in-product `/llm-beta` chat, which now talks to the
catalog directly via internal routing in `apps/api`. Maintaining a separate
public SSE surface for zero callers wasn't worth the operational overhead.

## What it is

Express + `@modelcontextprotocol/sdk` SSE server that wraps `@dig/domain`.
Tools:

- `search_catalog`
- `get_artist`
- `get_label`
- `get_master`
- `get_release_shadow` (resolve a release ID to its master)
- `traverse_links`
- `list_scenes` (added at revival — previously in-app only)
- `get_scene` (added at revival)
- `get_label_essentials` (added at revival — curated core runs + directional related labels)
- `get_release` (deprecated, returns GONE)

## Reviving it

```bash
# from repo root
pnpm install
pnpm --filter @dig/mcp dev   # local dev on :3001

# deploy to Fly
fly deploy --config fly.mcp.toml --remote-only
fly scale count 1 -a dig-mcp
```

The MCP imports the same domain layer as the REST API, so it stays in sync
with whatever's currently in `packages/domain`. If you bring it back, also
re-add the `mcp-usage-endpoint` and `web-mcp-page` checks to
`scripts/regression-smoke.ts` and the `MCP_URL` env to
`.github/workflows/regression-smoke.yml`.

## Alternatives

- **In-product chat**: `/llm-beta` on the web app uses `apps/api/src/routes/v1/ask.ts`,
  an Anthropic agentic loop with native tool use over the same domain layer.
- **REST**: `https://dig-api.fly.dev` exposes the full retrieval surface. See
  `docs/quickstart.md`.
- **Self-host**: clone this directory, point at any reachable Postgres with
  the Dig schema, deploy wherever.
