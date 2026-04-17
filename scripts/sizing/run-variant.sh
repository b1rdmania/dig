#!/usr/bin/env bash
# Run a single scope-sizing variant in one psql session.
#
# STYLES-FIRST strategy: seeds from catalog.release_styles (uses the
# idx_release_styles_style B-tree for fast indexed lookup per style).
# Genre allowlist is intentionally ignored at seed time — if you add a genre
# that isn't also covered by a style, it won't pull in masters. This matches
# the "scope is styles-first" product direction in the exec summary and keeps
# the sizing queries fast enough to run against the live DB via fly proxy.
#
# Usage:
#   DATABASE_URL=postgres://... BATCH_ID_OVERRIDE=<uuid> \
#     scripts/sizing/run-variant.sh <profile> <year-min> <year-max> <quality 0|1> <style-array> [top-limit]
#
# Example:
#   scripts/sizing/run-variant.sh V1-conservative 1988 2002 0 \
#     '{"Acid House","Acid Techno","Deep House","Detroit Techno","Dub Techno","Garage House","Hard House","Minimal","Minimal Techno","Progressive House","Tech House","Techno","Tribal House"}'
#
# Writes the output to /tmp/scope-reports/<profile>.txt

set -euo pipefail

PROFILE="$1"
YEAR_MIN="$2"
YEAR_MAX="$3"
QUALITY="$4"
STYLES="$5"
TOP_LIMIT="${6:-50}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL required" >&2
  exit 1
fi

if [[ -z "${BATCH_ID_OVERRIDE:-}" ]]; then
  echo "BATCH_ID_OVERRIDE required (UUID of the live batch)" >&2
  exit 1
fi
BATCH_ID="$BATCH_ID_OVERRIDE"

mkdir -p /tmp/scope-reports
OUT="/tmp/scope-reports/${PROFILE}.txt"

{
  echo "[sizing] profile=${PROFILE} batch=${BATCH_ID} years=${YEAR_MIN}-${YEAR_MAX} quality_active_only=${QUALITY}"
  echo "[sizing] styles=${STYLES}"
  echo "[sizing] top_limit=${TOP_LIMIT}"
  echo ""
} | tee "$OUT"

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v profile_name="$PROFILE" \
  -v batch_id="$BATCH_ID" \
  -v year_min="$YEAR_MIN" \
  -v year_max="$YEAR_MAX" \
  -v quality_active_only="$QUALITY" \
  -v styles="$STYLES" \
  -v top_limit="$TOP_LIMIT" \
  <<'SQL' 2>&1 | tee -a "$OUT"

SET statement_timeout = '30min';
SET work_mem = '256MB';

\timing on

CREATE TEMP TABLE tmp_batch AS
SELECT :'batch_id'::uuid AS batch_id;

\echo
\echo '== step 1: matched release ids by style =='
CREATE TEMP TABLE tmp_mr (discogs_id integer PRIMARY KEY);
INSERT INTO tmp_mr
SELECT DISTINCT rs.release_discogs_id
FROM catalog.release_styles rs, tmp_batch b
WHERE rs.batch_id = b.batch_id
  AND rs.style = ANY(:'styles'::text[])
ON CONFLICT DO NOTHING;

\echo
\echo '== step 2: seed releases (year window, uses master fallback) =='
CREATE TEMP TABLE tmp_seed_rel AS
SELECT DISTINCT r.discogs_id
FROM tmp_mr mr
JOIN catalog.releases r
  ON r.discogs_id = mr.discogs_id
  AND r.batch_id = (SELECT batch_id FROM tmp_batch)
LEFT JOIN catalog.masters m
  ON m.discogs_id = r.master_discogs_id
  AND m.batch_id = (SELECT batch_id FROM tmp_batch)
WHERE COALESCE(r.release_year, m.year) BETWEEN :year_min AND :year_max;
CREATE UNIQUE INDEX ON tmp_seed_rel (discogs_id);
ANALYZE tmp_seed_rel;

\echo
\echo '== step 3: raw master set =='
CREATE TEMP TABLE tmp_m_raw AS
SELECT DISTINCT master_discogs_id AS discogs_id
FROM catalog.releases
WHERE batch_id = (SELECT batch_id FROM tmp_batch)
  AND master_discogs_id IS NOT NULL
  AND discogs_id IN (SELECT discogs_id FROM tmp_seed_rel);
CREATE UNIQUE INDEX ON tmp_m_raw (discogs_id);
ANALYZE tmp_m_raw;

\echo
\echo '== step 4: quality-filtered masters =='
CREATE TEMP TABLE tmp_m AS
SELECT mr.discogs_id
FROM tmp_m_raw mr
LEFT JOIN enrich.entity_quality eq
  ON eq.entity_type = 'master' AND eq.discogs_id = mr.discogs_id
WHERE :quality_active_only = 0
   OR eq.quality_status IS NULL
   OR eq.quality_status = 'active';
CREATE UNIQUE INDEX ON tmp_m (discogs_id);
ANALYZE tmp_m;

