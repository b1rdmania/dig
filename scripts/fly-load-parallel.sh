#!/bin/bash
# Parallel release child table load: Docker PG → Fly PG
# Run AFTER catalog.releases is loaded.
# Loads 4 tables at a time for ~4x throughput.
set -euo pipefail

FLY="postgresql://postgres:4nJry60ZfTjb1NO@localhost:15432/dig"

load_table() {
  local table=$1
  echo "[$(date +%H:%M:%S)] START $table"
  local start_time=$(date +%s)

  docker exec dig-baby-mvp-postgres-1 psql -U dig -d dig -c "COPY $table TO STDOUT" | \
    psql "$FLY" -c "COPY $table FROM STDIN"

  local end_time=$(date +%s)
  local elapsed=$((end_time - start_time))
  local count=$(psql "$FLY" -t -c "SELECT count(*) FROM $table;")
  echo "[$(date +%H:%M:%S)] DONE  $table — $count rows in ${elapsed}s"
}

echo "=== Parallel child table load started at $(date) ==="
echo ""

# Batch 1: 4 smaller tables in parallel
echo "--- Batch 1 (4 tables) ---"
load_table catalog.release_artists &
load_table catalog.release_labels &
load_table catalog.release_formats &
load_table catalog.release_genres &
wait
echo ""

# Batch 2: 4 medium tables in parallel
echo "--- Batch 2 (4 tables) ---"
load_table catalog.release_styles &
load_table catalog.release_identifiers &
load_table catalog.release_companies &
load_table catalog.release_videos &
wait
echo ""

# Batch 3: credits (largest child table, solo for RAM)
echo "--- Batch 3 (credits) ---"
load_table catalog.release_credits
echo ""

# Batch 4: tracks + track_credits (biggest tables, sequential — 254M rows total)
echo "--- Batch 4 (tracks) ---"
load_table catalog.tracks
echo ""

echo "--- Batch 5 (track_credits) ---"
load_table catalog.track_credits
echo ""

echo "=== All child tables loaded at $(date) ==="
echo ""

# Re-enable triggers
echo "--- Re-enabling triggers ---"
TABLES=(
  catalog.releases catalog.release_artists catalog.release_labels
  catalog.release_formats catalog.release_genres catalog.release_styles
  catalog.release_credits catalog.release_identifiers catalog.release_companies
  catalog.release_videos catalog.tracks catalog.track_credits
)
for table in "${TABLES[@]}"; do
  psql "$FLY" -c "ALTER TABLE $table ENABLE TRIGGER ALL;"
done
echo "Triggers re-enabled."

echo ""
echo "--- Final stats ---"
psql "$FLY" -c "
SELECT schemaname || '.' || relname AS table_name, n_live_tup AS rows
FROM pg_stat_user_tables
WHERE schemaname = 'catalog' AND (relname LIKE 'release%' OR relname LIKE 'track%')
ORDER BY n_live_tup DESC;
"
psql "$FLY" -c "SELECT pg_size_pretty(pg_database_size('dig')) AS db_size;"

echo ""
echo "=== Load complete at $(date) ==="
