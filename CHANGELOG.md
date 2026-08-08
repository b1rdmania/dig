# Changelog

## v0.6.0 (2026-08-08)

The beta ran for two weeks and broke twice. This release is mostly the fixes,
plus the design pass that landed alongside them.

### Reliability

- `dig-web` runs two machines at 2GB. One machine wedged on 2026-08-07 and took
  the site down for four hours, because Fly health checks steer the load
  balancer but never restart a machine.
- An uptime watchdog outside Fly (Cloudflare Worker, `ops/uptime-worker/`) polls
  the public health URLs every two minutes and restarts wedged machines.
- Outbound API concurrency is bounded, and both apps have health checks.
- SSR fetches no longer go over `dig-api.internal`. Private Fly networking does
  not wake a stopped machine, which is what produced 26 to 90 second label
  pages.
- `robots.ts` throttles crawlers over roughly 80,000 server-rendered pages.

### Speed

- Label, master and scene pages are statically cacheable with a one hour
  revalidate.
- Search results are memoised in process, keyed by batch id. The catalog is
  immutable per dump, so there is nothing to invalidate.
- All apps moved to `lhr` alongside the database.
- The `dig.baby` apex routes straight to the app, one hop.

### Design

- Ink on paper everywhere: palette accents, gradients and drawn wordmarks are
  gone.
- One type system across entity pages. No boxed chips, no eyebrows, no share
  bars.
- Label identity is the sleeve wall, not a photo block.
- Page headings locked to one component. Favicon is the "D." tile.

### Listening

- Scene pages have an embedded player, shuffled per visit and clamped to the
  scene era.
- Label pages play the core run in curated order.

### Chat

- The dig deadline is 240 seconds, past the worst honest run. It was truncating
  credit graph digs at 90.
- Instant in-voice acknowledgment on submit, then a rotating status line.
- Broad first asks get sized up before the model commits to a dig.

### Docs

- README rebuilt as a reader's front door.
- "How we built it" at `/progress`: the pipeline, the ask loop and the batch
  flip, with source links into the repo.

## v0.5.0 (2026-07-26)

First public beta: the scoped catalog, the AI chat and the MCP server.
See https://github.com/b1rdmania/dig/releases/tag/v0.5.0
