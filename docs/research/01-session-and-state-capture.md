# Research: Session & State Capture from CLI Tools

## Executive Summary

This document covers the best approaches for a terminal platform to: (1) capture session identifiers from AI coding agents, (2) detect when interactive input is required, and (3) determine active/idle state of processes running inside terminal sessions.

## 1. Capturing Session Identifiers

### Claude Code

**Environment Variables:**
- `CLAUDECODE=1` — the most reliable way to detect "running inside Claude Code"
- `CLAUDE_CODE_ENTRYPOINT=cli` — signals CLI entry
- `CLAUDE_CODE_SESSION_ID` — internal/hidden session identifier, propagated to subprocesses but NOT officially documented (classified as internal). Multiple open issues request making this public (#25642, #13733, #17188, #20132, #27299, #29318, #32500, #34829)
- `CLAUDE_ENV_FILE` — path to a shell script sourced before each Bash command; hooks can write to this

**File System Artifacts (`~/.claude/`):**
- `~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl` — main transcript (JSONL, append-only)
- `~/.claude/projects/<encoded-project-path>/agent-<shortId>.jsonl` — sub-agent transcripts
- `~/.claude/history.jsonl` — cross-session command history (includes session_id per line)
- `~/.claude/session-env/` — per-session environment variable files
- Config moved to `~/.config/claude/projects/` in v1.0.30+

**Best Approach — SessionStart Hook:**
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "/path/to/session-capture.sh"
      }]
    }]
  }
}
```
The hook receives JSON on stdin containing `session_id`, `transcript_path`, and `cwd`. It can write `export CLAUDE_CODE_SESSION_ID="$SESSION_ID"` to `$CLAUDE_ENV_FILE` (persists across Bash tool calls) and return `additionalContext` so the model knows its session ID.

**HTTP Hook Alternative (Best for a Server Platform):**
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "http",
        "url": "http://localhost:3000/api/hooks/session-start",
        "timeout": 5000
      }]
    }]
  }
}
```
This POSTs structured JSON directly to the platform's API — no screen scraping needed.

**Headless/SDK Usage:**
```bash
session_id=$(claude -p "task" --output-format json | jq -r '.session_id')
```

### GitHub Copilot CLI
- Session UUID assigned on creation
- `/session` slash command during interactive use, displayed on exit
- `--resume <id>` for session continuity
- Storage: `~/.copilot/session-state/` (JSON files per session)
- Local SQLite database as session store
- Lifecycle hooks: `sessionStart`, `preToolUse`, `subagentStart`, `preCompact`

### Aider
- No dedicated session ID env var or escape sequences
- Configuration via `AIDER_xxx` env vars or `.aider.conf.yml`
- Session context tracked through git commits and `.aider.chat.history.md` files
- Best approach: process tree introspection + filesystem watching on `.aider*` files

### Cross-Tool Session Discovery
- The `cli-continues` tool discovers sessions across 14 AI coding tools
- Pattern: scan tool-specific state directories (`~/.claude/projects/`, `~/.copilot/session-state/`, etc.)
- `SessionFS` project captures/syncs/resumes AI sessions across tools

### Terminal Escape Sequences for Session Identification

| Sequence | Purpose | Support |
|----------|---------|---------|
| OSC 7 | Current working directory (`\e]7;file://hostname/path\a`) | iTerm2, VTE, WezTerm, foot, Ghostty |
| OSC 133 | Semantic prompts (command lifecycle A/B/C/D) | Ghostty, iTerm2, WezTerm, Kitty |
| OSC 633 | VS Code shell integration (superset of OSC 133 with command text + nonce) | VS Code terminals |
| OSC 1337 | iTerm2 custom user variables (`SetUserVar=name=base64value`) | iTerm2, WezTerm |

## 2. Detecting When Interactive Input Is Required

### Structured Signal Approaches (Preferred)

**Claude Code Hooks — The Best Path:**

26 hook events across the full lifecycle. Key ones for input detection:

| Hook Event | When It Fires | What It Contains |
|------------|---------------|------------------|
| `Notification` with `notification_type: "permission_prompt"` | Permission dialog shown | Tool name, message |
| `Notification` with `notification_type: "idle_prompt"` | Claude waiting for user | Message text |
| `Notification` with `notification_type: "elicitation_dialog"` | MCP server requesting input | Dialog details |
| `PermissionRequest` | Tool needs approval | Full tool name, arguments, permission rule |
| `PreToolUse` (with `permissionDecision: "defer"`) | Pauses execution | Tool details, lets parent handle |

Four handler types: **Command** (shell scripts), **HTTP** (POST to URL), **Prompt** (LLM evaluation), **Agent** (full agent with tools).

Exit code protocol: `0` = success, `2` = block the action, other = non-blocking error.

**OSC 133 State Machine:**
Between `OSC 133;D` (command end) and next `OSC 133;C` (command start), the shell is idle/waiting for input.

### /proc Filesystem Introspection (Universal Fallback)

