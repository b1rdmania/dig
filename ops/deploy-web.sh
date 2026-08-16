#!/usr/bin/env bash
# Deploy dig-web to Fly, then purge the Cloudflare edge so the new markup is live.
set -euo pipefail
cd "$(dirname "$0")/.."
GODEBUG=netdns=go fly deploy -c fly.web.toml -a dig-web "$@"
ops/cf-purge.sh
