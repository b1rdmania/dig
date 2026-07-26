# dig

House and techno, 1988 to 2008. A catalog you can search, chat to, or plug into Claude.

**[app.dig.baby](https://app.dig.baby)** · [how we built it](https://app.dig.baby/progress) · [FAQ](https://app.dig.baby/faq) · [try the pilot](https://app.dig.baby/pilot)

## The story

In March I rebuilt Discogs: the full catalog, a fast API, videos wired into every page, and a trial MCP server. It worked. It also cost about $2,000 in database bills, because the full catalog is 300 GB of Postgres that never sleeps. So I parked it, kept the ideas, and rebuilt the whole thing around one trick: **the database is a build artifact.**

Discogs publishes its entire catalog every month as CC0 XML, around 200 million lines. Each cycle, a local machine ingests the full dump, streams it through SAX parsers so memory stays flat, and cuts it down with scope manifests: style allowlists, era bounds, a tier-one label list. What ships to production is a ~10 GB database of house and techno with everything cross-linked. When the scope changes, you rebuild the artifact, not the product.

## Three ways in

- **Search** — [app.dig.baby](https://app.dig.baby). Works like Discogs: artists, labels, records. The difference: every record plays, and each label carries a curated core run of its essential records.
- **AI chat** — [/llm-beta](https://app.dig.baby/llm-beta), key-gated beta. An agentic loop over the catalog: every record it names comes from a tool call in that turn, links to its page, and renders its video. No tool result, no claim. Sessions bag up into one YouTube playlist plus a Discogs marketplace link per record.
- **MCP** — add `https://dig-mcp.fly.dev/mcp` as a custom connector in Claude. Claude can then search the catalog, walk the credit and remix graph, pull label essentials, and build session playlists. No code, no API key.

## What's underneath

Three public entities: artists, labels, masters. Search is Postgres full-text with trigram fuzzing, ranked master-first. Underneath sits the part most catalogs throw away: a full credit and remix graph, so the data knows who remixed what, who engineered what, and which names keep appearing on the same records. On top sits the editorial layer: fifteen curated scenes, a core run per label, and directional edges between labels (deeper, harder, rawer, weirder).

The database has four schemas and 33 migrations, with a CI gate that fails the build if the migration chain and the live schema disagree. Every catalog row carries a batch id: a re-ingest writes a fresh batch alongside the live one, the gates run (a no-dead-ends audit over canary entities, a regression smoke suite, a telemetry-fed search quality report), and the product flips only when they pass. A bad dump can never half-overwrite a good one.

The chat model is Moonshot's Kimi via OpenRouter; one environment variable swaps it to Anthropic. The whole thing runs on four small Fly.io machines for about the price of two coffees a month.

The long version, with a source link for every claim: [app.dig.baby/progress](https://app.dig.baby/progress).

## What it isn't

- Not a Discogs mirror. The catalog is scoped on purpose; pressing-level detail (versions, matrix numbers, marketplace listings) lives on Discogs and every record links straight to it.
- Not affiliated with Discogs. Independent, built on their openly licensed data. The pitch that they should do this themselves is in the [FAQ](https://app.dig.baby/faq).

## Status

**v0.5, beta.** Live and demoable. Search data has gaps (some tracks and artists missing); the catalog refresh follows the monthly Discogs dumps.

## Data

Catalog from the [Discogs data dumps](https://www.discogs.com/data/) (CC0). Cover art from the [Cover Art Archive](https://coverartarchive.org/). Crosswalks from [MusicBrainz](https://musicbrainz.org/) (CC0). The editorial layer is original to dig.

## Who

Built by [@b1rdmania](https://x.com/b1rdmania).
