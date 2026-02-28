# EN-A Migration Spec (`enrich.*` Foundation)

This spec defines the first enrichment migration to run **after** full restore + Run 8 verification.
It is schema-only and additive. No changes to `catalog.*`.

## 1. Preconditions

- Full restore complete and validated.
- Run 8 benchmark captured and approved.
- No long-running restore/import jobs active.

## 2. Migration File

Proposed file: `packages/db/migrations/006_enrich_schema.ts`

Scope:
- create `enrich` schema
- create EN-A tables
- create indexes/constraints
- no data backfill in this migration

## 3. DDL (Postgres)

```sql
CREATE SCHEMA IF NOT EXISTS enrich;

-- ---------------------------------------------------------------------------
-- Batch tracking for non-Discogs enrichment sources
-- ---------------------------------------------------------------------------
CREATE TABLE enrich.ingest_batches (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm')),
  source_batch_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'importing', 'qa', 'active', 'superseded', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  stats JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_batch_key)
);

CREATE TABLE enrich.refresh_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm')),
  checkpoint_key TEXT NOT NULL,
  checkpoint_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, checkpoint_key)
);

-- ---------------------------------------------------------------------------
-- Crosswalks: Discogs IDs to external IDs
-- ---------------------------------------------------------------------------
CREATE TABLE enrich.artist_crosswalks (
  id BIGSERIAL PRIMARY KEY,
  discogs_artist_id INTEGER NOT NULL,
  mbid TEXT,
  wikidata_qid TEXT,
  setlistfm_artist_id TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
  match_method TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discogs_artist_id)
);

CREATE UNIQUE INDEX uq_artist_crosswalks_mbid
  ON enrich.artist_crosswalks(mbid) WHERE mbid IS NOT NULL;
CREATE UNIQUE INDEX uq_artist_crosswalks_wikidata
  ON enrich.artist_crosswalks(wikidata_qid) WHERE wikidata_qid IS NOT NULL;
CREATE UNIQUE INDEX uq_artist_crosswalks_setlist
  ON enrich.artist_crosswalks(setlistfm_artist_id) WHERE setlistfm_artist_id IS NOT NULL;
CREATE INDEX idx_artist_crosswalks_confidence
  ON enrich.artist_crosswalks(confidence DESC);

CREATE TABLE enrich.label_crosswalks (
  id BIGSERIAL PRIMARY KEY,
  discogs_label_id INTEGER NOT NULL,
  mbid TEXT,
  wikidata_qid TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
  match_method TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discogs_label_id)
);

CREATE UNIQUE INDEX uq_label_crosswalks_mbid
  ON enrich.label_crosswalks(mbid) WHERE mbid IS NOT NULL;
CREATE UNIQUE INDEX uq_label_crosswalks_wikidata
  ON enrich.label_crosswalks(wikidata_qid) WHERE wikidata_qid IS NOT NULL;
CREATE INDEX idx_label_crosswalks_confidence
  ON enrich.label_crosswalks(confidence DESC);

CREATE TABLE enrich.release_crosswalks (
  id BIGSERIAL PRIMARY KEY,
  discogs_release_id INTEGER NOT NULL,
  mbid TEXT,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
  match_method TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (discogs_release_id)
);

CREATE UNIQUE INDEX uq_release_crosswalks_mbid
  ON enrich.release_crosswalks(mbid) WHERE mbid IS NOT NULL;
CREATE INDEX idx_release_crosswalks_confidence
  ON enrich.release_crosswalks(confidence DESC);

-- ---------------------------------------------------------------------------
-- Typed relationship edges
-- ---------------------------------------------------------------------------
CREATE TABLE enrich.relationship_edges (
  id BIGSERIAL PRIMARY KEY,
  source_entity_type TEXT NOT NULL CHECK (source_entity_type IN ('artist', 'label', 'release', 'master')),
  source_discogs_id INTEGER NOT NULL,
  target_entity_type TEXT NOT NULL CHECK (target_entity_type IN ('artist', 'label', 'release', 'master', 'external')),
  target_discogs_id INTEGER,
  target_external_id TEXT,
  edge_type TEXT NOT NULL,
  edge_source TEXT NOT NULL CHECK (edge_source IN ('musicbrainz', 'wikidata', 'setlistfm')),
  edge_source_id TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
  match_method TEXT NOT NULL,
  valid_from DATE,
  valid_to DATE,
  source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
  edge_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (edge_key)
);

CREATE INDEX idx_relationship_edges_source
  ON enrich.relationship_edges(source_entity_type, source_discogs_id);
CREATE INDEX idx_relationship_edges_target
  ON enrich.relationship_edges(target_entity_type, target_discogs_id);
CREATE INDEX idx_relationship_edges_type
  ON enrich.relationship_edges(edge_type);
CREATE INDEX idx_relationship_edges_confidence
  ON enrich.relationship_edges(confidence DESC);
CREATE INDEX idx_relationship_edges_source_batch
  ON enrich.relationship_edges(source_batch_id);

-- ---------------------------------------------------------------------------
-- Context blocks (bio/history/scene/location/timeline)
-- ---------------------------------------------------------------------------
CREATE TABLE enrich.entity_context (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('artist', 'label', 'release', 'master')),
  discogs_id INTEGER NOT NULL,
  context_type TEXT NOT NULL CHECK (context_type IN ('bio', 'history', 'scene', 'location', 'timeline_note')),
  content_json JSONB NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('musicbrainz', 'wikidata', 'setlistfm')),
  source_id TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.000 CHECK (confidence >= 0 AND confidence <= 1),
  match_method TEXT NOT NULL,
  source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
  context_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (context_key)
);

CREATE INDEX idx_entity_context_lookup
  ON enrich.entity_context(entity_type, discogs_id);
CREATE INDEX idx_entity_context_type
  ON enrich.entity_context(context_type);
CREATE INDEX idx_entity_context_confidence
  ON enrich.entity_context(confidence DESC);
CREATE INDEX idx_entity_context_gin
  ON enrich.entity_context USING GIN (content_json jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Low-confidence manual review queue
-- ---------------------------------------------------------------------------
CREATE TABLE enrich.match_review_queue (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('artist', 'label', 'release')),
  discogs_id INTEGER NOT NULL,
  candidate_source TEXT NOT NULL CHECK (candidate_source IN ('musicbrainz', 'wikidata', 'setlistfm')),
  candidate_id TEXT NOT NULL,
  candidate_payload JSONB NOT NULL,
  confidence NUMERIC(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  match_method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  source_batch_id BIGINT REFERENCES enrich.ingest_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, discogs_id, candidate_source, candidate_id)
);

CREATE INDEX idx_match_review_pending
  ON enrich.match_review_queue(status, confidence, created_at)
  WHERE status = 'pending';
```