**Method 1: `/proc/<pid>/wchan`**
```typescript
function isWaitingForInput(pid: number): boolean {
  const wchan = readFileSync(`/proc/${pid}/wchan`, 'utf8').trim();
  return ['n_tty_read', 'wait_woken', 'poll_schedule_timeout',
          'do_select', 'ep_poll'].includes(wchan);
}
```

**Method 2: `/proc/<pid>/syscall`**
If fd 0 (stdin) appears in read/select/poll syscall arguments, process is waiting for input.

**Method 3: `/proc/<pid>/stat` field 3 (state)**
`S` = sleeping (interruptible) — combined with near-zero CPU, strongly suggests waiting for input.

**Method 4: Foreground process group**
Read field 7 of `/proc/<ptyPid>/stat` to get `tpgid` (foreground process group ID).

### State Disambiguation Table

| State | Detection Method | Signals |
|-------|-----------------|---------|
| Shell idle | OSC 133;A received | Prompt displayed, no command running |
| Command running | OSC 133;C received, no D yet | Active output, CPU > 0 |
| Waiting for sub-input | /proc/wchan = `n_tty_read` on foreground PID | No output, process sleeping on tty read |
| Processing (no output) | /proc/stat = `R` or `S` with CPU > 0 | Process active but producing no terminal output |
| Permission prompt | PermissionRequest hook OR screen scraping | Structured hook event or tool-specific patterns |

### Screen Scraping (Least Preferred Fallback)
- Pattern match on PTY output for `"Do you want to proceed"`, `"Allow bash"`, `"(y/n)"`, etc.
- Fragile: output may split across PTY reads, ANSI codes interleaved, locale-dependent
- Use xterm.js headless `registerOscHandler()` instead of regex on raw bytes

## 3. Detecting Active/Idle State

### OSC 133 Shell Integration (Gold Standard)

State machine:
```
IDLE (A) → INPUT (B) → RUNNING (C) → COMPLETED (D;exitcode) → IDLE (A)
```

All major modern terminals use this:
- **Ghostty** (1.3+): Full OSC 133 with `aid` parameter for shell PID tracking. Region-based (more accurate than row-based).
- **Kitty**: Uses `_ksi_state` (0=no marks, 1=C not closed with D, 2=idle). Custom `cmdline=%q` parameter.
- **WezTerm**: Semantic zones (prompt/input/output). Lua API: `pane:get_semantic_zone_at(x,y)`.
- **VS Code**: OSC 633 with command text and anti-spoof nonce.
- **Windows Terminal**: Microsoft's implementation follows the same spec.

### Process Tree Monitoring
- Walk `/proc` from PTY slave PID
- Check `/proc/<pid>/wchan` for kernel wait channel
- Check `/proc/<pid>/stat` for state + CPU times (fields 13-14)
- Poll at 1-2s intervals

### PTY Activity Detection
- Track bytes/second from PTY master read
- Burst followed by silence → command completion
- Steady trickle (<10 bytes/sec) → progress bar or heartbeat
- No activity + process sleeping → idle at prompt

### CPU/IO Monitoring
```typescript
function getCpuUsage(pid: number): { utime: number; stime: number } {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = stat.split(' ');
  return { utime: parseInt(fields[13]), stime: parseInt(fields[14]) };
}
// Sample twice with interval, compute delta. delta > 0 = active.
```

## 4. Recommended Layered Architecture

**Layer 1 (Highest fidelity): Claude Code HTTP Hooks**
- Register hooks for `PermissionRequest`, `PreToolUse`, `PostToolUse`, `SessionStart`, `SessionEnd`, `Stop`, `Notification`
- Eliminates screen scraping entirely
- Provides session_id, tool names, arguments, results as structured JSON

**Layer 2: xterm.js Parser Hooks**
- Use `term.parser.registerOscHandler()` on `@xterm/headless` (not regex)
- OSC 133 for command lifecycle
- OSC 7 for CWD tracking
- OSC 1337 SetUserVar for tool-specific metadata

**Layer 3: /proc Filesystem Introspection**
- Process tree walking, wchan inspection, CPU monitoring
- 1-2s polling interval
- Universal — works for any CLI tool

**Layer 4: Screen Scraping (Fallback)**
- Pattern matching on headless terminal screen content
- Higher latency, more brittle, but works for unknown tools

## Sources
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Session ID Feature Requests](https://github.com/anthropics/claude-code/issues/25642)
- [Claude Code Env Vars Gist](https://gist.github.com/jedisct1/9627644cda1c3929affe9b1ce8eaf714)
- [OSC 133 Semantic Prompts Spec](https://gitlab.freedesktop.org/Per_Bothner/specifications/-/blob/master/proposals/semantic-prompts.md)
- [Ghostty OSC 133](https://deepwiki.com/ghostty-org/ghostty/9.3-osc-133-prompt-marking)
- [Kitty Shell Integration](https://sw.kovidgoyal.net/kitty/shell-integration/)
- [WezTerm Shell Integration](https://wezterm.org/shell-integration.html)
- [VS Code OSC 633](https://github.com/microsoft/vscode/issues/155639)
- [cli-continues](https://github.com/yigitkonur/cli-continues)
