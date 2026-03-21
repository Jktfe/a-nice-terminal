#!/bin/bash
# ANT Bridge launch script — used by launchd to start the Telegram + model bridge

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRIDGE_DIR="$PROJECT_DIR/packages/bridge"

cd "$BRIDGE_DIR" || exit 1

# Source .env if present
if [ -f "$PROJECT_DIR/.env" ]; then
  set -a
  source "$PROJECT_DIR/.env"
  set +a
fi

# Pin to v22 — must match the ANT server's Node version
NVM_NODE="$(ls -d "$HOME/.nvm/versions/node/v22"* 2>/dev/null | sort -V | tail -1)"
export PATH="${NVM_NODE:-$HOME/.nvm/versions/node/v22.14.0}/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"
export NODE_ENV=production

exec node --import tsx src/index.ts
