#!/usr/bin/env bash
# Host-side wrapper for the Zapeera live-demo nightly reset.
# Copies the seed/reset script into the running backend container (the
# container is recreated by deploys, so the copy happens on every run)
# and executes it there, where DATABASE_URL + DEMO_* env live.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CID="$(docker ps -qf name=zapeera-backend-1 | head -1)"
if [ -z "$CID" ]; then
  echo "[run-reset] backend container not found" >&2
  exit 1
fi

docker cp "$SCRIPT_DIR/reset-demo.mjs" "$CID:/app/reset-demo.mjs"
docker exec "$CID" node /app/reset-demo.mjs
