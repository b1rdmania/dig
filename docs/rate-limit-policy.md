# Rate-Limit Policy (v1 Alpha)

Locked for Phase 3 public alpha. Changes require discussion + version bump.

## Tiers

| Tier | Identifier | Limit | Window | Use case |
|------|-----------|-------|--------|----------|
| Anonymous | Client IP | 400 req/min | Sliding | Browser, casual curl, unauthenticated agents |
| Keyed | `X-API-Key` header | 1000 req/min | Sliding | Registered agents, MCP clients, integrators |

## MCP Beta Guardrail Policy (Week 1)

Anonymous MCP traffic is intentionally stricter than REST for initial launch. No API key is required for MCP in this phase.

| Tier | Identifier | Limit | Window |
|------|-----------|-------|--------|
| MCP Anonymous | Client IP | 10 req/min | Fixed |
| MCP Anonymous | Client IP | 50 req/day | Fixed |

Control env vars (in `fly.mcp.toml`):
- `MCP_ANON_PER_MIN` (default `10`)
- `MCP_ANON_PER_DAY` (default `50`)
- `MCP_SPEND_PCT` (default `0`)
- `MCP_BETA_CAPACITY_MODE` (`on|off`, default `off`)

Spend protect behavior:
- `MCP_SPEND_PCT >= 80`: anonymous tightened to max `5/min`, `20/day`
- `MCP_SPEND_PCT >= 90`: anonymous tightened to max `2/min`, `10/day`
- `MCP_SPEND_PCT >= 100` or `MCP_BETA_CAPACITY_MODE=on`: anonymous requests return `503 BETA_CAPACITY` with beta message/upgrade hint

## Headers

All `/v1/` responses include:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Requests left in current window |
| `X-RateLimit-Reset` | Seconds until window resets |
| `Retry-After` | Seconds to wait (only on 429) |
| `X-Request-Id` | Unique request identifier (UUID) |

## 429 Response

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": { "retry_after": 60 }
  }
}
```

## Key Management (Phase 3)

Note: this section applies to REST and future premium MCP tiers. Initial MCP launch is anonymous-only.

- API keys are stored in `auth.api_keys` table (schema exists in migration 001)
- Keys are passed via `X-API-Key` header
- Key format: `dig_` prefix + 32 random hex chars (e.g., `dig_a1b2c3d4e5f6...`)
- Keys identify the caller for rate limiting and usage tracking
- No authentication/authorization on reads in v1 — keys are for rate-limit tiering only

## Implementation

- Backend: `@fastify/rate-limit` with ioredis (Upstash in production)
- Key generator: `X-API-Key` if present, otherwise `req.ip`
- Fallback: if Redis unavailable, rate limiting is disabled (fail-open for alpha)
- CORS: all origins allowed, `X-API-Key` in allowed headers

## Future (post-alpha)

- Per-endpoint rate limits (search more expensive than retrieval)
- Daily quota tracking (not just per-minute)
- Key rotation and revocation
- Usage dashboard for key holders
