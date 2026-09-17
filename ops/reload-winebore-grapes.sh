#!/usr/bin/env bash
# Reload wine.grapes on prod (VIVC berry colour now wins over Wikidata), re-resolve
# wine_grapes, then redeploy the api so the persona edit ships. Web untouched.
#
# Usage:  ops/reload-winebore-grapes.sh
# Needs:  fly logged in, Docker running (dig-baby-mvp-postgres-1 supplies psql 16).
set -euo pipefail
cd "$(dirname "$0")/.."
PG=dig-baby-mvp-postgres-1
docker inspect "$PG" >/dev/null 2>&1 || { echo "local postgres container $PG not running (docker compose up -d)"; exit 1; }

echo "== proxy to dig-db-scene"
pkill -f "fly proxy 15432" || true
GODEBUG=netdns=go fly proxy 15432:5432 -a dig-db-scene >/tmp/wine-proxy.log 2>&1 &
sleep 5
PROD="$(GODEBUG=netdns=go fly ssh console -a dig-api -C 'printenv DATABASE_URL' | tail -1 | tr -d '\r' | sed 's#@dig-db-scene.flycast:5432#@localhost:15432#')"
PROD_DOCKER="${PROD/localhost:15432/host.docker.internal:15432}"
psqlp() { docker exec -i "$PG" psql "$PROD_DOCKER" -Atc "$1"; }

echo "== before: $(psqlp "select name||'='||colour from wine.grapes where name_norm='xarel lo'")"
DATABASE_URL="$PROD" pnpm exec tsx scripts/wine/load-grapes.ts | head -c 400; echo
DATABASE_URL="$PROD" pnpm exec tsx scripts/wine/resolve-wine-grapes.ts | head -c 200; echo
psqlp "ANALYZE wine.grapes; ANALYZE wine.grape_names; ANALYZE wine.appellation_grapes; ANALYZE wine.wine_grapes"
echo "== after: $(psqlp "select name||'='||colour from wine.grapes where name_norm='xarel lo'") / colours: $(psqlp "select string_agg(colour||':'||n, ' ') from (select colour, count(*) n from wine.grapes group by 1 order by 2 desc) t")"
pkill -f "fly proxy 15432" || true

echo "== deploy api (persona)"
GODEBUG=netdns=go fly deploy --config fly.api.toml --remote-only

echo "== smoke"
curl -s https://dig-api.fly.dev/v1/wine/stats; echo
curl -s -o /dev/null -w "winebore page: %{http_code}\n" https://app.dig.baby/winebore