## 4. `edge_key` and `context_key` Rules

Use deterministic keys in the ingest pipeline to keep upserts idempotent.

### `edge_key`

`md5(source_entity_type || ':' || source_discogs_id || ':' || target_entity_type || ':' || coalesce(target_discogs_id::text, target_external_id, '') || ':' || edge_type || ':' || edge_source || ':' || edge_source_id)`

### `context_key`

`md5(entity_type || ':' || discogs_id || ':' || context_type || ':' || source || ':' || source_id)`

## 5. Upsert Strategy

Use `ON CONFLICT ... DO UPDATE` on natural keys.

### Crosswalk upsert (example)

```sql
INSERT INTO enrich.artist_crosswalks (
  discogs_artist_id, mbid, wikidata_qid, setlistfm_artist_id,
  confidence, match_method, is_verified, source_batch_id, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
ON CONFLICT (discogs_artist_id) DO UPDATE SET
  mbid = EXCLUDED.mbid,
  wikidata_qid = EXCLUDED.wikidata_qid,
  setlistfm_artist_id = EXCLUDED.setlistfm_artist_id,
  confidence = EXCLUDED.confidence,
  match_method = EXCLUDED.match_method,
  is_verified = EXCLUDED.is_verified,
  source_batch_id = EXCLUDED.source_batch_id,
  updated_at = now();
```

### Edge upsert (example)

```sql
INSERT INTO enrich.relationship_edges (
  source_entity_type, source_discogs_id, target_entity_type, target_discogs_id, target_external_id,
  edge_type, edge_source, edge_source_id, confidence, match_method, valid_from, valid_to,
  source_batch_id, edge_key
)
VALUES (...)
ON CONFLICT (edge_key) DO UPDATE SET
  confidence = EXCLUDED.confidence,
  match_method = EXCLUDED.match_method,
  valid_from = EXCLUDED.valid_from,
  valid_to = EXCLUDED.valid_to,
  source_batch_id = EXCLUDED.source_batch_id;
```

## 6. Kysely Type Updates (Post-Migration)

After migration is merged:

- add EN-A table interfaces in `packages/db/src/schema.ts`
- add `enrich.*` table mappings to `Database` type
- add migration coverage tests (`pnpm test`) for create/drop and conflict behavior

## 7. Backout Plan

- `down()` drops EN-A tables in reverse dependency order, then `DROP SCHEMA enrich CASCADE`
- no canonical table dependency means rollback is isolated

## 8. EN-A Acceptance Checklist

- [ ] Migration applies in local + Fly staging
- [ ] Crosswalk/edge/context upserts are idempotent
- [ ] Pending review queue query is indexed and fast
- [ ] No changes to `catalog.*` or existing Phase 1/2 query plans
- [ ] Contract docs updated to mention enrichment toggles (implementation to follow)

