# Dig: Project and Costing White Paper (v1)

Date: March 5, 2026  
Scope: Product direction, MCP-first launch economics, cost-control options, and monetization paths.

## 1. Executive Summary

Dig is now beyond prototype: full-corpus search and retrieval are live, MCP is operational, and the web app is publicly reachable. The main business risk is no longer technical feasibility; it is uncontrolled usage cost.

Core recommendation:
- Ship MCP in a controlled freemium mode.
- Keep web search free for discovery.
- Enforce hard budget guardrails from day one.
- Use one account/tier model across web LLM, MCP, and REST API.

If implemented, Dig can stay inside a $500-$1,000/month early-stage budget while still being usable enough to grow.

## 2. Current Product State

### What exists today
- Canonical catalog search and retrieval on Discogs-scale data.
- MCP tools operational for search/retrieval/traversal.
- Public web experience (`app.dig.baby`) with release/version/artist pages.
- Enrichment pipeline started (crosswalks, relationships, context, timelines).

### What is strong
- Speed is competitive on core lookups.
- Data depth is differentiated (credits, links, traversal, provenance).
- Agent-first design is already real, not aspirational.

### What is fragile
- Single shared production environment.
- One DB serving web + MCP + API workloads.
- Potential for cost spikes if anonymous agent traffic scales without caps.

## 3. Cost Drivers

Monthly cost is primarily:
1. Compute for API/MCP/web app servers.
2. Postgres CPU/IO and storage.
3. Bandwidth/egress (API + media/OG assets).
4. Redis/operational services.
5. LLM inference (if enabled in product tier).

Practical truth:
- API/MCP query load scales cost linearly at first, then non-linearly when DB contention triggers scaling.
- LLM usage can dominate margin if bundled as “unlimited.”

## 4. Unit Economics Model (Simple)

Use this model weekly:

`Monthly Cost ≈ Infra Base + (ReqVolume × InfraCostPerReq) + LLM Variable + Overheads`

Where:
- `Infra Base`: fixed Fly/Postgres/Redis baseline.
- `InfraCostPerReq`: blended DB+app+egress per request.
- `LLM Variable`: prompt+completion spend.
- `Overheads`: monitoring/logging/ops extras.

Track three KPIs:
1. Cost per 1,000 requests.
2. Cost per active key/user.
3. Gross margin per paid tier.

## 5. Launch Economics Scenarios

These are planning envelopes (not accounting-grade numbers):

### Scenario A: Controlled alpha
- Strict anonymous limits, moderate keyed usage.
- Spend envelope: ~$500-$1,000/month.
- Best fit for current stage.

### Scenario B: Semi-viral, uncapped anonymous
- High MCP crawl/testing volume, little conversion.
- Spend envelope: can exceed $2,000/month quickly.
- Not acceptable without auto-protection.

### Scenario C: Freemium with enforced quotas
- Anonymous tryout + free key + paid tiers + top-ups.
- Spend envelope: predictable and tunable.
- Best long-term operating model.

## 6. Recommended Month-1 Guardrails ($500 Target)

### Traffic policy
- Anonymous MCP:
  - 10 req/min
  - 50 req/day per IP
  - expensive queries restricted
- Free API key:
  - 60 req/min
  - 1,000 req/day
- Paid key:
  - 300 req/min+
  - higher daily/monthly quota

### Query cost weighting (for quotas)
- Cheap retrieval: 1 unit
- Search: 2 units
- Heavy filtered/traversal: 5-10 units

### Budget auto-protect mode
- 80% spend: tighten anonymous caps.
- 90% spend: disable heavy anonymous query classes.
- 100% spend: anonymous MCP paused; keyed only until reset.

## 7. Monetization Options

## Option 1: Free + API key tiers (recommended)
- Pros: simple, market-standard, immediate.
- Cons: requires auth and key management.

## Option 2: Subscription with bundled LLM + API
- Pros: clean pricing story.
- Cons: margin risk if uncapped.

## Option 3: Credits/top-ups
- Pros: safer COGS control, good for spiky users.
- Cons: slightly more billing complexity.

## Option 4: Enterprise support/custom models
- Pros: higher ACV and stronger margins.
- Cons: sales/support overhead.

Recommended combination:
- Free anonymous tryout.
- Free key tier.
- Paid tiers with credits.
- Enterprise/custom as add-on, not core.

## 8. Unified Tiering (Avoid Split Signup)

One account system should govern:
- Web LLM access
- MCP quotas
- REST API quotas

Single entitlement model:
- `Free`
- `Basic`
- `Pro`

Each tier controls:
- request limits
- feature flags
- LLM monthly credits
- support/SLA level

This avoids “two products” confusion and improves conversion.

## 9. Can $10/month work?

Yes, only if capped.

`$10 Basic` is viable as:
- fixed monthly credits
- strict rate and quota limits
- overage/top-up enabled

`$10 unlimited` is not viable once LLM usage is included.

## 10. MCP Marketplace Strategy

User expectation: “it should work immediately.”

Recommended UX:
1. Out-of-box anonymous mode works.
2. Limit reached -> clear upgrade path.
3. “Get free key for higher limits” message.

This balances adoption and cost control.

## 11. Operational Risk Controls

Mandatory before broad launch:
1. Hard machine count caps.
2. DB connection pool partitioning for web vs agent traffic.
3. Per-class timeout and degraded behavior.
4. Cost alerts at 50/75/90/100%.
5. Weekly cost review with top-keys and top-queries.

## 12. 30-Day Action Plan

Week 1:
- Enforce MCP anonymous and key quotas.
- Add spend guardrails and protect mode.
- Publish pricing/limits page.

Week 2:
- Launch free key onboarding.
- Add upgrade/top-up flow.
- Instrument conversion funnel (limit hit -> signup -> key use).

Week 3:
- Roll out Basic/Pro paid tiers.
- Tune unit weights by real query cost.

Week 4:
- Reprice based on measured margin.
- Decide MCP-only vs MCP+API public expansion.

## 13. Decision Framework

Use this monthly:
- If margin negative on paid tiers: raise weights/price or reduce included credits.
- If growth low but costs safe: loosen free tier slightly.
- If growth high and costs spiking: tighten anonymous and push key conversion.

## 14. Bottom Line

Dig can be both open and sustainable if:
- anonymous usage is intentionally limited,
- heavy usage is keyed and metered,
- LLM access is credit-based (not unlimited),
- and spend guardrails are automatic, not manual.

That approach preserves adoption while preventing runaway infrastructure bills.
