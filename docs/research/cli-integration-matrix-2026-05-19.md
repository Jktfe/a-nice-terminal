# 6-CLI Integration Matrix — header doc

Status: HEADER DOC (skeleton + owners). 2026-05-19.
Author: @evolveantsvelte (header only) — coordinator (@evolveantclaude) to assign matrix-row owners.
Source: JWPK msg_gnv0oeuva2 + msg_6vfgg906l1 (antv4 room).

---

## 0. Why this doc exists, in 30s

OSS users will pick their own CLI; ANT must integrate consistently across all six in JWPK's priority order: **Claude · Codex · pi · Gemini · Copilot · Qwen**. Earlier parity work exists and is load-bearing — JWPK is explicit this must not be lost or rewritten. Also: pi is being run as `-nc` (no-context) because context was overloading local agents — a real-world signal the cross-CLI integration is leaky.

This doc is a CROSS-REFERENCE + DELTA matrix, NOT a from-scratch rewrite. Every cell cites an existing canonical source. We only flag the gaps.

## 1. Canonical sources to anchor on (do NOT recreate)

| Source | Covers |
|---|---|
| [`docs/fingerprint-manifest-design-slice-1-2026-05-15.md`](../fingerprint-manifest-design-slice-1-2026-05-15.md) | ANT-canonical state schema, AgentCli union, state-file path `~/.ant/state/<cli>/<sessionId>.json`, state label vocabulary, per-CLI emitter contract |
| [`src/lib/cli-manifest/manifest.ts`](../../src/lib/cli-manifest/manifest.ts) | 60+ commands keyed by CLI + auth + parity flags + agent-kind discriminators |
| [`src/lib/server/agentStateReader.ts`](../../src/lib/server/agentStateReader.ts) | One reader, six emitters — normalises canonical state file across all 6 CLIs |
| `src/lib/server/{claude,codex,gemini,qwen,copilot,pi}TranscriptTail*.ts` | Per-CLI transcript watchers (booted via globalThis flag; visible in `/api/health` booted flags) |
| [`docs/research/cli-hook-lag-investigation.md`](./cli-hook-lag-investigation.md) | Prior hook lag research |
| [`docs/v4-v3-parity-audit-2026-05-15.md`](../v4-v3-parity-audit-2026-05-15.md) | Prior parity audit |

Lifts the banked memory `project_cli_integration_matrix_directive_2026_05_19` (see ANT memory index).

## 2. The matrix (one row per CLI, six columns)

First-pass field inventory of `~/.{claude,codex,pi,copilot,gemini,qwen}` completed 2026-05-19 — cells cite live disk paths verified by `ls` / `grep` / `head`.

