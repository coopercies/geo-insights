#!/usr/bin/env bash
# Build and publish the app to the self-hosted instance.
#
# Always builds fresh rather than shipping whatever happens to be in dist/,
# so a stale local build can't reach the server.
#
# Usage: ./deploy.sh

set -euo pipefail

# Host and URL come from the environment, deliberately: this repo is public and
# shouldn't carry anyone's server address. Put them in .env.deploy (gitignored).
[ -f .env.deploy ] && . ./.env.deploy

HOST="${GEO_HOST:?set GEO_HOST=user@host (see .env.deploy.example)}"
URL="${GEO_URL:?set GEO_URL=https://your.domain/}"
KEY="${GEO_KEY:-$HOME/.ssh/id_ed25519}"
WEBROOT="${GEO_WEBROOT:-/var/www/geo-insights}"

echo "==> building"
npm run build

echo "==> uploading to $HOST:$WEBROOT"
# tar over ssh: the server image has no rsync.
tar czf - -C dist . | ssh -o BatchMode=yes -i "$KEY" "$HOST" \
  "rm -rf $WEBROOT/assets && tar xzf - -C $WEBROOT"

echo "==> verifying"
code=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
if [ "$code" = "200" ]; then
  echo "    $URL -> $code"
else
  echo "    FAILED: $URL -> $code" >&2
  exit 1
fi
