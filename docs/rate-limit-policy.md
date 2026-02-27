# Rate-Limit Policy (v1 Alpha)

Locked for Phase 3 public alpha. Changes require discussion + version bump.

## Tiers

| Tier | Identifier | Limit | Window | Use case |
|------|-----------|-------|--------|----------|
| Anonymous | Client IP | 60 req/min | Sliding | Browser, casual curl, unauthenticated agents |
| Keyed | `X-API-Key` header | 300 req/min | Sliding | Registered agents, MCP clients, integrators |

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
