#!/usr/bin/env bash
# Smoke-test the antchat compiled binary for the current architecture.
#
# Verifies:
#   1. The binary runs without Bun on PATH (bun build --compile bundles
#      the runtime, so a host with only system Node should still boot it).
#   2. --help exits 0 and contains the expected command-list keywords.
#   3. --version prints the current package version.
#
# Designed to be CI-safe: no network, no config writes.
set -euo pipefail

ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) BIN="dist/antchat-darwin-arm64" ;;
  x86_64)        BIN="dist/antchat-darwin-x64" ;;
  *)             echo "smoke: unsupported arch $ARCH" >&2; exit 1 ;;
esac

if [ ! -x "$BIN" ]; then
  echo "smoke: $BIN not found or not executable. Run: bun run build:antchat first." >&2
  exit 1
fi

# Run with PATH stripped of any local bun install. macOS ships /bin and /usr/bin
# only — we keep those so coreutils stay reachable.
SAFE_PATH="/usr/bin:/bin:/usr/sbin:/sbin"

echo "smoke: testing $BIN"

# 1. --help must mention every v0.1.0 command.
HELP_OUTPUT="$(PATH="$SAFE_PATH" "./$BIN" --help)"
for keyword in "join" "rooms" "msg" "chat" "open" "tasks" "plan" "mcp" "watch"; do
  if ! echo "$HELP_OUTPUT" | grep -q "$keyword"; then
    echo "smoke: --help output missing expected keyword '$keyword'" >&2
    echo "$HELP_OUTPUT" >&2
    exit 1
  fi
done
echo "smoke:   --help OK (all 9 commands present)"

# 2. --version must match antchat's package.json version.
VERSION_OUTPUT="$(PATH="$SAFE_PATH" "./$BIN" --version)"
EXPECTED_VERSION="$(grep '"version"' antchat/package.json | head -1 | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
if ! echo "$VERSION_OUTPUT" | grep -q "$EXPECTED_VERSION"; then
  echo "smoke: --version output '$VERSION_OUTPUT' does not contain '$EXPECTED_VERSION'" >&2
  exit 1
fi
echo "smoke:   --version OK ($VERSION_OUTPUT)"

# 3. Unknown command must exit non-zero with a helpful message.
set +e
PATH="$SAFE_PATH" "./$BIN" definitely-not-a-command >/dev/null 2>&1
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  echo "smoke: unknown command should NOT exit 0" >&2
  exit 1
fi
echo "smoke:   unknown-command exit code OK ($RC)"

echo "smoke: PASS"
