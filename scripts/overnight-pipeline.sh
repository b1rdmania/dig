#!/bin/bash
# Overnight pipeline: wait for releases ingest, then run all transforms + QA
# Started: $(date)
set -e

export DATABASE_URL=postgresql://dig:dig_local@localhost:5433/dig
BATCH_ID=e0050fc3-6176-491a-8d78-0fc02a6464f7
cd "/Users/andy/Documents/New project/dig-baby-mvp"

LOG="/Users/andy/Documents/New project/dig-baby-mvp/scripts/overnight.log"
echo "=== Overnight pipeline started at $(date) ===" | tee "$LOG"

# Step 1: Wait for releases ingest to finish
echo "[$(date)] Waiting for releases ingest to complete..." | tee -a "$LOG"
while pgrep -f "cli.ts.*releases" > /dev/null 2>&1; do
  sleep 60
done
echo "[$(date)] Releases ingest finished." | tee -a "$LOG"

# Verify raw counts
psql "$DATABASE_URL" -c "SELECT entity_type, COUNT(*) FROM ingest.raw_entities GROUP BY entity_type ORDER BY entity_type;" 2>&1 | tee -a "$LOG"

# Step 2: Labels transform
echo "[$(date)] Starting labels transform..." | tee -a "$LOG"
pnpm --filter @dig/ingest transform -- --batch-id "$BATCH_ID" --type labels --page-size 2000 2>&1 | tee -a "$LOG"
echo "[$(date)] Labels transform done." | tee -a "$LOG"

# Step 3: Masters transform
echo "[$(date)] Starting masters transform..." | tee -a "$LOG"
pnpm --filter @dig/ingest transform -- --batch-id "$BATCH_ID" --type masters --page-size 2000 2>&1 | tee -a "$LOG"
echo "[$(date)] Masters transform done." | tee -a "$LOG"

# Step 4: Releases transform (smaller page size due to 11 child tables)
echo "[$(date)] Starting releases transform..." | tee -a "$LOG"
pnpm --filter @dig/ingest transform -- --batch-id "$BATCH_ID" --type releases --page-size 500 2>&1 | tee -a "$LOG"
echo "[$(date)] Releases transform done." | tee -a "$LOG"

# Step 5: QA report
echo "[$(date)] Running QA report..." | tee -a "$LOG"
pnpm --filter @dig/ingest qa -- --batch-id "$BATCH_ID" 2>&1 | tee -a "$LOG"

# Final catalog counts
echo "[$(date)] Final catalog table counts:" | tee -a "$LOG"
psql "$DATABASE_URL" -c "SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='catalog' AND n_live_tup > 0 ORDER BY relname;" 2>&1 | tee -a "$LOG"

echo "=== Overnight pipeline completed at $(date) ===" | tee -a "$LOG"
