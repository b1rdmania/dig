# Dig — Legal & Licensing Summary

> **Status**: Draft — requires human review before publication.
> **Last updated**: 2026-02-25

## Discogs Data Dumps (CC0)

Discogs publishes monthly data dumps (artists, labels, masters, releases) under **Creative Commons CC0 1.0 Universal** — a public domain dedication, not a license.

| Question | Answer |
|---|---|
| Commercial use | Permitted without restriction |
| Attribution required | No (but conventional credit encouraged) |
| Redistribution | Permitted without restriction |
| Derivative works | Permitted without restriction |

**Conventional attribution**: "Data courtesy of Discogs (discogs.com), released under CC0."

Dig includes `discogs_id` and `source` provenance in all API responses, which constitutes reasonable attribution.

## Images — NOT covered by CC0

Images (album artwork) are **explicitly excluded** from the CC0 dedication. The data dumps contain no image data — confirmed by profiling of the February 2026 dump (zero `<images>` elements across 500k+ releases).

Dig's image strategy (see `docs/image-strategy-v1.md`) uses the Cover Art Archive (CAA) as primary source, with per-image license filtering — only CC0 and CC-BY licensed images are served.

## Discogs API Terms of Service

The Discogs API has separate terms from the dumps. Key restrictions:

- **Rate limits**: 25 unauth / 60 auth requests per minute
- **No bulk image harvest** from the Discogs CDN
- **Attribution required** for API-sourced data (separate from dump data)
- **Non-compete clause** on the API (does not apply to dump data)

Dig does not use the Discogs API in v1. The non-compete clause applies only to API use, not the CC0 dump data.

## Cover Art Archive (CAA)

CAA images have individual licenses set by uploaders. Dig must filter per-image:

- **CC0 / Public Domain**: safe to serve and cache
- **CC-BY**: safe to serve with attribution
- **Other licenses**: do not serve

See `docs/image-strategy-v1.md` for implementation details.

## Action Items (Human Review Required)

1. [ ] Verify current Discogs dump license at https://www.discogs.com/developers/ — terms may have changed since this was drafted
2. [ ] Review Discogs API non-compete clause wording if API use is planned in future phases
3. [ ] Confirm CAA license filtering implementation covers all edge cases before serving images
4. [ ] Consider adding a `/v1/legal` or `/v1/attribution` endpoint documenting data sources
