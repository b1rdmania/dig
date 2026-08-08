# Putting dig behind Cloudflare — scope

Status: proposed, not built. Written 2026-08-08 after two outages (08-07, 08-08).

## The prize

The catalog is ~80k master pages plus artists and labels, and every one is
server-rendered from scratch, per request, on a single shared vCPU, hitting
Postgres several times. Crawlers walking entity IDs is what wedged dig-web
twice this week.

Cached at an edge, those requests never reach Fly. Crawlers hit Cloudflare;
the machines only see cache misses and real interaction. It also fixes the one
thing nothing else can: a visitor in New York currently waits for London on
every page.

That is the reason to do this. Not tidiness, not consolidating providers.

## The sequencing insight — do the free half first

**Phase 1 needs no Cloudflare at all and should ship regardless.**

The catalog pages have no `revalidate` export, so Next treats them as fully
dynamic and emits `cache-control: private, no-cache, no-store`. Yet their own
data fetches already use `revalidate: 3600` — the data is being treated as
cacheable while the page around it is not.

Adding `export const revalidate = 3600` to the three catalog routes turns them
into ISR: Next renders once and serves the cached HTML from the machine's own
store, and emits a real `s-maxage` header instead of `no-store`.

That alone removes most of the crawler cost — the load that took the site down
— without touching DNS, email, or providers. Do it first, measure, and only
then decide whether Cloudflare is still worth the migration. It probably still
is, for the geography, but the urgency changes.

## Phase 2 — Cloudflare in front of app.dig.baby

### The footgun that must be handled first

Next.js serves **two different responses at the same URL**:

```
GET /artist/143267                → content-type: text/html
GET /artist/143267  (RSC: 1)      → content-type: text/x-component
```

It declares this with `vary: rsc, next-router-state-tree, next-router-prefetch,
next-router-segment-prefetch`. **Cloudflare ignores Vary on anything except
Accept-Encoding.** Cache this naively and the cache fills with whichever
response arrived first: browsers get raw React payloads, or client-side
navigation gets HTML and breaks.

Fix: a Cache Rule that **bypasses cache whenever the `RSC` header is present**,
so only full document requests are ever cached. Prefetches go to origin. This
must be in place before any caching rule, not after.

### What gets cached

| Path | Rule |
| --- | --- |
| `/artist/*`, `/label/*`, `/master/*` | Cache. Edge TTL 24h |
| `/scene`, `/scene/*` | Cache. Edge TTL 24h |
| `/`, `/about`, `/faq`, `/pilot`, `/progress` | Cache. Edge TTL 1h |
| `/robots.txt`, `/sitemap*.xml` | Cache. Edge TTL 1h |
| `/_next/static/*` | Cache. Edge TTL 1 year (content-hashed, immutable) |

### What must never be cached

| Path / condition | Why |
| --- | --- |
| any request with an `RSC` header | see footgun above |
| `/api/*` | health checks, feedback, analytics |
| `/account*`, `/usage`, `/admin*` | per-user |
| `/llm-beta`, `/feedback` | interactive, POSTs |
| `/search*` | unbounded query space; the in-process memo (29c9576) already covers repeats |
| any non-200 | a cached 500 outlives the incident that caused it |

### Invalidation

The catalog is immutable per `batch_id`, so there is exactly one moment the
cache is wrong: a catalog rebuild. Deploys also change markup.

Purge everything at both points — rebuilds are monthly, so this is cheap and
there is no partial-purge logic to get wrong:

```sh
curl -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_PURGE_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Add to `scripts/build-scoped-db.ts` (end of run) and to the web deploy step.
Use a scoped token with Zone.Cache Purge only — nothing else.

### Rate limiting

robots.txt is a polite request; the crawlers that take a site down ignore it.
A WAF rate rule on `/artist/*`, `/label/*`, `/master/*` — say 60 req/min per IP
— is enforcement rather than etiquette. This is the belt to robots.txt's
braces, and it is the only measure that would have stopped the 08-07 pattern
regardless of the cache.

## What NOT to do

**Do not move the app or the MCP server to Workers.** The entire stack is
deliberately co-located in `lhr` because queries crossing the Atlantic hurt —
that is written into CLAUDE.md after the iad→lhr move (`/v1/health` 0.20s vs
`/v1/scenes/:slug` 0.68s when the API ran in iad). Edge compute in front of a
London Postgres makes every *uncached* request slower. Edge caching in front of
a co-located origin is right; edge compute in front of a distant database is
backwards.

`dig-mcp` specifically: its tools need the catalog, and a Worker cannot reach
Fly Postgres — it would call `dig-api` over HTTPS anyway. That trades a
£2.60/mo machine for an extra hop and a rewrite.

**Do not proxy `dig-api` through Cloudflare.** dig-web calls it at
`dig-api.fly.dev`, which is a fly.dev hostname and unaffected by any dig.baby
DNS change. Routing server-to-server traffic out to an edge and back would add
latency to the exact path that already broke twice.

## Migration steps

1. **Phase 1** — `export const revalidate = 3600` on the three catalog routes.
   Deploy, measure crawler-path latency and DB load. No CF involved.
2. Add `dig.baby` to Cloudflare, copy existing records. **`app` must be a
   proxied (orange-cloud) CNAME to `qxd113e.dig-web.fly.dev`.**
3. Cloudflare **Email Routing** for `dig.baby` — the current Namecheap MX
   records and `spf.efwd.registrar-servers.com` SPF stop working the moment
   nameservers move. Andy confirms the forwarder is unused, so this is setup,
   not migration.
4. Switch nameservers at Namecheap to Cloudflare.
5. Cache Rules in order: RSC bypass FIRST, then never-cache paths, then the
   cache rules.
6. WAF rate rule on catalog paths.
7. Purge hooks into the rebuild script and the deploy.
8. Fly still needs a valid cert for `app.dig.baby` — use CF Full (strict) so
   the edge→origin hop stays verified.

## Verification at each step

- After 1: catalog pages emit `s-maxage`, not `no-store`. Repeat page loads
  don't hit Postgres.
- After 5: `curl -sI https://app.dig.baby/artist/143267` shows `cf-cache-status:
  HIT` on the second request; the same URL with `-H "RSC: 1"` shows `BYPASS`
  and still returns `text/x-component`.
- After 6: hammer a catalog path and confirm 429s arrive.
- After 7: run a rebuild, confirm pages reflect new data within minutes.

## Rollback

Grey-cloud the `app` record. Traffic goes straight to Fly and everything
behaves as it does today. Nothing in the app depends on Cloudflare being
present, and that property should be preserved — no CF-specific headers in
application logic.

## Risks

- **The RSC split is the one that bites.** If cache rules land in the wrong
  order, the site breaks in a way that looks random and caches itself.
- 24h TTL means a hotfix to page markup is invisible until purged. Hence the
  purge-on-deploy hook.
- ISR (phase 1) stores rendered HTML per machine, so the two dig-web machines
  each keep their own. Fine — a miss is just today's behaviour.
- Cached 404s. Set a short TTL for non-200s or exclude them.
