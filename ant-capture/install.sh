#!/usr/bin/env bash
# ANT capture hook installer
set -e
HOOK_DIR="$HOME/.ant/hooks"
mkdir -p "$HOOK_DIR"
cp "$(dirname "$0")/ant.zsh" "$HOOK_DIR/ant.zsh"
cp "$(dirname "$0")/ant.bash" "$HOOK_DIR/ant.bash"
cp "$(dirname "$0")/ant-capture" "$HOOK_DIR/ant-capture"
chmod +x "$HOOK_DIR/ant-capture"

if [ -d "$(dirname "$0")/../static/shell-integration" ]; then
  rm -rf "$HOOK_DIR/shell-integration"
  cp -R "$(dirname "$0")/../static/shell-integration" "$HOOK_DIR/shell-integration"
fi

echo "Done. ANT terminal sessions inject shell integration at PTY spawn without modifying user rc files."
