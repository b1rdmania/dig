# Post-Fix Validation Suite (Search + Entity + Traversal)

Purpose: certify that recent batch-scope and artist-vector fixes are fully stable in production.

Owner: execution agent
Environment: production (`dig-api.fly.dev`, `app.dig.baby`)

## 0. Preconditions

- API deploy with latest fixes is complete.
- Web deploy is complete.
- No ongoing schema migrations.

## 1. P0 API Contract Smoke

Run these exact checks and capture status code + response time.

```bash
curl -sS "https://dig-api.fly.dev/v1/health" -w "\nHTTP:%{http_code} TIME:%{time_total}\n"
curl -sS "https://dig-api.fly.dev/v1/artists/148" -w "\nHTTP:%{http_code} TIME:%{time_total}\n"
curl -sS "https://dig-api.fly.dev/v1/artists/148/masters?limit=10" -w "\nHTTP:%{http_code} TIME:%{time_total}\n"
curl -sS "https://dig-api.fly.dev/v1/artists/148/releases?limit=10" -w "\nHTTP:%{http_code} TIME:%{time_total}\n"
curl -sS "https://dig-api.fly.dev/v1/masters/21004" -w "\nHTTP:%{http_code} TIME:%{time_total}\n"
```

Pass criteria:
- All return `HTTP:200`
- `artists/148/masters` non-empty
- `artists/148/releases` non-empty

## 2. Search Recoverability + Ranking Sanity

Run artist-focused and mixed queries.

```bash
curl -sS "https://dig-api.fly.dev/v1/search?q=James%20Brown&type=artist&limit=3"
curl -sS "https://dig-api.fly.dev/v1/search?q=Prince&type=artist&limit=3"
curl -sS "https://dig-api.fly.dev/v1/search?q=Aretha%20Franklin&type=artist&limit=3"
curl -sS "https://dig-api.fly.dev/v1/search?q=Radiohead&type=artist&limit=3"
curl -sS "https://dig-api.fly.dev/v1/search?q=radiohead&limit=10"
curl -sS "https://dig-api.fly.dev/v1/search?q=radiohead&type=master&limit=3"
curl -sS "https://dig-api.fly.dev/v1/search?q=radiohead&type=release&limit=3"
```

Pass criteria:
- No empty responses for known entities
- Artist query returns expected artist at/near top
- Master/release type queries are non-empty
- API elapsed in response metadata remains within normal envelope

## 3. DB Consistency Snapshot

Run once against production DB and store output in evidence doc.

```sql
SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE search_vector IS NULL) AS null_vectors
FROM catalog.artists;

SELECT b.id, b.dump_date, b.status, b.created_at,
       COUNT(a.*) AS artists,
       COUNT(m.*) AS masters,
       COUNT(r.*) AS releases
FROM ingest.dump_batches b
LEFT JOIN catalog.artists a ON a.batch_id = b.id
LEFT JOIN catalog.masters m ON m.batch_id = b.id
LEFT JOIN catalog.releases r ON r.batch_id = b.id
WHERE b.status IN ('active','qa')
GROUP BY b.id, b.dump_date, b.status, b.created_at
ORDER BY b.created_at DESC;

SELECT batch_id, COUNT(*)
FROM catalog.master_artists
WHERE artist_discogs_id = 148
GROUP BY batch_id
ORDER BY COUNT(*) DESC;
```

Pass criteria:
- `artists.null_vectors = 0`
- Batch distribution explains entity availability (no hidden mismatch)
- Artist 148 has master links in at least one active/qa batch

## 4. Web Clickthrough Sweep (Dead-Page Check)

Manual sweep:
1. On `/`, run 10 queries (mix artist/label/release/common terms).
2. Open top 5 results from each query in new tabs.
3. For release pages, click at least one version.
4. For artist pages, click at least one release.

Target sample size: 50 clickthroughs.

Pass criteria:
- 0 cases where API-returned IDs land on app-level not found page
- No dead-end due to missing traversal data for known populated entities

## 5. Cold vs Warm Release Search Tail

Measure release-only search with cold and warm caches.

Required queries:
- `radiohead`
- `love`
- `house + genre=Electronic + year=1995`

If cold tails still approach timeout, run warmup:

```sql
CREATE EXTENSION IF NOT EXISTS pg_prewarm;
SELECT pg_prewarm('catalog.idx_releases_search'::regclass);
SELECT pg_prewarm('catalog.releases'::regclass);
ANALYZE catalog.releases;
```

Pass criteria:
- Warm query behavior stable and no empty timeout outcomes for common release queries
- Degraded path remains deterministic when timeout guard triggers

## 6. Incident Guardrails (Must Set)

- Keep import boundary rule enforced: app code imports `sql` from `@dig/db`, not `kysely`.
- Add a CI check to block `from "kysely"` imports under `apps/`.
- Ensure `/v1/health` includes timeout stats (already present).

## 7. Evidence Log Template

Create/update one evidence file with this structure:

```md
# Post-Fix Validation Evidence

## Build/Deploy
- API commit:
- Web commit:
- Deploy timestamps:

## API Smoke
- [ ] health 200
- [ ] artists/148 200
- [ ] artists/148/masters non-empty
- [ ] artists/148/releases non-empty
- [ ] masters/21004 200

## Search Checks
- James Brown:
- Prince:
- Aretha Franklin:
- Radiohead:
- radiohead master/release typed queries:

## DB Snapshot
- artists total:
- artists null vectors:
- batch distribution notes:

## Web Sweep
- sample size:
- 404 count:
- notable failures:

## Cold/Warm Notes
- cold behavior:
- warm behavior:
- prewarm run: yes/no

## Verdict
- GO / GO WITH CAVEATS / NO-GO
- follow-up actions:
```

## 8. Final Gate Rule

GO if all are true:
- P0 API contract smoke passes
- Known artist searches pass reliably
- `catalog.artists.search_vector` null count remains zero
- Dead-page sweep returns 0 API-ID clickthrough 404s

GO WITH CAVEATS if:
- only cold-cache release tail remains noisy but warm behavior is stable and degraded fallback is deterministic

NO-GO if:
- any API-ID clickthrough still lands on not found
- typed master/release searches regress to empty
- null vectors reappear materially
