#!/bin/bash
# ANT daemon restart script
# Kills any existing daemon on port 6458, sources .env, and restarts cleanly.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_DIR"

# Pin to nvm Node v22 — native addons compiled for this version
NVM_NODE="$(ls -d "$HOME/.nvm/versions/node/v22"* 2>/dev/null | sort -V | tail -1)"
export PATH="${NVM_NODE:-$HOME/.nvm/versions/node/v22.14.0}/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Kill whatever is on 6458
EXISTING=$(lsof -ti :6458 2>/dev/null || true)
if [ -n "$EXISTING" ]; then
  echo "[restart] Stopping existing daemon (pid $EXISTING)..."
  kill "$EXISTING" 2>/dev/null || true
  sleep 1
fi

# Source .env
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$PROJECT_DIR/.env"
  set +a
fi

TSX_PREFLIGHT="$PROJECT_DIR/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/preflight.cjs"
TSX_LOADER="file://$PROJECT_DIR/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs"

echo "[restart] Starting daemon..."
node \
  --require "$TSX_PREFLIGHT" \
  --import "$TSX_LOADER" \
  "$PROJECT_DIR/packages/daemon/src/index.ts" \
  >> ~/.ant/daemon.log 2>&1 &

DAEMON_PID=$!
echo "[restart] Daemon started (pid $DAEMON_PID)"

# Wait and confirm it's up
sleep 3
if kill -0 "$DAEMON_PID" 2>/dev/null; then
  echo "[restart] Daemon is running. Tailing log (Ctrl+C to stop tailing):"
  tail -f ~/.ant/daemon.log
else
  echo "[restart] Daemon exited — check log:"
  tail -20 ~/.ant/daemon.log
  exit 1
fi
