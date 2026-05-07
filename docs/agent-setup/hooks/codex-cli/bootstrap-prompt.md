# Codex CLI — install ANT status hooks

Paste this prompt into Codex CLI on the host where you want the hooks
installed.

---

You are setting up the ANT status hooks for OpenAI Codex CLI on this
machine. Read the canonical schema at
`docs/agent-setup/state-schema.json` and the per-CLI notes at
`docs/agent-setup/hooks/codex-cli/NOTES.md`.

**Install location**: `~/.codex/hooks/ant-status/` (create if missing).

**Install three things**:

1. A shared `write-state.sh` that takes `<session_id>` and a `jq` merge
   expression, writes to BOTH paths so both unified and legacy
   consumers work:
   - `$HOME/.ant/state/codex-cli/<session_id>.json`
   - `$HOME/.codex/state/<session_id>.json`
   Use atomic write via `mktemp` + `mv`.

2. Per-event hook scripts mapping Codex events → state writes per the
   table in `NOTES.md`. Top of every script:
   - `#!/bin/bash`
   - `set -u`
   - `export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"`

3. A turn-end classifier `classify.sh` that wraps `perspective --fm
   --temperature 0.0` with the same 12-example system prompt and
   markdown sanitiser as the Claude Code template. Used by the
   `turn_end` hook to set `Response needed` vs `Waiting`.

**Then edit `~/.codex/config.toml`** to register the hooks:

```toml
[hooks]
session_start = "~/.codex/hooks/ant-status/on-session-start.sh"
prompt_submit = "~/.codex/hooks/ant-status/on-prompt-submit.sh"
pre_tool      = "~/.codex/hooks/ant-status/on-pre-tool.sh"
post_tool     = "~/.codex/hooks/ant-status/on-post-tool.sh"
turn_end      = "~/.codex/hooks/ant-status/on-turn-end.sh"
idle          = "~/.codex/hooks/ant-status/on-idle.sh"
```

**Verify** by running a Codex session, sending a prompt, and checking
that `~/.ant/state/codex-cli/<session_id>.json` contains a current
`state` field. Also tail any forensic log you set up.

**Three known gotchas**:

1. **PATH export** at the top of every script (homebrew binaries).
2. **Codex TOML hook keys differ across versions.** If `prompt_submit`
   isn't recognised, check `codex --print-config` for the current
   key names and adjust accordingly.
3. **No structured menu equivalent** — Codex's multi-choice prompts
   come through as text. The driver detects them; hooks don't.

When done, write a one-paragraph status report listing files created,
the Codex version detected, and any hook keys that didn't match the
canonical names above.
