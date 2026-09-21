#!/usr/bin/env bash
# Reload the Wine Bore corpus on prod after the 2026-09-21 data audit
# (docs/wine-bore-data-audit-2026-09-21.md). Data only: no api deploy, no web
# deploy, persona untouched. This replaces ops/reload-winebore-grapes.sh; the
# grape reload is step 3 here.
#
# Usage:  ops/reload-winebore-data.sh
# Needs:  fly logged in, Docker running (dig-baby-mvp-postgres-1 supplies psql 16),
#         data/wine/raw/ on this machine (the loaders read it).
#
# Tables written, in order:
#   1 load-appellations            wine.appellations (upsert, ids kept), appellation_names, appellation_grapes
#   2 load-gi-lists                wine.appellations + appellation_names for US, AU, NZ, ZA, CL, AR (pinned ids)
#   3 load-grapes                  wine.grapes (pinned ids), grape_names, appellation_grapes.grape_id
#   4 resolve-wine-grapes          wine.wine_grapes.grape_id
#   5 load-appellation-documents   wine.appellation_documents
#   6 resolve-appellations         wine.wines.appellation_id, appellation_names (kind=lwin), synthetic appellations
#   7 producer-merge               wine.wines.producer_id, listings.producer_id, producers.wine_count, producer_links (kind=merged_into)
#   8 search-vectors               search_vector on every wine table
#   9 load-pack                    wine.shelves, shelf_members, shelf_edges (Swartland now points at real WO rows)
set -euo pipefail
cd "$(dirname "$0")/.."
PG=dig-baby-mvp-postgres-1
docker inspect "$PG" >/dev/null 2>&1 || { echo "local postgres container $PG not running (docker compose up -d)"; exit 1; }
[ -f data/wine/raw/lwin/lwin.csv ] || { echo "data/wine/raw is missing; the loaders read it"; exit 1; }

echo "== proxy to dig-db-scene"
pkill -f "fly proxy 15432" || true
GODEBUG=netdns=go fly proxy 15432:5432 -a dig-db-scene >/tmp/wine-proxy.log 2>&1 &
sleep 5
PROD="$(GODEBUG=netdns=go fly ssh console -a dig-api -C 'printenv DATABASE_URL' | tail -1 | tr -d '\r' | sed 's#@dig-db-scene.flycast:5432#@localhost:15432#')"
PROD_DOCKER="${PROD/localhost:15432/host.docker.internal:15432}"
psqlp() { docker exec -i "$PG" psql "$PROD_DOCKER" -Atc "$1"; }
run() { echo "-- $1"; DATABASE_URL="$PROD" pnpm exec tsx "scripts/wine/$1" "${@:2}" | tail -c 600; echo; }

checks() {
  echo "   grapes by colour:      $(psqlp "select string_agg(colour||':'||n, ' ') from (select colour, count(*) n from wine.grapes group by 1 order by 2 desc) t")"
  echo "   grapes with 'Vitis' as a parent: $(psqlp "select count(*) from wine.grapes where parent_varieties::text ilike '%vitis%'")"
  echo "   PDO grape strings resolved: $(psqlp "select count(grape_id)||' of '||count(*) from wine.appellation_grapes")"
  echo "   cahiers (inao):        $(psqlp "select count(*) from wine.appellation_documents where source='inao'")"
  echo "   La Tache has a cahier: $(psqlp "select count(*) from wine.appellation_documents d join wine.appellations a on a.id=d.appellation_id where a.name_norm='la tache'")"
  echo "   Live wines on Etna:    $(psqlp "select count(*) from wine.wines w join wine.appellations a on a.id=w.appellation_id where a.name='Etna' and w.status='Live'")"
  echo "   Argentina resolved:    $(psqlp "select count(appellation_id)||' of '||count(*) from wine.wines where country='AR' and status='Live'")"
  echo "   producers with Live wines: $(psqlp "select count(*) from wine.producers where wine_count>0")"
}

echo "== before"; checks

run load-appellations.ts
run load-gi-lists.ts
run load-grapes.ts
run resolve-wine-grapes.ts
run load-appellation-documents.ts
run resolve-appellations.ts
run producer-merge.ts
run search-vectors.ts
run load-pack.ts
psqlp "ANALYZE wine.appellations; ANALYZE wine.appellation_names; ANALYZE wine.appellation_grapes; ANALYZE wine.appellation_documents; ANALYZE wine.grapes; ANALYZE wine.grape_names; ANALYZE wine.wine_grapes; ANALYZE wine.wines; ANALYZE wine.producers; ANALYZE wine.producer_links; ANALYZE wine.listings"

echo "== after"; checks
# Expected after, from the local run on 2026-09-21:
#   colour unknown 201, 'Vitis' parents 0, 53,628 of 55,971 resolved, 412 cahiers,
#   La Tache 1, Etna 348, Argentina 4,245 of 4,390, 32,540 producers with Live wines.
pkill -f "fly proxy 15432" || true

echo "== smoke"
curl -s https://dig-api.fly.dev/v1/wine/stats; echo
curl -s -o /dev/null -w "winebore page: %{http_code}\n" https://app.dig.baby/winebore
