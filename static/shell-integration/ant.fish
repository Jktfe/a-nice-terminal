# ANT shell integration for fish.
if test -z "$ANT_SESSION_ID"
  return
end

if set -q __ANT_SHELL_INTEGRATION_LOADED
  return
end
set -g __ANT_SHELL_INTEGRATION_LOADED 1

set -l __ant_depth 0
if set -q ANT_CAPTURE_DEPTH
  set __ant_depth $ANT_CAPTURE_DEPTH
end
if test "$__ant_depth" -gt 1
  return
end

set -g __ant_event_dir (set -q ANT_CAPTURE_DIR; and echo $ANT_CAPTURE_DIR; or echo "$HOME/.local/state/ant/capture")
set -g __ant_event_file "$__ant_event_dir/$ANT_SESSION_ID.events"
set -g __ant_cmd_start_ms ""
set -g __ant_current_cmd ""

function __ant_ms
  if command -q gdate
    gdate +%s%3N
  else
    set -l ms (date +%s%3N 2>/dev/null)
    if string match -qr '^[0-9]+$' -- "$ms"
      echo "$ms"
    else
      math (date +%s) \* 1000
    end
  end
end

function __ant_json_str
  string escape --style=json -- "$argv"
end

function __ant_emit
  mkdir -p "$__ant_event_dir" 2>/dev/null
  echo "$argv" >> "$__ant_event_file"
end

function __ant_preexec --on-event fish_preexec
  set -g __ant_cmd_start_ms (__ant_ms)
  set -g __ant_current_cmd "$argv"
  printf '\033]133;B\007'
  printf '\033]133;C\007'
  __ant_emit "{\"event\":\"command_start\",\"session\":\"$ANT_SESSION_ID\",\"command\":$(__ant_json_str "$argv"),\"cwd\":\"$PWD\",\"ts\":$__ant_cmd_start_ms}"
end

function __ant_postexec --on-event fish_postexec
  set -l exit_code $status
  set -l end_ms (__ant_ms)
  printf '\033]133;D;%s\007' "$exit_code"

  if test -n "$__ant_cmd_start_ms"
    set -l duration_ms (math $end_ms - $__ant_cmd_start_ms)
    __ant_emit "{\"event\":\"command_end\",\"session\":\"$ANT_SESSION_ID\",\"command\":$(__ant_json_str "$__ant_current_cmd"),\"exit_code\":$exit_code,\"cwd\":\"$PWD\",\"duration_ms\":$duration_ms,\"ts\":$end_ms}"
    set -g __ant_cmd_start_ms ""
    set -g __ant_current_cmd ""
  end

  printf '\033]133;A\007'
  printf '\033]7;file://%s%s\007' (hostname) "$PWD"
  printf '\033]1337;CurrentDir=%s\007' "$PWD"
end

printf '\033]133;A\007'
