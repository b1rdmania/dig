# LLM Private Beta (v1)

This route is private and key-gated for internal testing.

## Endpoint

- `POST /v1/ask`

## Auth

- Header: `X-API-Key: <beta-key>`
- Server env: `LLM_BETA_KEYS` (comma-separated allowed keys)

## Required env vars

- `ANTHROPIC_API_KEY`
- `LLM_BETA_KEYS`
- Optional: `LLM_MODEL` (default `claude-3-5-sonnet-latest`)

## Request body

```json
{
  "question": "What are the key releases by Aphex Twin?",
  "model": "claude-3-5-sonnet-latest",
  "max_tokens": 800
}
```

## Response shape

```json
{
  "answer": "...",
  "confidence": 0.78,
  "citations": [
    { "type": "artist", "discogs_id": 45, "title_or_name": "Aphex Twin" }
  ],
  "meta": {
    "model": "claude-3-5-sonnet-latest",
    "elapsed_ms": 812,
    "search_results_used": 4,
    "request_id": "..."
  }
}
```

## Notes

- Context is assembled from Dig search + entity detail lookups.
- This is v1 private beta and not part of public API contract yet.
