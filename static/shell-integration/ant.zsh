# ANT shell integration for zsh.
[ -z "$ANT_SESSION_ID" ] && return

if [[ -n "${__ANT_SHELL_INTEGRATION_LOADED:-}" ]]; then
  return
fi
typeset -g __ANT_SHELL_INTEGRATION_LOADED=1

if [ "${ANT_CAPTURE_DEPTH:-0}" -gt 1 ]; then
  return
fi

autoload -Uz add-zsh-hook
if ! type add-zsh-hook &>/dev/null; then
  return
fi

__ant_event_dir="${ANT_CAPTURE_DIR:-${HOME}/.local/state/ant/capture}"
__ant_event_file="${__ant_event_dir}/${ANT_SESSION_ID}.events"

__ant_ms() {
  if command -v gdate &>/dev/null; then
    gdate +%s%3N
  else
    local ms
    ms="$(date +%s%3N 2>/dev/null || true)"
    if [[ "$ms" == <-> ]]; then
      echo "$ms"
    else
      echo $(( $(date +%s) * 1000 ))
    fi
  fi
}

__ant_emit() {
  mkdir -p "$__ant_event_dir" 2>/dev/null || true
  echo "$1" >> "$__ant_event_file"
}

typeset -g __ant_cmd_start_ms=""
typeset -g __ant_current_cmd=""

__ant_preexec() {
  __ant_cmd_start_ms="$(__ant_ms)"
  __ant_current_cmd="$1"
  printf '\033]133;B\007'
  printf '\033]133;C\007'
  __ant_emit "{\"event\":\"command_start\",\"session\":\"${ANT_SESSION_ID}\",\"command\":${(qqq)1},\"cwd\":\"${PWD}\",\"ts\":${__ant_cmd_start_ms}}"
}

__ant_precmd() {
  local exit_code=$?
  local end_ms="$(__ant_ms)"

  printf '\033]133;D;%s\007' "$exit_code"

  if [[ -n "$__ant_cmd_start_ms" ]]; then
    local duration_ms=$(( end_ms - __ant_cmd_start_ms ))
    __ant_emit "{\"event\":\"command_end\",\"session\":\"${ANT_SESSION_ID}\",\"command\":${(qqq)__ant_current_cmd},\"exit_code\":${exit_code},\"cwd\":\"${PWD}\",\"duration_ms\":${duration_ms},\"ts\":${end_ms}}"
    __ant_cmd_start_ms=""
    __ant_current_cmd=""
  fi

  printf '\033]133;A\007'
  printf '\033]7;file://%s%s\007' "$(hostname)" "$PWD"
  printf '\033]1337;CurrentDir=%s\007' "$PWD"
}

add-zsh-hook precmd __ant_precmd
add-zsh-hook preexec __ant_preexec

printf '\033]133;A\007'
