# ANT shell integration for bash.
[ -z "$ANT_SESSION_ID" ] && return

if [ -n "${__ANT_SHELL_INTEGRATION_LOADED:-}" ]; then
  return
fi
__ANT_SHELL_INTEGRATION_LOADED=1

if [ "${ANT_CAPTURE_DEPTH:-0}" -gt 1 ]; then
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
    if [[ "$ms" =~ ^[0-9]+$ ]]; then
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

__ant_json_str() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  printf '"%s"' "$s"
}

__ant_cmd_start_ms=""
__ant_current_cmd=""

__ant_preexec() {
  __ant_cmd_start_ms="$(__ant_ms)"
  __ant_current_cmd="$1"
  printf '\033]133;B\007'
  printf '\033]133;C\007'
  __ant_emit "{\"event\":\"command_start\",\"session\":\"${ANT_SESSION_ID}\",\"command\":$(__ant_json_str "$1"),\"cwd\":\"${PWD}\",\"ts\":${__ant_cmd_start_ms}}"
}

__ant_precmd() {
  local exit_code=$?
  local end_ms="$(__ant_ms)"

  printf '\033]133;D;%s\007' "$exit_code"

  if [ -n "$__ant_cmd_start_ms" ]; then
    local duration_ms=$(( end_ms - __ant_cmd_start_ms ))
    __ant_emit "{\"event\":\"command_end\",\"session\":\"${ANT_SESSION_ID}\",\"command\":$(__ant_json_str "$__ant_current_cmd"),\"exit_code\":${exit_code},\"cwd\":\"${PWD}\",\"duration_ms\":${duration_ms},\"ts\":${end_ms}}"
    __ant_cmd_start_ms=""
    __ant_current_cmd=""
  fi

  printf '\033]133;A\007'
  printf '\033]7;file://%s%s\007' "$(hostname)" "$PWD"
  printf '\033]1337;CurrentDir=%s\007' "$PWD"
}

if [[ -n "${bash_preexec_imported:-}" ]]; then
  precmd_functions+=(__ant_precmd)
  preexec_functions+=(__ant_preexec)
else
  __ant_original_prompt_command="${PROMPT_COMMAND:-}"

  PROMPT_COMMAND='__ant_precmd'
  if [ -n "$__ant_original_prompt_command" ]; then
    PROMPT_COMMAND="__ant_precmd; ${__ant_original_prompt_command}"
  fi

  __ant_debug_trap() {
    [[ "$BASH_COMMAND" == "__ant_precmd"* ]] && return
    [[ "$BASH_COMMAND" == "${__ant_original_prompt_command}"* ]] && return

    if [ -z "$__ant_cmd_start_ms" ]; then
      __ant_preexec "$BASH_COMMAND"
    fi
  }
  trap '__ant_debug_trap' DEBUG
fi

printf '\033]133;A\007'
