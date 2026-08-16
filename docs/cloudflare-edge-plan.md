# Putting dig behind Cloudflare — scope

Status: **Phase 1 SHIPPED** (cea2807). **Phase 2 LIVE 2026-08-16** — see "As built" below.
Written 2026-08-08 after two outages (08-07, 08-08).

## As built (2026-08-16)

- dig.baby on Cloudflare (Free), `app` proxied to Fly, SSL Full (strict).
- Cache Rules (order matters — **last matching rule wins**, so the bypass is LAST):
  1. `/artist/* /master/* /label/* /scene*` → cache, edge TTL **30 days** (catalog is
     frozen; no rebuilds scheduled), non-200s 60s.
  2. `/ /about /faq /pilot /progress /robots.txt /sitemap*` → 1h.
  3. BYPASS: any of headers `rsc`, `next-router-prefetch`, `next-router-state-tree`,
     `next-router-segment-prefetch`; paths `/api/* /account* /usage* /admin* /llm-beta*
     /feedback* /search*`; non-GET. Uses `any(http.request.headers.names[*] in {...})` —
     `len(http.request.headers["rsc"])` validates but never fires.
- Rate limit: catalog paths >10 req / 10s / IP → block 10s. Bot Fight Mode on, AI bots blocked.
- **Purge on deploy**: `ops/deploy-web.sh` = fly deploy + `ops/cf-purge.sh`. Use it instead of
  bare `fly deploy` for dig-web. Run `ops/cf-purge.sh` after any catalog rebuild too.
- Fly side: web 1 always-on machine @1GB (+1 autostop), api 1 (+1 autostop), Redis removed
  (in-process cache), `RATE_LIMIT_EXEMPT_KEYS=*` so the web's own key skips the API limiter.
- Not done, by decision: Email Routing (unused), flycast for web→api (force_https makes
  plain-HTTP flycast fail — tried, reverted, 4 min outage), Workers migration (see "What NOT to do").

## Update after Phase 1 shipped

Phase 1 landed and it needed more than this doc originally said. Recording the
correction because the same trap will catch the next person:

**`export const revalidate` ALONE does nothing.** With only that export the
routes still built as `ƒ (Dynamic)` and still served `no-store`. Next needs an
explicit static opt-in alongside it. Both routes now carry:

```ts
export const revalidate = 3600;
export const dynamic = "error";
```

`"error"` rather than `"force-static"`: both force static rendering, but
`"error"` fails the BUILD if a dynamic API is later introduced, whereas
`"force-static"` silently hands that code empty values at runtime.

Measured on production: `/label/*` and `/master/*` serve in **47ms** from cache
(`x-nextjs-cache: HIT`), no dig-api or Postgres touch. Effective TTLs are 600s
and 300s, not 3600 — nested components (Labelmates, SeeAlso, TopCreditsBlock)
fetch with shorter revalidates and Next takes the minimum across the tree.

**So the urgency is gone.** The crawler load that wedged the site twice is now
served from cache. Phase 2 is a genuine improvement, not a rescue. What is
still outstanding and only Cloudflare fixes: `artist/[id]` (below), geography,
and rate limiting as actual enforcement.

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

## artist/[id] — the one route Phase 1 could not fix

`artist/[id]` still renders per request (`no-store`, 80-370ms) because it reads
`searchParams` for tab and filter state, which forces dynamic rendering. Label
and master have no such state, which is why they cached cleanly.

It matters: artist pages were a visible share of the crawler traffic in the Fly
proxy logs during both outages (`/artist/143267`, `/artist/339337`,
`/artist/338924`).

**The scope is smaller than it looks.** Of the 9 `digFetch` calls on that page,
exactly ONE depends on the params — the masters list, via
`/v1/artists/${id}/masters?...&release_type=${releaseType}`. The other eight are
param-independent. The params otherwise only decide which component renders
(`activeFilter === "remixes"`).

### Option A — do nothing, let Cloudflare handle it (recommended if Phase 2 happens)

Cloudflare caches by full URL, so `/artist/143267` and
`/artist/143267?tab=remixes` are separate cache entries. The bare URL — what
crawlers hammer and what nearly every visitor lands on — gets cached like any
other page, regardless of Next calling the route dynamic.

Zero code. If Phase 2 is happening, **do not refactor this route** — it is work
the edge does for free.

Caveat: the origin still renders on a miss, so an unbounded set of query-string
variants is uncached. Not a real risk — the variants are a closed set (`tab`,
`release_type` ∈ 4 values, `credits_role`).

### Option B — move filter state client-side (do this only if Phase 2 is NOT happening)

1. Delete `searchParams` from the page's `Props` and from `ArtistPage`.
2. Keep all eight param-independent fetches server-side, exactly as they are.
3. Move the masters strip into a client component that reads `tab` /
   `release_type` / `credits_role` via `useSearchParams`, wrapped in a
   `<Suspense>` boundary — `useSearchParams` is client-side and does NOT force
   the route dynamic when suspended.
4. That component fetches its filtered list from a route handler. Precedent
   already exists: `apps/web/src/app/api/search/route.ts` is a client-callable
   handler in this app.
5. Add `export const revalidate = 3600` + `export const dynamic = "error"` as
   per label/master. The build failing is the signal that step 1 was incomplete
   — that is why `"error"` is the right choice here.

Roughly an hour. Side benefit: tab switches become instant client-side state
instead of a full server round-trip.

Verify exactly as for label/master: two consecutive requests, second shows
`x-nextjs-cache: HIT`; the `?tab=remixes` variant still renders correctly.

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
