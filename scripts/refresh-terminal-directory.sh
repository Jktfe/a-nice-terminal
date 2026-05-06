#!/bin/bash
# Regenerates the Open-Terminals directory note in the ObsidiANT vault.
# Cross-references live tmux sessions against the ANT sessions table so
# zombies (tmux ids without a DB row) are surfaced for cleanup.
set -euo pipefail
export PATH="/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:$PATH"

VAULT="${ANT_OBSIDIAN_VAULT:-$HOME/CascadeProjects/ObsidiANT}"
DB="${ANT_DB:-$HOME/.ant-v3/ant.db}"
NOTE="$VAULT/Terminals.md"

[ -d "$VAULT" ] || { echo "vault not found: $VAULT" >&2; exit 1; }
[ -f "$DB" ] || { echo "db not found: $DB" >&2; exit 1; }

NOW=$(date '+%Y-%m-%d %H:%M:%S %Z')
NOW_ISO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
HOST_LOCAL=$(scutil --get LocalHostName 2>/dev/null || hostname)
HOST_TS="${ANT_HOST_TAILSCALE:-mac.kingfisher-interval.ts.net}"
SSH_USER="${ANT_SSH_USER:-$USER}"
SSH_HOST="${ANT_SSH_HOST:-mac}"

ANT_TMP=$(mktemp)
trap 'rm -f "$ANT_TMP"' EXIT
sqlite3 "$DB" \
  "SELECT id || '|' || COALESCE(name,'') || '|' || COALESCE(handle,'') FROM sessions WHERE type='terminal' AND status NOT IN ('archived','deleted','closed');" > "$ANT_TMP"

lookup_ant() { grep "^$1|" "$ANT_TMP" | head -1; }

TMUX_DUMP=$(tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}' 2>/dev/null || true)

LIVE_ROWS=""
ORPHAN_ROWS=""
if [ -n "$TMUX_DUMP" ]; then
  while IFS='|' read -r sid created attached windows; do
    [ -z "$sid" ] && continue
    created_iso=$(date -r "$created" '+%Y-%m-%d %H:%M' 2>/dev/null || echo "?")
    pane_info=$(tmux list-panes -t "$sid" -F '#{pane_current_command}|#{pane_current_path}' 2>/dev/null | head -1)
    cmd="${pane_info%%|*}"
    cwd="${pane_info#*|}"
    short_id="${sid:0:12}"
    attach_local="tmux attach -t $sid"
    ant_row=$(lookup_ant "$sid" || true)
    if [ -n "$ant_row" ]; then
      rest="${ant_row#*|}"
      name="${rest%%|*}"
      handle="${rest#*|}"
      LIVE_ROWS+="| ${name:-—} | ${handle:-—} | \`$short_id…\` | $created_iso | $attached | \`$cwd\` | \`$cmd\` | \`$attach_local\` |"$'\n'
    else
      ORPHAN_ROWS+="| \`$short_id…\` | $created_iso | $attached | \`$cwd\` | \`$cmd\` | \`tmux kill-session -t $sid\` |"$'\n'
    fi
  done <<< "$TMUX_DUMP"
fi

WHO_ROWS=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  WHO_ROWS+="- \`$line\`"$'\n'
done <<< "$(who | head -20)"

cat > "$NOTE" <<MD
---
type: terminal-directory
generated_at: $NOW_ISO
host_local: $HOST_LOCAL
host_tailscale: $HOST_TS
maintainer: ant-server (auto)
---

# Open Terminals

> Last updated: **$NOW**
> Host (LAN): \`$HOST_LOCAL\` · Host (Tailscale): \`$HOST_TS\`

## Live ANT terminals (cross-referenced with \`sessions\` table)

| Name | Handle | Tmux ID | Opened | Clients | Cwd | Cmd | Attach (local) |
|---|---|---|---|---:|---|---|---|
$LIVE_ROWS

**Remote attach** (any of the above): \`ssh $SSH_USER@$SSH_HOST -t tmux attach-session -t <full-tmux-id>\`

## Orphan tmux sessions (no DB row in \`sessions\`)

Leftover from earlier test runs or crashed spawns. Not tracked by ANT — kill commands listed for hand-cleanup. The server-side reaper (planned) will drop these on next boot.

| Tmux ID | Opened | Clients | Cwd | Cmd | Kill |
|---|---|---:|---|---|---|
$ORPHAN_ROWS

## Active SSH/console clients (\`who\`)

$WHO_ROWS

## Usage

- Regenerate: \`scripts/refresh-terminal-directory.sh\`
- Local attach: \`tmux attach -t <full-id>\` from a shell on \`$HOST_LOCAL\`.
- Remote attach: \`ssh $SSH_USER@$SSH_HOST -t tmux attach-session -t <full-id>\`.
- List remotely: \`ssh $SSH_USER@$SSH_HOST tmux list-sessions\`.
MD

echo "wrote $NOTE"
