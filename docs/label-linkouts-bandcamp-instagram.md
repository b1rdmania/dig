# Label Linkouts (Bandcamp + Instagram)

Purpose: add reliable label linkouts without depending on third-party social/search APIs.

## Strategy (v1)

- Source of truth: existing Discogs label URLs in `catalog.label_urls`.
- Deterministic extraction only (domain + profile handle parsing).
- High-confidence auto-publish only.
- No fuzzy/global crawling in v1.

## Data model

- Table: `enrich.label_linkouts`
  - `discogs_label_id`
  - `provider` (`bandcamp` | `instagram`)
  - `url`
  - `handle`
  - `confidence`
  - `match_method`
  - `is_verified`
  - `source_batch_id`

## Import command

```bash
DATABASE_URL=... pnpm --filter @dig/ingest label-linkouts -- --limit 200000 --offset 0
```

Dry run:

```bash
DATABASE_URL=... pnpm --filter @dig/ingest label-linkouts -- --dry-run --limit 200000 --offset 0
```

## Matching policy (current)

- `bandcamp.com` profile URL:
  - confidence `1.000`
  - `match_method = discogs_label_url_exact_domain`
- `instagram.com/<handle>` profile URL:
  - confidence `0.980`
  - `match_method = discogs_label_url_exact_domain`
- Non-profile or reserved routes are rejected.

## Why this first

- Works with existing data immediately.
- Very low legal/operational risk.
- Gives useful coverage for modern/active labels.
- Leaves legacy labels untouched instead of forcing low-confidence matches.

## Follow-up (v2)

- Add review queue for medium-confidence fuzzy matches (`enrich.match_review_queue`).
- Add `label link claim` workflow for corrections.
- Add optional artist-level linkouts using the same pattern.
