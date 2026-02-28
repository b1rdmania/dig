# Enrichment Staged Prep (Run-8 Waiting Work)

This document tracks pre-ingest enrichment work that is safe to complete while core restore is still running.

## Scope of this prep

- Source manifests
- Field mapping references
- Crosswalk candidate templates
- Parser/adaptor skeletons

## Files created

### Source manifests

- `data/enrichment/source-manifests/musicbrainz.json`
- `data/enrichment/source-manifests/wikidata.json`
- `data/enrichment/source-manifests/setlistfm.json`

### Field mapping

- `docs/enrichment-field-mapping.md`

### Crosswalk candidates (templates)

- `data/enrichment/crosswalk-candidates/artists.csv`
- `data/enrichment/crosswalk-candidates/labels.csv`
- `data/enrichment/crosswalk-candidates/releases.csv`

### Parser/adaptor skeletons

- `scripts/enrich/README.md`
- `scripts/enrich/types.ts`
- `scripts/enrich/musicbrainz-adapter.ts`
- `scripts/enrich/wikidata-adapter.ts`
- `scripts/enrich/setlistfm-adapter.ts`

## Conventions (locked for EN-A)

- Canonical source: Discogs (`catalog.*`)
- Enrichment source: MB/Wikidata/Setlist (`enrich.*`)
- Every emitted record includes:
  - `source`
  - `source_id`
  - `confidence`
  - `match_method`
- No canonical overwrite logic in parser/adaptor layer

## Deferred until restore + Run 8

- DB migrations (`packages/db/migrations/006_enrich_schema.ts`)
- Any writes into `enrich.*`
- Full-source backfills

