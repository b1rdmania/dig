# Enrichment Field Mapping (EN-A Prep)

Mapping guide for parser/adaptor work before database ingest.

## Artist mapping

| Discogs target | MusicBrainz source | Wikidata source | Setlist source | Notes |
|---|---|---|---|---|
| `discogs_artist_id` | crosswalk input | crosswalk input | crosswalk input | Deterministic match output, not parser-only value |
| `mbid` | artist.id | via MB bridge | n/a | Canonical external artist ID |
| `wikidata_qid` | relation via MB/WD bridge | entity id (`Q...`) | n/a | Context layer key |
| `setlistfm_artist_id` | n/a | n/a | artist.mbid or setlistfm artist id | Depends on setlist payload route |
| `confidence` | derived | derived | derived | `0..1` |
| `match_method` | exact/fallback/review | exact/fallback/review | exact/fallback/review | Logged for audit |

## Label mapping

| Discogs target | MusicBrainz source | Wikidata source | Notes |
|---|---|---|---|
| `discogs_label_id` | crosswalk input | crosswalk input | Derived via deterministic matching |
| `mbid` | label.id | bridge via MB/WD | Stable external label key |
| `wikidata_qid` | relation | entity id | Optional if absent |
| `confidence` | derived | derived | `0..1` |
| `match_method` | exact/fallback/review | exact/fallback/review | Required |

## Release mapping

| Discogs target | MusicBrainz source | Notes |
|---|---|---|
| `discogs_release_id` | crosswalk input | Deterministic id mapping preferred |
| `mbid` | release.id | Optional if no match |
| `confidence` | derived | `0..1` |
| `match_method` | exact/fallback/review | Required |

## Relationship edge mapping

| EN-A edge field | MusicBrainz candidate | Wikidata candidate | Setlist candidate |
|---|---|---|---|
| `source_entity_type` | artist/label/release | artist/label/release | artist |
| `source_discogs_id` | mapped via crosswalk | mapped via crosswalk | mapped via crosswalk |
| `target_entity_type` | artist/label/release/external | artist/label/release/external | external/artist |
| `target_discogs_id` | mapped when possible | mapped when possible | mapped when possible |
| `edge_type` | member_of / produced_by / influenced_by ... | scene/location/influence links | performed_at |
| `edge_source` | `musicbrainz` | `wikidata` | `setlistfm` |
| `edge_source_id` | relationship id | statement id/entity id | event id |
| `confidence` | derived | derived | derived |
| `match_method` | exact/fallback/review | exact/fallback/review | exact/fallback/review |

## Context mapping

| Context type | Primary source | Shape |
|---|---|---|
| `bio` | Wikidata | short factual summary + entity refs |
| `history` | Wikidata/MB | timeline snippets |
| `scene` | Wikidata/MB | tagged scene memberships |
| `location` | Wikidata/Setlist | place nodes |
| `timeline_note` | Setlist | performance events |

## Confidence guidance (draft)

- `>= 0.95`: exact ID or verified crosswalk
- `0.80 - 0.94`: deterministic metadata match
- `0.60 - 0.79`: fuzzy/heuristic match (review queue candidate)
- `< 0.60`: do not ingest to canonical enrichment tables (review queue only)

