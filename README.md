# dig

**House and techno, 1988–2008. A catalog you can search, chat to, or plug into Claude.**

Built on the [Discogs CC0 dataset](https://data.discogs.com/): ~80,000 master releases with their artists, labels, credit graph, and fifteen curated scenes. Pressing-level detail links out to Discogs, where it belongs.

**[app.dig.baby](https://app.dig.baby)** · [how it's built](https://app.dig.baby/progress) · [FAQ](https://app.dig.baby/faq)

---

## Three ways in

- **Search** — [app.dig.baby](https://app.dig.baby). Full-text over artists, labels, and masters, master-first ranking, YouTube wired into every page, curated core runs per label.
- **AI chat** — [/llm-beta](https://app.dig.baby/llm-beta). An agentic loop over the catalog: every record it names comes from a tool call, links to its page, and renders its video. Sessions bag up into a YouTube playlist plus Discogs marketplace links. Private beta, key-gated.
- **MCP** — add `https://dig-mcp.fly.dev/mcp` as a custom connector in Claude. Search, credit/remix graph, label essentials, scenes, and session playlists — no code, no API key.

## How it's built

The production database is a **build artifact**: each Discogs dump cycle, the full catalog is ingested locally, scoped by style/era manifests, and shipped as a small (~10 GB) scene database. No always-on big-data infrastructure. The long version, with source links per subsystem: [app.dig.baby/progress](https://app.dig.baby/progress).

TypeScript · Postgres · Next.js · Fastify · Kysely · Redis · Fly.io · Kimi via OpenRouter

## Running it

```bash
pnpm install
docker compose up -d          # local Postgres (5433) + Redis
pnpm dev                      # API on :3000
pnpm dev:web                  # web on :3002
pnpm test && pnpm typecheck && pnpm lint
```

The scoped-database build (`scripts/build-scoped-db.ts`) needs a local Discogs dump; see the script header. The MCP server is `apps/mcp`.

## Status

**v0.5 — beta.** Live and demoable. Search data has gaps (some tracks and artists missing); the catalog rebuild cycle follows the monthly Discogs dumps.

## Who

Built by [@b1rdmania](https://x.com/b1rdmania).
