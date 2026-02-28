# Enrichment Parser/Adaptor Skeletons

These scripts are prep utilities for EN-A and do **not** write to the database.

## Output contract

Each script emits NDJSON records to stdout. Every record should include:

- `source`
- `source_id`
- `confidence`
- `match_method`

## Scripts

- `musicbrainz-adapter.ts`
- `wikidata-adapter.ts`
- `setlistfm-adapter.ts`

## Usage

```bash
npx tsx scripts/enrich/musicbrainz-adapter.ts --input ./tmp/mb-sample.json --entity artist > /tmp/mb.ndjson
npx tsx scripts/enrich/wikidata-adapter.ts --input ./tmp/wd-sample.json --entity artist > /tmp/wd.ndjson
npx tsx scripts/enrich/setlistfm-adapter.ts --input ./tmp/sl-sample.json > /tmp/sl.ndjson
```

## Notes

- Keep these scripts pure transforms during restore window.
- DB ingest starts only after restore + Run 8 + EN-A migration implementation.