| CLI | Hooks contract | JSON shape | Statusline data | Context-window field + units | Degraded-mode (server down) | Hardcoded-port risk | Status / Owner |
|---|---|---|---|---|---|---|---|
| **Claude** | 8 ant-status hooks at `~/.claude/hooks/ant-status/*.sh`; state files at `~/.claude/state/<sid>.json` | bash stdin (`$(cat)`) JSON; `.session_id`, `.context_window.{used_percentage, remaining_percentage}` | `~/.claude/statusline-command.sh:104` — `used=$(jq -r '.context_window.used_percentage')` | percentage `0..100` (int after `printf '%.0f'`); ANT projector should clamp + write `terminals.context_fill = pct/100` | UNTESTED — banked: `feedback_claude_code_bash_tool_pidchain_break` says `ant register`/`ant chat` fail hard; hook scripts have fallback URL but no graceful skip | **HIGH** — `poll-ant-chat.sh:6` + `ant-board.sh:3` pin `https://<ANT_SERVER_HOST>:6458` with NO env override | TBD → svelte |
| **Codex** | declarative `~/.codex/hooks.json` + same 8 ant-status hooks at `~/.codex/hooks/ant-status/`; built-in statusline driven by TOML `status_line` array (no shell script) | hook payload via env (`HOOK_SECRET`, `HOOK_SERVER_HOST`, `HOOK_SERVER_PORT`); statusline element names (not data) | `~/.codex/config.toml` — `status_line = [ "model-with-reasoning", "current-dir", "model", "run-state" ]` (element-driven, no `context_window` element exposed) | NOT exposed via statusline; would need codex transcript usage extraction OR a custom hook | UNTESTED | **HIGH** — `~/.codex/hooks/poll-ant-chat.sh:9` pins same kingfisher URL | TBD → codex |
| **pi** | TS extension `~/.pi/custom-extensions/status-line.ts` (hooks `session_start \| turn_start \| turn_end`); ALREADY writes ANT-canonical state file at `~/.ant/state/pi/<sessionId>.json` | TS extension API + canonical state schema `{ state, session_start, cwd, pid, last_user_ts, last_resp_ts }`; state enum `Available \| Working \| Waiting` | No native statusline string — `ctx.ui.setStatus` is the UI surface; ANT pulls from the state file | NOT exposed (pi has no context-window telemetry on disk yet) | LIKELY OK — extension is best-effort, must not break pi UI per its own comment | LOW (no scan hit) | TBD → researchant |
| **Gemini** | 9 ant-status hooks at `~/.gemini/hooks/ant-status/*.sh`; Gemini-native lifecycle vocab (`on-before-agent`, `on-after-tool`, `on-session-end`) | TBD — different lifecycle so hook payload shape differs from Claude/Codex | NO top-level statusline script | TBD | UNTESTED | TBD-scan | TBD → bench |
| **Copilot** | **NO `hooks/` folder.** Has `settings.json`, `session-store.db`, `permissions-config.json`. **Largest integration gap.** | TBD — copilot has no ANT integration yet | NO statusline script | NO data path | N/A — no integration to degrade | LOW (no integration to scan) | TBD → bench (bootstrap from scratch) |
| **Qwen** | NO `hooks/` folder. Has its own `~/.qwen/statusline-command.sh` | bash stdin JSON; `.metrics.models.*.api.total_requests`, `.total_errors` | `~/.qwen/statusline-command.sh:4-6` — derives status from request-count parity (coarse: `Working/Complete/Idle/Error/Needs Input`) | NOT exposed (no context-window field in the qwen payload) | LIKELY OK — statusline is self-contained | LOW (no scan hit) | TBD → bench |

**Per-cell discipline:** every cell either cites a verified disk path or is marked `TBD` for the lane owner to chase. Don't paraphrase claims.

### Sharp findings from the first pass

1. **Two CLIs have the SAME 8-script ant-status hook set copy-pasted**: Claude + Codex. Same default-port + hardcoded-URL bugs in both. Single canonical template + per-CLI shim would prevent drift.
2. **pi is the cleanest emitter** — only one writing the ANT-canonical state file directly. The others should match its discipline.
3. **Copilot has NO ANT integration at all**. Either we accept that and remove copilot from the matrix, or someone bootstraps the hook set + statusline + state-file writer.
4. **Qwen's statusline is too coarse** to surface context % — it only counts requests. Needs a separate context-window probe.

## 3. Hardcoded-port audit (commissioned in parallel)

Grep `:6174|:6458|localhost:|127.0.0.1:` across:
- `~/.claude/`, `~/.codex/`, `~/.gemini/`, `~/.qwen/`, `~/.copilot/`, `~/.pi/`
- ANT `src/lib/` skills/tools/MCP configs
- Anything statusline-adjacent

Everything must read from env (`ANT_SERVER_URL` or per-CLI config). Literal ports are anti-pattern. Output: `docs/audits/hardcoded-ports-2026-05-19.md` with file + line + fix.

## 4. Graceful-degradation matrix (commissioned in parallel)

Kill the ANT server, exercise each of the 6 CLIs end-to-end. Document every path that BLOCKS. Banked: `ant register` / `ant chat` currently fail hard when the server is unreachable (`feedback_claude_code_bash_tool_pidchain_break`). Each blockage = one row in the audit + one fix slice.

Goal: server-down NEVER blocks normal CLI use. ANT integration is purely additive.

## 5. Open assignments (coordinator to lock)

- Lane split proposed: Claude → svelte; Codex → codex; pi → researchant; gemini/copilot/qwen → remaining bench (each one section).
- Coordinator (@evolveantclaude) leads + ratifies row claims.
- File the directive as an ANT plan (not internal Claude task list — feedback memory `feedback_coordinator_use_ant_plans_not_internal_tasks`).
- pi `-nc` signal gets its own sub-thread once the matrix is populated (context % visibility, statusline budget warnings, hand-off rules).

---

**Skeleton only. Coordinator: ratify owners + file as plan. Rows go from TBD → cited as each lane delivers.**
