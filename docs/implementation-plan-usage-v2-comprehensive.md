# Implementation Plan: Usage Page V2 (Comprehensive, Cumulative)

Date: 2026-03-08
Owner: API/Web agent
Priority: P1 product analytics + ops visibility
Status: Ready

## 1) Goal
Upgrade `/usage` from basic process counters to a comprehensive analytics surface with cumulative and time-windowed metrics.

## 2) Scope
In scope:
- cumulative metrics persisted in Postgres
- daily aggregates for key product events
- richer `/v1/usage` payload
- redesigned `/usage` page sections

Out of scope:
- external BI warehouse
- user-level behavioral analytics
- paid billing metering

## 3) Metrics to expose

### A. Topline (Lifetime + 24h)
- API requests
- API errors
- MCP tool calls
- searches submitted
- search result clicks
- entity page views (artist/release/version/label)
- share clicks/completions
- outbound Discogs clicks
- media play clicks (YouTube)

### B. Funnel
- search_submitted -> search_result_clicked -> page_viewed -> outbound_discogs_clicked

### C. Reliability
- degraded response count (API search)
- timeout/degraded rate (if available)
- top failing routes (4xx/5xx)

### D. MCP
- calls by tool
- errors by tool
- p50/p95 by tool (if available in MCP usage endpoint)

### E. External clickthrough
- Discogs clickthrough total + CTR
- media_play_clicked total
- share_completed total

## 4) Data model

## 4.1 Existing
- `enrich.usage_counters` (lifetime key-value counters)

## 4.2 New table (daily aggregates)
Create migration `017_usage_daily.ts`:
- table: `enrich.usage_daily`
  - `day DATE NOT NULL`
  - `metric_key TEXT NOT NULL`
  - `entity_type TEXT NULL`
  - `route TEXT NULL`
  - `count BIGINT NOT NULL DEFAULT 0`
  - `created_at TIMESTAMPTZ`
  - `updated_at TIMESTAMPTZ`
  - PK: `(day, metric_key, COALESCE(entity_type,''), COALESCE(route,''))` implemented via unique index
- indexes:
  - `(day DESC, metric_key)`
  - `(metric_key, day DESC)`

## 4.3 Aggregation strategy
- on each telemetry accept / api request log, increment:
  - lifetime counter in `enrich.usage_counters`
  - daily counter in `enrich.usage_daily`
- same buffered flush approach as lifetime counters (10s interval, fail-open)

## 5) API contract changes (`/v1/usage`)
Return shape:
- `lifetime` (existing)
- `window_process` (existing since start)
- `windows`:
  - `last_24h`
  - `last_7d`
  - `last_30d`
- `funnel` (for each window)
- `top_routes` (errors/volume)
- `external` (discogs/media/share)

Keep backward compatibility by preserving current top-level keys.

## 6) Event mapping
Map accepted telemetry events into usage groups:
- `search_submitted` -> `funnel.search_submitted`
- `search_result_clicked` -> `funnel.search_result_clicked`
- `release_page_viewed`, `version_page_viewed` -> `page_view`
- `outbound_discogs_clicked` -> `external.discogs`
- `media_play_clicked` -> `external.media`
- `share_clicked`, `share_completed` -> `external.share`

## 7) `/usage` page IA (web)

### Section 1: KPI cards
- lifetime + 24h deltas for main metrics

### Section 2: Funnel
- table with conversion percentages across stages

### Section 3: Entity usage
- stacked rows by entity type page views

### Section 4: External engagement
- discogs clicks, media plays, shares

### Section 5: Reliability
- error totals, top routes by failures

### Section 6: MCP
- by-tool usage + errors

## 8) Operational safeguards
- Fail-open writes: usage UI must not break API if metrics writes fail.
- Batch flush + retry queue in memory.
- Hard cap on pending queue length to avoid memory growth.

## 9) Acceptance criteria
1. Counters do not reset on deploy/restart.
2. `/v1/usage` returns lifetime + 24h + 7d + 30d windows.
3. `/usage` renders all sections with non-empty data for active metrics.
4. Event ingestion remains 202 and does not regress latency materially.
5. Backward compatibility maintained for current consumers.

## 10) Implementation order
1. Migration 017 for `enrich.usage_daily`.
2. Extend metrics writer with daily aggregation.
3. Extend `/v1/usage` endpoint response.
4. Update web types.
5. Build `/usage` v2 sections.
6. Validate with seeded events + smoke tests.

## 11) Commands
```bash
git checkout -b codex/usage-v2-comprehensive
npx -y pnpm@10.27.0 --filter @dig/db typecheck
npx -y pnpm@10.27.0 --filter @dig/api typecheck
npx -y pnpm@10.27.0 --filter @dig/web typecheck
npx -y pnpm@10.27.0 --filter @dig/web build
```

Deploy:
```bash
fly deploy --config fly.api.toml --remote-only
fly deploy --config fly.web.toml --remote-only
```

## 12) Rollback
- revert API + web changes
- keep migration table (additive, safe)

## 13) Definition of done
- `/usage` becomes reliable product/ops dashboard with cumulative and time-window metrics
- usable for weekly KPI review without external tooling