\echo
\echo '== step 5: raw releases (seeds + all attached to in-scope masters) =='
CREATE TEMP TABLE tmp_r_raw AS
SELECT DISTINCT scoped.discogs_id
FROM (
  SELECT discogs_id FROM tmp_seed_rel
  UNION
  SELECT r.discogs_id
  FROM tmp_m sm
  JOIN catalog.releases r
    ON r.master_discogs_id = sm.discogs_id
    AND r.batch_id = (SELECT batch_id FROM tmp_batch)
) scoped;
CREATE UNIQUE INDEX ON tmp_r_raw (discogs_id);
ANALYZE tmp_r_raw;

\echo
\echo '== step 6: quality-filtered releases =='
CREATE TEMP TABLE tmp_r AS
SELECT rr.discogs_id
FROM tmp_r_raw rr
LEFT JOIN enrich.entity_quality eq
  ON eq.entity_type = 'release' AND eq.discogs_id = rr.discogs_id
WHERE :quality_active_only = 0
   OR eq.quality_status IS NULL
   OR eq.quality_status = 'active';
CREATE UNIQUE INDEX ON tmp_r (discogs_id);
ANALYZE tmp_r;

\echo
\echo '== step 7: artists =='
CREATE TEMP TABLE tmp_a AS
SELECT DISTINCT artist_discogs_id AS discogs_id
FROM catalog.master_artists
WHERE batch_id = (SELECT batch_id FROM tmp_batch)
  AND master_discogs_id IN (SELECT discogs_id FROM tmp_m)
UNION
SELECT DISTINCT artist_discogs_id AS discogs_id
FROM catalog.release_artists
WHERE batch_id = (SELECT batch_id FROM tmp_batch)
  AND release_discogs_id IN (SELECT discogs_id FROM tmp_r);
CREATE UNIQUE INDEX ON tmp_a (discogs_id);
ANALYZE tmp_a;

\echo
\echo '== step 8: labels =='
CREATE TEMP TABLE tmp_l AS
SELECT DISTINCT label_discogs_id AS discogs_id
FROM catalog.release_labels
WHERE batch_id = (SELECT batch_id FROM tmp_batch)
  AND release_discogs_id IN (SELECT discogs_id FROM tmp_r);
CREATE UNIQUE INDEX ON tmp_l (discogs_id);
ANALYZE tmp_l;

\echo
\echo '== step 9: apply quality filter to artists/labels if on =='
DELETE FROM tmp_a
USING enrich.entity_quality eq
WHERE :quality_active_only = 1
  AND eq.entity_type = 'artist'
  AND eq.discogs_id = tmp_a.discogs_id
  AND eq.quality_status <> 'active';

DELETE FROM tmp_l
USING enrich.entity_quality eq
WHERE :quality_active_only = 1
  AND eq.entity_type = 'label'
  AND eq.discogs_id = tmp_l.discogs_id
  AND eq.quality_status <> 'active';

\timing off

\echo
\echo '=== quality_filter_impact ==='
SELECT
  (SELECT COUNT(*) FROM tmp_m_raw)    AS masters_raw,
  (SELECT COUNT(*) FROM tmp_m)        AS masters_filtered,
  (SELECT COUNT(*) FROM tmp_r_raw)    AS releases_raw,
  (SELECT COUNT(*) FROM tmp_r)        AS releases_filtered;

\echo
\echo '=== core_counts ==='
SELECT
  (SELECT COUNT(*) FROM tmp_seed_rel) AS seed_releases,
  (SELECT COUNT(*) FROM tmp_m)        AS masters,
  (SELECT COUNT(*) FROM tmp_r)        AS releases,
  (SELECT COUNT(*) FROM tmp_a)        AS artists,
  (SELECT COUNT(*) FROM tmp_l)        AS labels;

\echo
\echo '=== top_labels ==='
SELECT rl.label_discogs_id, COUNT(*)::int AS releases, rl.label_name
FROM catalog.release_labels rl
WHERE rl.batch_id = (SELECT batch_id FROM tmp_batch)
  AND rl.release_discogs_id IN (SELECT discogs_id FROM tmp_r)
  AND rl.label_discogs_id IN (SELECT discogs_id FROM tmp_l)
GROUP BY rl.label_discogs_id, rl.label_name
ORDER BY releases DESC, rl.label_name ASC
LIMIT :top_limit;

\echo
\echo '=== top_artists ==='
SELECT a.discogs_id AS artist_discogs_id, COUNT(DISTINCT ma.master_discogs_id)::int AS masters, a.name
FROM catalog.master_artists ma
JOIN catalog.artists a
  ON a.discogs_id = ma.artist_discogs_id
  AND a.batch_id = (SELECT batch_id FROM tmp_batch)
WHERE ma.batch_id = (SELECT batch_id FROM tmp_batch)
  AND ma.master_discogs_id IN (SELECT discogs_id FROM tmp_m)
  AND ma.artist_discogs_id IN (SELECT discogs_id FROM tmp_a)
GROUP BY a.discogs_id, a.name
ORDER BY masters DESC, a.name ASC
LIMIT :top_limit;

\echo
\echo '=== year_spread ==='
SELECT r.release_year, COUNT(*)::int AS releases
FROM catalog.releases r
WHERE r.batch_id = (SELECT batch_id FROM tmp_batch)
  AND r.discogs_id IN (SELECT discogs_id FROM tmp_r)
GROUP BY r.release_year
ORDER BY r.release_year ASC NULLS LAST;
SQL

echo ""
echo "[sizing] ${PROFILE} complete. Output: ${OUT}"
