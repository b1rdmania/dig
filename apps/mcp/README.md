# dig-mcp — ARCHIVED

> **Status: archived as of 2026-04-16.** The hosted public MCP at
> `https://dig-mcp.fly.dev/sse` is offline. The Fly app is parked at zero
> machines (zero cost) so the URL stays reserved; the source remains here for
> anyone who wants to revive or self-host it.

## Why archived

Built before the in-product chat existed. Targeted external agents (Claude
Desktop, IDE plugins). Negligible traffic in practice — the only real
consumer became the in-product `/llm-beta` chat, which now talks to the
catalog directly via internal routing in `apps/api`. Maintaining a separate
public SSE surface for zero callers wasn't worth the operational overhead.

## What it is

Fastify + `@modelcontextprotocol/sdk` SSE server that wraps `@dig/domain`.
Six tools at archive time:

- `search_catalog`
- `get_artist`
- `get_label`
- `get_master`
- `get_release`
- `traverse_links`

(The newer v2 surfaces — `list_scenes`, `get_scene`, `get_label_essentials`
— were only ever wired into the in-app `/v1/ask` route, not into the MCP.)

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
