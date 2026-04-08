#!/usr/bin/env bash
# ANT Knowledge Pipeline sync
# Run periodically to keep mempalace and Obsidian up to date
set -e

echo "[ant-knowledge] Starting sync $(date)"

# Mine new Claude Code sessions into mempalace
python3 -m mempalace mine ~/.claude/projects/ --mode convos 2>/dev/null || true

# Mine ANT codebase (requires mempalace.yaml — skip silently if not set up)
python3 -m mempalace mine ~/CascadeProjects/a-nice-terminal --mode convos 2>/dev/null || true

echo "[ant-knowledge] Sync complete"
