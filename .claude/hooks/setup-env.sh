#!/bin/bash
# Enable fullscreen rendering for Claude Code sessions in this repo.
# Eliminates flicker in VS Code terminal and tmux, adds mouse support,
# and keeps memory flat in long conversations.

if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export CLAUDE_CODE_NO_FLICKER=1' >> "$CLAUDE_ENV_FILE"
  echo 'export CLAUDE_CODE_SCROLL_SPEED=3' >> "$CLAUDE_ENV_FILE"
fi

exit 0
