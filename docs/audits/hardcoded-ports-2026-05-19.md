# Hardcoded ports audit — CLI hook scripts (2026-05-19)

Status: FIRST-PASS findings (Claude + Codex hook folders + adjacent CLI configs). 2026-05-19.
Author: @evolveantsvelte. Source: JWPK msg_gnv0oeuva2 directive.
Sibling: `docs/research/cli-integration-matrix-2026-05-19.md`.

---

## 0. What this audit is

Per JWPK: "no skills, tools, hooks, whatever has HARDCODED ports, we should be able to switch them, AND, if the server goes down it should NEVER block their usage". This is the first-pass disk grep across all 6 CLI dot-folders. Each row = a file + line that child-2tes one of those two rules.

## 1. Severity buckets

- **🚨 HIGH** — hardcoded URL with NO env override. Operator cannot redirect; if the URL is down, the hook blocks.
- **⚠️ MEDIUM** — env-overridable BUT the default is stale (e.g. defaults to `:6457` when current ANT is on `:6174`). Silent miss when env not set.
- **🟡 LOW** — env-overridable with a sensible default. Acceptable; flagged only because the audit lists every literal port.

## 2. Findings table

| Severity | File | Line | What it pins | Fix |
|---|---|---|---|---|
| 🚨 HIGH | `~/.claude/hooks/poll-ant-chat.sh` | 6 | `SERVER="https://<ANT_SERVER_HOST>:6458"` | Read from `${ANT_SERVER_URL:-https://<ANT_SERVER_HOST>:6458}` or `~/.ant/config.json` |
| 🚨 HIGH | `~/.claude/hooks/ant-board.sh` | 3 | `SERVER="https://<ANT_SERVER_HOST>:6458"` | Same as above |
| 🚨 HIGH | `~/.codex/hooks/poll-ant-chat.sh` | 9 | `SERVER="https://<ANT_SERVER_HOST>:6458"` | Same as above |
| ⚠️ MEDIUM | `~/.claude/hooks/subagent-start.sh` | 11 | `HOOK_SERVER="http://${HOOK_SERVER_HOST:-127.0.0.1}:${HOOK_SERVER_PORT:-6457}"` — default port `6457` (v3?), current ANT is `:6174` | Switch default to autodetect via `jq -r '.serverUrl' ~/.ant/config.json` or env `ANT_SERVER_URL` |
| ⚠️ MEDIUM | `~/.claude/hooks/subagent-start.sh` | 12 | `HOOK_SERVER_FALLBACK="http://${HOOK_RELAY_HOST:-127.0.0.1}:${HOOK_RELAY_PORT:-6458}"` — fallback default `6458` (v3 prod) | Same as above |
| ⚠️ MEDIUM | `~/.claude/hooks/elicitation-result.sh` | 15 | Same `:6457` default | Same fix |
| ⚠️ MEDIUM | `~/.claude/hooks/subagent-stop.sh` | 11, 12 | Same `:6457` + `:6458` defaults | Same fix |
| ⚠️ MEDIUM | `~/.claude/hooks/elicitation.sh` | 21, 22 | Same | Same |
| ⚠️ MEDIUM | `~/.claude/hooks/post-tool-use.sh` | 14, 15 | Same | Same |
| ⚠️ MEDIUM | `~/.claude/hooks/pre-tool-use.sh` | 19, 20 | Same | Same |
| ⚠️ MEDIUM | `~/.claude/hooks/stop.sh` | 14, 15 | Same | Same |
| ⚠️ MEDIUM | `~/.claude/hooks/notification.sh` | 14, 15 | Same | Same |
| ⚠️ MEDIUM | `~/.codex/hooks/subagent-stop.sh` | 11, 12 | Same `:6457` + `:6458` defaults (copy of Claude's set) | Same fix |
| ⚠️ MEDIUM | `~/.codex/hooks/elicitation.sh` | 21, 22 | Same | Same |
| ⚠️ MEDIUM | `~/.codex/hooks/subagent-start.sh` | 11, 12 | Same | Same |
| ⚠️ MEDIUM | `~/.codex/hooks/elicitation-result.sh` | 15 | Same | Same |

(Likely more in `~/.codex/hooks/{post-tool-use,pre-tool-use,stop,notification}.sh` mirroring Claude's full set — second-pass grep needed to confirm.)

## 3. The deeper pattern

Two CLIs (Claude + Codex) share what's effectively the **same 8-script hook template** copy-pasted across `~/.claude/hooks/` and `~/.codex/hooks/`. Maintaining two copies is a footgun. **Recommendation:** consolidate into a single canonical template + per-CLI thin shims that source it. Then ONE fix to the URL-resolution logic propagates to both.

Pi/Gemini/Copilot/Qwen don't have this template (good — they're not affected by the bug, bad — they need their own integration).

## 4. Graceful-degradation companion

Hardcoded URL = blocks when down. Even env-overridable URLs block if the resolved URL is down + no timeout/skip. Each row above is also a graceful-degradation candidate: the hook should treat any HTTP failure as "skip silently, return success" so the CLI never hangs waiting for ANT.

Banked: `feedback_claude_code_bash_tool_pidchain_break` — `ant register`/`ant chat` already fail hard. Same root cause.

## 5. Recommended fix sequence

1. **Patch the 3 HIGH rows** (poll-ant-chat × 2, ant-board × 1) to read from env-or-config. Single-line `sed` per file. Reversible.
2. **Switch the MEDIUM-row default port** from `:6457` → autodetect from `~/.ant/config.json` (with `:6174` fallback for v4 OSS). Single shared helper sourced by all hooks.
3. **Add a 1s curl timeout + `set -e` removal** to every hook so a slow/dead server doesn't hang the CLI.
4. **Consolidate** the duplicate Claude+Codex template into one canonical source + 2 shims. Quietens the maintenance footprint.

Each fix is a slice; coordinator to assign + ratify. Per JWPK directive, this audit lives next to the matrix doc.
