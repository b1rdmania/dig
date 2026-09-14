#!/usr/bin/env bash
# Ship Wine Bore dark: migration 034 on dig-db-scene, restore the wine schema
# from the local dump, deploy api + web, smoke the stats route.
#
# Usage:  ops/deploy-winebore.sh [path-to-dump]
# Needs:  fly logged in, Docker running (the local postgres:16 image supplies
#         pg_restore/psql 16 - Homebrew's are v14 and refuse the v16 dump).
set -euo pipefail
cd "$(dirname "$0")/.."

DUMP="${1:-$HOME/Documents/wine-bore-schema-2026-09-14.dump}"
[ -f "$DUMP" ] || { echo "dump not found: $DUMP"; exit 1; }
PG=dig-baby-mvp-postgres-1
docker inspect "$PG" >/dev/null 2>&1 || { echo "local postgres container $PG not running (docker compose up -d)"; exit 1; }

echo "== proxy to dig-db-scene"
pkill -f "fly proxy 15432" || true
GODEBUG=netdns=go fly proxy 15432:5432 -a dig-db-scene >/tmp/wine-proxy.log 2>&1 &
sleep 5

PROD="$(fly ssh console -a dig-api -C 'printenv DATABASE_URL' | tail -1 | tr -d '\r' | sed 's#@dig-db-scene.flycast:5432#@localhost:15432#')"
PROD_DOCKER="${PROD/localhost:15432/host.docker.internal:15432}"
psqlp() { docker exec -i "$PG" psql "$PROD_DOCKER" -Atc "$1"; }

echo "== before: $(psqlp 'select name from kysely_migration order by name desc limit 1') / wine schema present: $(psqlp "select exists(select 1 from information_schema.schemata where schema_name='wine')")"

echo "== migrate (034 is additive: creates schema wine, empty)"
DATABASE_URL="$PROD" pnpm --filter @dig/db migrate:up

if [ "$(psqlp 'select count(*) from wine.wines')" != "0" ]; then
  echo "wine.wines already has rows on prod - refusing to restore over it. Truncate deliberately if you mean it."; exit 1
fi

echo "== restore data (47 MB dump, a few minutes over the proxy)"
docker exec -i "$PG" pg_restore -d "$PROD_DOCKER" --data-only -n wine --no-owner < "$DUMP"
psqlp "ANALYZE wine.wines; ANALYZE wine.producers; ANALYZE wine.appellations; ANALYZE wine.appellation_names; ANALYZE wine.appellation_documents; ANALYZE wine.grapes; ANALYZE wine.listings"
echo "== after: wines=$(psqlp "select count(*) from wine.wines where status='Live'") appellations=$(psqlp 'select count(*) from wine.appellations') shelves=$(psqlp 'select count(*) from wine.shelves')"

echo "== deploy api"
GODEBUG=netdns=go fly deploy --config fly.api.toml --remote-only
echo "== deploy web (+ Cloudflare purge)"
ops/deploy-web.sh

echo "== smoke"
curl -s https://dig-api.fly.dev/v1/wine/stats; echo
curl -s https://dig-api.fly.dev/v1/wine/opener; echo
curl -s -o /dev/null -w "winebore page: %{http_code}\n" https://app.dig.baby/winebore
pkill -f "fly proxy 15432" || true
echo "done - page is dark at https://app.dig.baby/winebore"
