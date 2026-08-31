#!/usr/bin/env bash
# Purge the Cloudflare edge cache for app.dig.baby.
#
# Default: purge only the shell pages (home, faq, etc). Entity pages stay
# warm — the catalog is frozen, a web deploy doesn't change them, and a full
# purge dumps ~80k cold pages onto origin at once (self-DoS during the
# 2026-08-31 crawl incident).
#
#   ops/cf-purge.sh          shell pages only (the deploy default)
#   ops/cf-purge.sh --all    everything — needed after a catalog rebuild or
#                            any change to entity-page markup/layout
#
# Token: ~/.cloudflare-token (needs Zone · Cache Purge). See docs/cloudflare-edge-plan.md.
set -euo pipefail
ZONE_ID="47b9900195f2fca89889f3ce937f6c64"
TOKEN="${CF_TOKEN:-$(cat "$HOME/.cloudflare-token")}"

if [[ "${1:-}" == "--all" ]]; then
  PAYLOAD='{"purge_everything":true}'
  LABEL="cloudflare cache purged (EVERYTHING)"
else
  # Only pages the edge actually caches (cache rule 2) need purging; free-plan
  # purge is by exact URL, prefix purge is Enterprise-only.
  PAYLOAD='{"files":[
    "https://app.dig.baby/",
    "https://app.dig.baby/about",
    "https://app.dig.baby/faq",
    "https://app.dig.baby/pilot",
    "https://app.dig.baby/progress",
    "https://app.dig.baby/robots.txt"
  ]}'
  LABEL="cloudflare cache purged (shell pages; use --all after entity-page changes)"
fi

curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$PAYLOAD" | grep -q '"success":true' && echo "$LABEL" || { echo "purge FAILED" >&2; exit 1; }
