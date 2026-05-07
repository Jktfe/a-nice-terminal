# Claude Code — install ANT status hooks

Paste this prompt into Claude Code on the host where you want the hooks
installed. Claude will read the template, install the scripts in your
own user-config dir (`~/.claude/hooks/ant-status/`), and wire them into
`~/.claude/settings.json`. The state file populates immediately on the
next session.

---

You are setting up the ANT status hooks for Claude Code on this machine.
Read the canonical template at
`docs/agent-setup/hooks/claude-code/template.sh` and the schema at
`docs/agent-setup/state-schema.json`.

**Install location**: `~/.claude/hooks/ant-status/` (create if missing).

**What to install**:

1. Create executable scripts in that directory matching each function in
   the template — `write-state.sh`, `on-session-start.sh`,
   `on-prompt-submit.sh`, `on-pre-tool-use.sh`, `on-post-tool-use.sh`,
   `on-stop.sh`, `on-notification.sh`. Each script:
   - Begins with `#!/bin/bash`, `set -u`, and `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"`.
   - Reads the hook stdin payload, calls `write-state.sh` with the right
     merge expression, exits 0.
   - Logs one line per invocation to
     `$HOME/.claude/state/ant-status.log` for forensics (timestamped,
     prefixed with `[<event>:<session_prefix>]`).

2. Also install:
   - `classify.sh` — wraps `perspective --fm --temperature 0.0` with the
     12-example few-shot system prompt from
     `~/.claude/hooks/ant-status/classify.sh` (canonical reference) and
     the markdown sanitiser. Falls back to "Waiting" when `perspective`
     is missing. **Critical**: pass `--temperature 0.0` to make the
     classifier deterministic.
   - `statusline-command.sh` — reads
     `$HOME/.ant/state/claude-code/$session_id.json` (or legacy
     `$HOME/.claude/state/$session_id.json`) and renders the corner.

3. Edit `~/.claude/settings.json`:
   - Add `"statusLine": { "type": "command", "command": "bash ~/.claude/statusline-command.sh", "refreshInterval": 1 }`.
     **`refreshInterval: 1` is required** — without it the corner won't
     update until the next keystroke (event-driven refresh only).
   - **Append** (do NOT replace) entries to `.hooks.SessionStart`,
     `.hooks.UserPromptSubmit`, `.hooks.PreToolUse`, `.hooks.PostToolUse`,
     `.hooks.Stop`, `.hooks.Notification`. Other hooks may already be
     present (e.g. ANT chat routing) — preserve them all by using
     `jq '.hooks.<event> += [...]'` rather than `=`.

**Verify** by:

1. Run `cat ~/.claude/state/<any-session-id>.json` after a turn — it
   should contain `state` field plus timestamps.
2. Open a fresh Claude Code session, send a message, watch the bottom
   corner change `Working → Waiting` within ~1 second of the response
   ending.

**Three known gotchas — confirm each is handled**:

1. **PATH** — every hook script must `export PATH=...` because Claude
   Code spawns hooks with a stripped env on macOS (jq + perspective from
   /opt/homebrew/bin are otherwise invisible).
2. **refreshInterval** — must be `1` in statusLine config.
3. **Markdown sanitisation** — `classify.sh` strips `**bold**`, backticks,
   `[links](...)`, bullet markers, numbered list markers, table rows
   (lines starting with `|`), and unicode arrows before sending to
   `perspective`. Without sanitisation, small models flip on edge cases.

When done, write a one-paragraph status report listing the files created
and any deviations from the template (e.g. if you used a different
state-dir path because `~/.ant/state/claude-code/` couldn't be created).
