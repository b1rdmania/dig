#!/usr/bin/env bash
# Purge the Cloudflare edge cache for app.dig.baby.
# Run after every dig-web deploy and after any catalog rebuild — catalog pages
# are cached 30 days at the edge, so without this a deploy is invisible.
# Token: ~/.cloudflare-token (needs Zone · Cache Purge). See docs/cloudflare-edge-plan.md.
set -euo pipefail
ZONE_ID="47b9900195f2fca89889f3ce937f6c64"
TOKEN="${CF_TOKEN:-$(cat "$HOME/.cloudflare-token")}"
curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"purge_everything":true}' | grep -q '"success":true' && echo "cloudflare cache purged" || { echo "purge FAILED" >&2; exit 1; }
