# Gemini CLI — install ANT status hooks

Paste this into Gemini CLI on the host where you want hooks installed.

---

You are setting up ANT status hooks for Gemini CLI. Read
`docs/agent-setup/state-schema.json` and
`docs/agent-setup/hooks/gemini-cli/NOTES.md`.

**Install location**: `~/.gemini/hooks/ant-status/`.

**Install**:

1. `write-state.sh` — same shape as Claude Code template (atomic
   merge-write to both `~/.ant/state/gemini-cli/<id>.json` and
   `~/.gemini/state/<id>.json`).

2. Per-event hook scripts — one per event in the NOTES.md table. Each
   starts with the standard PATH export, reads stdin, calls
   `write-state.sh`.

3. `classify.sh` — wraps `perspective --fm --temperature 0.0` with the
   12-example few-shot prompt and markdown sanitiser. Used by
   `on-turn-end.sh`. Falls back to "Waiting" when perspective is
   missing.

**Then edit `~/.gemini/settings.json`** to register the hooks. Append
to the existing `hooks` object — do not replace:

```json
{
  "hooks": {
    "onStart":          "~/.gemini/hooks/ant-status/on-start.sh",
    "onUserMessage":    "~/.gemini/hooks/ant-status/on-user-message.sh",
    "onToolStart":      "~/.gemini/hooks/ant-status/on-tool-start.sh",
    "onToolEnd":        "~/.gemini/hooks/ant-status/on-tool-end.sh",
    "onTurnEnd":        "~/.gemini/hooks/ant-status/on-turn-end.sh",
    "onIdle":           "~/.gemini/hooks/ant-status/on-idle.sh",
    "onApprovalNeeded": "~/.gemini/hooks/ant-status/on-approval-needed.sh"
  }
}
```

**Verify**: open a new Gemini session, send a prompt, check
`~/.ant/state/gemini-cli/<session_id>.json` for current `state`.

When done, write a one-paragraph status report listing files created
and the Gemini CLI version detected.
