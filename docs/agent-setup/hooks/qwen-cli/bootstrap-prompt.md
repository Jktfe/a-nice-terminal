# Qwen CLI — install ANT status hooks

Paste this into Qwen CLI on the host where you want hooks installed.

---

You are setting up ANT status hooks for Qwen Code CLI. Read
`docs/agent-setup/state-schema.json`,
`docs/agent-setup/hooks/qwen-cli/NOTES.md`, and the **Gemini CLI**
template at `docs/agent-setup/hooks/gemini-cli/template.sh` (Qwen
forked from Gemini and shares the hook surface).

**Install location**: `~/.qwen/hooks/ant-status/`.

Follow the Gemini bootstrap prompt verbatim with these substitutions:

- `~/.gemini/` → `~/.qwen/` everywhere
- `gemini-cli` → `qwen-cli` in state-file paths

**One Qwen-specific check**: if your installation reuses
`~/.gemini/settings.json` (some Qwen builds do), install hooks in only
ONE settings file or they'll fire twice per event.

**One Qwen-specific text-extraction**: in `on-turn-end.sh`, fall back
to `.choices[0].message.content` if `.assistantText` is empty (Ollama-
brokered routes use the former).

**Verify**: open a new Qwen session, send a prompt, check
`~/.ant/state/qwen-cli/<session_id>.json`.

When done, write a one-paragraph status report listing files created,
the Qwen build detected, and which settings file you used.
