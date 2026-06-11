#!/bin/bash
# Full release dataset load: Docker PG → Fly PG
# Run: bash scripts/fly-load-releases.sh
# Requires: Docker PG on :5433, fly proxy on :15432

set -euo pipefail

LOCAL="postgresql://dig:dig_local@localhost:5433/dig"
FLY="${FLY_DATABASE_URL:?Set FLY_DATABASE_URL (postgresql://user:pass@localhost:15432/dig via fly proxy)}"

TABLES=(
  catalog.releases
  catalog.release_artists
  catalog.release_labels
  catalog.release_formats
  catalog.release_genres
  catalog.release_styles
  catalog.release_credits
  catalog.release_identifiers
  catalog.release_companies
  catalog.release_videos
  catalog.tracks
  catalog.track_credits
)

echo "=== Full release load started at $(date) ==="
echo ""

for table in "${TABLES[@]}"; do
  echo "--- Loading $table at $(date) ---"
  start_time=$(date +%s)

  docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c "COPY $table TO STDOUT" | \
    psql "$FLY" -c "COPY $table FROM STDIN"

  end_time=$(date +%s)
  elapsed=$((end_time - start_time))
  count=$(psql "$FLY" -t -c "SELECT count(*) FROM $table;")
  echo "  Done: $count rows in ${elapsed}s"
  echo ""
done

echo "=== All tables loaded at $(date) ==="
echo ""

# Re-enable triggers
echo "--- Re-enabling triggers ---"
for table in "${TABLES[@]}"; do
  psql "$FLY" -c "ALTER TABLE $table ENABLE TRIGGER ALL;"
done
echo "Triggers re-enabled."
echo ""

# FTS search_vector population for releases
echo "--- Populating FTS search_vectors for releases ---"
psql "$FLY" -c "
UPDATE catalog.releases SET search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(notes, '')), 'D')
WHERE search_vector IS NULL;
"
echo "FTS done at $(date)"

echo ""
echo "=== Load complete at $(date) ==="

# Final disk check
echo ""
echo "--- Disk usage ---"
psql "$FLY" -c "SELECT pg_size_pretty(pg_database_size('dig')) AS db_size;"
