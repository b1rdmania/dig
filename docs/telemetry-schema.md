# Telemetry Event Schema

## Endpoint

`POST /v1/events` — accepts batched client-side events.

**Request body:**
```json
{
  "events": [
    {
      "event": "search_submitted",
      "timestamp": "2026-03-02T12:00:00Z",
      "session_id": "uuid",
      "route": "/",
      "properties": { ... }
    }
  ]
}
```

**Response:** `{ "accepted": N }` (HTTP 202)

**Limits:** Max 25 events per batch. Invalid events are silently dropped.

## Common Fields (all events)

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event name (see below) |
| `timestamp` | ISO 8601 | Client-side timestamp |
| `session_id` | UUID | Random per-tab session ID (sessionStorage) |
| `route` | string | Page path (e.g., `/`, `/release/12345`) |
| `req_id` | UUID | Server-assigned request ID |
| `ip` | string | Client IP (for rate/abuse detection) |

## Events

### `search_submitted`

Fired when search results load.

| Property | Type | Description |
|----------|------|-------------|
| `query` | string | Search query text |
| `result_count` | number | Number of results returned |
| `elapsed_ms` | number | Server-side search time |
| `degraded` | boolean | Whether results were degraded |

### `search_result_clicked`

Fired when user clicks a search result.

| Property | Type | Description |
|----------|------|-------------|
| `query` | string | Search query that produced the result |
| `entity_type` | string | `artist`, `master`, `release`, `label` |
| `entity_id` | number | Discogs ID of clicked entity |
| `position` | number | 0-indexed position in section |

### `release_page_viewed`

Fired on `/release/[id]` page load (master/canonical album).

| Property | Type | Description |
|----------|------|-------------|
| `entity_type` | string | Always `master` |
| `entity_id` | number | Master Discogs ID |
| `title` | string | Album title |

### `version_page_viewed`

Fired on `/version/[id]` page load (specific pressing).

| Property | Type | Description |
|----------|------|-------------|
| `entity_type` | string | Always `release` |
| `entity_id` | number | Release Discogs ID |
| `title` | string | Release title |

### `outbound_discogs_clicked`

Fired when user clicks "Open on Discogs" link.

| Property | Type | Description |
|----------|------|-------------|
| `entity_type` | string | `master` or `release` |
| `entity_id` | number | Discogs ID |

## Log Format

Events are logged as structured JSON to stdout (Fly logs). Example:

```json
{
  "ts": "2026-03-02T12:00:00Z",
  "category": "telemetry",
  "event": "search_submitted",
  "session_id": "a1b2c3d4-...",
  "route": "/",
  "req_id": "uuid",
  "ip": "...",
  "p_query": "radiohead",
  "p_result_count": 15,
  "p_elapsed_ms": 31,
  "p_degraded": false
}
```

Properties are prefixed with `p_` to avoid collision with common fields.

## Querying Events

```bash
# All telemetry events
fly logs -a dig-api | grep '"category":"telemetry"'

# Search submissions
fly logs -a dig-api | grep '"event":"search_submitted"'

# Click-through rate (search → result click)
fly logs -a dig-api | grep -c '"event":"search_submitted"'
fly logs -a dig-api | grep -c '"event":"search_result_clicked"'

# Top queries (requires jq)
fly logs -a dig-api | grep '"event":"search_submitted"' | \
  sed 's/.*{/{/' | jq -r '.p_query' | sort | uniq -c | sort -rn | head -20

# Session flow
fly logs -a dig-api | grep '"session_id":"<id>"' | sed 's/.*{/{/' | jq '.event, .route'
```

## Privacy

- No PII collected (no user IDs, emails, or personal data)
- Session IDs are random UUIDs, not linked to accounts
- IPs logged for abuse detection only, not stored long-term
- Query text is logged to understand search patterns
