# ANT shell integration for zsh
# Sources automatically when ANT_SESSION_ID is set.
#
# Emits OSC 133 prompt markers and posts structured command events
# to antd via the capture event log.

# Guard: only activate if running inside an ANT capture session
[ -z "$ANT_SESSION_ID" ] && return

# Guard: don't double-capture nested shells (e.g. tmux pane spawning a sub-shell)
if [ "${ANT_CAPTURE_DEPTH:-0}" -gt 1 ]; then
  return
fi

# Guard: add-zsh-hook requires zsh >= 4.3.4; bail on ancient versions
if ! type add-zsh-hook &>/dev/null; then
  return
fi

__ant_event_dir="${ANT_CAPTURE_DIR:-${HOME}/.local/state/ant/capture}"
__ant_event_file="${__ant_event_dir}/${ANT_SESSION_ID}.events"

# Timestamp in milliseconds
__ant_ms() {
  if command -v gdate &>/dev/null; then
    gdate +%s%3N
  elif date +%s%3N &>/dev/null 2>&1; then
    date +%s%3N
  else
    echo $(( $(date +%s) * 1000 ))
  fi
}

# Write a JSON event line
__ant_emit() {
  echo "$1" >> "$__ant_event_file"
}

# State
typeset -g __ant_cmd_start_ms=""
typeset -g __ant_current_cmd=""

# --- preexec: fires just before command execution ---
__ant_preexec() {
  __ant_cmd_start_ms="$(__ant_ms)"
  __ant_current_cmd="$1"
  printf '\033]133;C\007'
  __ant_emit "{\"event\":\"command_start\",\"session\":\"${ANT_SESSION_ID}\",\"command\":${(qqq)1},\"cwd\":\"${PWD}\",\"ts\":${__ant_cmd_start_ms}}"
}

# --- precmd: fires just before prompt display ---
__ant_precmd() {
  local exit_code=$?
  local end_ms="$(__ant_ms)"

  printf '\033]133;D;%s\007' "$exit_code"

  if [[ -n "$__ant_cmd_start_ms" ]]; then
    local duration_ms=$(( end_ms - __ant_cmd_start_ms ))
    # Include command in command_end so the ingest can match it to command_start
    __ant_emit "{\"event\":\"command_end\",\"session\":\"${ANT_SESSION_ID}\",\"command\":${(qqq)__ant_current_cmd},\"exit_code\":${exit_code},\"cwd\":\"${PWD}\",\"duration_ms\":${duration_ms},\"ts\":${end_ms}}"
    __ant_cmd_start_ms=""
    __ant_current_cmd=""
  fi

  printf '\033]133;A\007'
  printf '\033]7;file://%s%s\007' "$(hostname)" "$PWD"
}

# --- Install hooks (zsh has native support) ---
autoload -Uz add-zsh-hook
add-zsh-hook precmd __ant_precmd
add-zsh-hook preexec __ant_preexec

# Emit initial prompt marker
printf '\033]133;A\007'
