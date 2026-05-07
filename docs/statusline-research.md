# Detecting Claude Code's `AskUserQuestion` From the Outside: Schema, Markers, and Status‑Line Strategies

This report consolidates everything publicly documented about `AskUserQuestion` in Claude Code (the CLI shipped as `@anthropic-ai/claude-code`) that is relevant to building external monitoring/tooling. It is based on the official docs at `code.claude.com` / `platform.claude.com`, the public `anthropics/claude-code` issue tracker, and the system‑prompt mirror published by Piebald‑AI on GitHub. No leaked source is used.

---

## 1. The `tool_use` JSON schema

`AskUserQuestion` is a built‑in Anthropic tool (introduced in Claude Code v2.0.21, per release notes mirrored on ClaudeLog) that the model emits as a normal Anthropic Messages API `tool_use` content block with `"name": "AskUserQuestion"`. The `input` object follows a fixed shape that is documented under the Agent SDK "Handle approvals and user input" page (`code.claude.com/docs/en/agent-sdk/user-input`, "Question format" section).

### 1.1 Top‑level input shape

```json
{
  "questions": [
    {
      "question": "How should I format the output?",
      "header": "Format",
      "options": [
        { "label": "Summary",  "description": "Brief overview of key points" },
        { "label": "Detailed", "description": "Full explanation with examples" }
      ],
      "multiSelect": false
    }
  ]
}
```

### 1.2 Field reference (from the official docs)

| Field | Type | Notes |
|---|---|---|
| `questions` | array of question objects | 1–4 questions per call (documented limit) |
| `questions[].question` | string | Full question text shown to user |
| `questions[].header` | string | Short label, **max 12 characters**, used as a tab/section header in the TUI |
| `questions[].options` | array of option objects | **2–4 options** per question |
| `questions[].options[].label` | string | The choice's short text. Returned as the answer value when selected |
| `questions[].options[].description` | string | Longer descriptive text shown beneath the label |
| `questions[].options[].preview` | string \| undefined | **TypeScript SDK only**, present only when the host app sets `toolConfig.askUserQuestion.previewFormat: "markdown" \| "html"`. Carries an ASCII/markdown block or a sanitized `<div>` HTML fragment. The SDK strips `<script>`, `<style>`, and `<!DOCTYPE>` before delivery |
| `questions[].multiSelect` | boolean | If `true`, multiple options may be returned |

### 1.3 Tool description (model side)

The system prompt that Claude sees for the tool, mirrored from `Piebald-AI/claude-code-system-prompts/system-prompts/tool-description-askuserquestion.md`, says:

> Use this tool when you need to ask the user questions during execution. … Users will always be able to select "Other" to provide custom text input. Use `multiSelect: true` to allow multiple answers… If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.
>
> Plan‑mode note: In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?" — use `${EXIT_PLAN_MODE_TOOL_NAME}` for plan approval.

The implication is that "Other / free text" is rendered by the host CLI, not represented in the input schema. The label `"(Recommended)"` is by convention an in‑band suffix on `label`, not a separate field. The tool docs also state there is no `id`/`questionId` field — the question text itself is used as the lookup key when the host returns answers.

### 1.4 Response shape (host → Claude)

When the host (Claude Code itself, or an SDK app via `canUseTool`) returns the answer, it returns `updatedInput` containing the original `questions` array plus an `answers` map:

```json
{
  "questions": [ /* the original questions, echoed back */ ],
  "answers": {
    "How should I format the output?": "Summary",
    "Which sections should I include?": "Introduction, Conclusion"
  }
}
```

Multi‑select answers are joined with `", "`. Free‑text "Other" responses are sent as the raw user text (not the literal string "Other"). The model side then sees a `tool_result` whose content is rendered as something like `User has answered your questions: …` (this exact phrasing is visible in bug report `anthropics/claude-code#12031`).

### 1.5 Documented limits / quirks

- 1–4 questions per call, 2–4 options each (official docs).
- 60‑second timeout in the interactive TUI, ~4–6 questions per session (community guide; not in official docs but consistent with reports).
- Cannot be used from sub‑agents (Task‑spawned agents): "AskUserQuestion is not currently available in subagents spawned via the Agent tool" (official docs, "Limitations" section).
- In the SDK, when running headless without a TTY the built‑in TUI silently fails to render — see the Medium write‑up "When Claude Can't Ask" by Mehmet Öner Yalçın (oneryalcin.medium.com), confirmed by `anthropics/claude-code#16712`. Headless integrations must either (a) supply a `canUseTool` callback or (b) use a `PreToolUse` hook returning `permissionDecision: "defer"` (Claude Code ≥ v2.1.89, see §2.4).

---

## 2. Output markers — what shows up in transcripts, streams, and hooks

### 2.1 The JSONL transcript file (`~/.claude/projects/<slug>/<session>.jsonl`)

Claude Code records every conversation turn to a JSONL file whose path is exposed as `transcript_path` in both the status‑line stdin payload and every hook payload. The format is the standard Anthropic Messages JSON, with one JSON object per line and an outer wrapper carrying `type`, `message`, `parent_tool_use_id`, and `session_id`.

An `AskUserQuestion` invocation appears as an `assistant` line containing a `tool_use` content block:

```json
{
  "type": "assistant",
  "message": {
    "id": "msg_…",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-…",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_01ABC…",
        "name": "AskUserQuestion",
        "input": {
          "questions": [ /* see §1 */ ]
        }
      }
    ],
    "stop_reason": "tool_use",
    …
  },
  "parent_tool_use_id": null,
  "session_id": "e2393023-f234-46fc-…"
}
```

After the user answers, a paired `user` line is appended carrying a `tool_result` block whose `tool_use_id` matches:

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01ABC…",
        "content": "User has answered your questions: …",
        "is_error": false
      }
    ]
  },
  "session_id": "e2393023-f234-46fc-…"
}
```

This format is documented for `tool_use`/`tool_result` blocks in the Anthropic API tool‑use docs, and the same shape is observed in Claude Code's `--output-format=stream-json` (see Dex Horthy's "a few fun things you can do with claude code" on theouterloop.substack.com, and Khan Academy's `format-claude-stream` repo). Issue `anthropics/claude-code#16712` further confirms the JSONL layout and demonstrates that to programmatically answer an outstanding `AskUserQuestion` you append a synthetic `tool_result` line directly to the session JSONL.

**Distinguishing marker for grep:** `"name":"AskUserQuestion"` on an assistant line. **A pending question** is one where the most recent assistant `tool_use` for `AskUserQuestion` has no matching `tool_result` line for its `id` later in the file. The Anthropic API rule that "tool result blocks must immediately follow their corresponding tool use blocks" means there is never a non‑answer line between them.

### 2.2 Stream‑JSON output (`--output-format stream-json`)

Per the Agent SDK "Stream responses in real‑time" page and Khan/format-claude-stream, the stream emits one JSON object per line. With `--include-partial-messages` you get raw Anthropic SSE events; without it you get aggregated `assistant`/`user`/`system`/`result` envelopes.

Top‑level event types you will see:

- `system` — `subtype` includes `init`, `api_retry`.
- `assistant` — wraps a Messages API `message` object (where the `tool_use` for `AskUserQuestion` lives, exactly as in §2.1).
- `user` — wraps `tool_result` blocks.
- `stream_event` (only with `--include-partial-messages`) — wraps raw SSE: `message_start`, `content_block_start`, `content_block_delta` (with `input_json_delta` partial JSON for tool_use input), `content_block_stop`, `message_delta`, `message_stop`.
- `result` — final session summary.

**Detection in stream‑json:** look for an `assistant` event containing `content[].type=="tool_use"` and `content[].name=="AskUserQuestion"`, then watch for the matching `user`/`tool_result` event with the same `tool_use_id`. With partial messages enabled, the earliest signal is a `content_block_start` whose `content_block.type=="tool_use"` and `name=="AskUserQuestion"`.

In headless `-p` mode the stream may end while the question is still pending. Per the docs, returning `permissionDecision: "defer"` from a `PreToolUse` hook causes Claude Code to exit with `stop_reason: "tool_deferred"` and a top‑level `deferred_tool_use` field in the `result` object carrying `{ id, name: "AskUserQuestion", input }`. That field is the canonical headless marker.

### 2.3 Hooks: `PreToolUse` and `PostToolUse` with matcher `"AskUserQuestion"`

The official Hooks reference (`code.claude.com/docs/en/hooks`) explicitly lists `AskUserQuestion` in the table of tool‑name matchers for `PreToolUse`/`PostToolUse`/`PostToolUseFailure`/`PermissionRequest`/`PermissionDenied`:

> Runs after Claude creates tool parameters and before processing the tool call. Matches on tool name: Bash, Edit, Write, Read, Glob, Grep, Agent, WebFetch, WebSearch, **AskUserQuestion**, ExitPlanMode, and any MCP tool names.

So a working hook is:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          { "type": "command",
            "command": "/path/to/notify.sh" }
        ]
      }
    ]
  }
}
```

The hook script receives this JSON on stdin (matching the documented `PreToolUse` schema):

```json
{
  "session_id": "abc123",
  "transcript_path": "/Users/.../.claude/projects/.../<session>.jsonl",
  "cwd": "/Users/...",
  "permission_mode": "default",
  "hook_event_name": "PreToolUse",
  "tool_name": "AskUserQuestion",
  "tool_input": {
    "questions": [ … see §1 … ]
  }
}
```

A worked example (from Tony Dehnke's ntfy guide) extracts the first question with `jq '.tool_input.questions[0].question'` — confirming the field path `tool_input.questions[].question` on the wire.

**Caveats and version history (these matter for James's tooling):**

- This is a recent capability. Earlier in 2025 there were multiple feature requests that `AskUserQuestion` did not trigger `PreToolUse`/`PostToolUse` at all (`anthropics/claude-code#15872`, `#28273` — closed as duplicate, `#12605`, `#12048`). The docs and bug report `#12031` (which complains that the *result data* is stripped from `AskUserQuestion`'s `tool_response` when `PreToolUse` hooks are active) confirm hooks now fire. Test on the version you ship against; behavior changed during the v2.x line.
- `PreToolUse` hooks **do not fire in `claude -p` (headless) mode** in some recent versions (`anthropics/claude-code#40506`, opened Mar 2026, marked stale). The doc text claiming they do is aspirational on the `defer` path. Treat headless detection as separate from interactive detection.
- `PreToolUse` hook with `permissionDecision: "defer"` is the official headless answer: Claude Code ≥ v2.1.89, exits with `deferred_tool_use` in the SDK result (Hooks reference, "PreToolUse decision control"). Returning `permissionDecision: "allow"` with an `updatedInput` containing `questions` + `answers` is what programmatically answers the question without a TUI.

### 2.4 The `Notification` hook (a partial signal at best)

The Hooks reference enumerates `Notification` matcher values as: `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog`, `elicitation_complete`, `elicitation_response`. There is **no `askuserquestion`/`question` matcher**. Empirically the `Notification` event fires for tool‑permission prompts and for the 60‑second idle case, with input shape:

```json
{
  "session_id": "ca66bfe3-…",
  "transcript_path": "/home/tim/.claude/projects/…/<session>.jsonl",
  "cwd": "/home/tim/.claude",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission to use Bash"
}
```

(Example from `anthropics/claude-code#8320`.) Multiple open issues (`#16975`, `#12048`, `#8320`) document that:

- `idle_prompt` fires **after every assistant turn**, producing false positives, and is unreliable on Linux/Wayland.
- There is no notification matcher specific to `AskUserQuestion`.
- The `message` field is often empty or just the project name.

**Bottom line:** `Notification` is *not* a reliable "interactive menu is awaiting input" signal on its own. Use the `PreToolUse:AskUserQuestion` hook instead, or transcript tailing.

---

## 3. Status‑line context and detection strategies

### 3.1 What the `statusLine` script gets on stdin

Configured in `~/.claude/settings.json`:

```json
{ "statusLine": { "type": "command", "command": "~/.claude/statusline.sh", "padding": 0 } }
```

The script gets a JSON blob on stdin every time the conversation updates (throttled to ~300 ms). The schema, documented at `code.claude.com/docs/en/statusline` and reproduced verbatim in `Piebald-AI/.../agent-prompt-status-line-setup.md` and the published gist by AKCodez, is:

```json
{
  "session_id": "abc123…",
  "session_name": "my-session",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "model": { "id": "claude-opus-4-…", "display_name": "Opus" },
  "workspace": {
    "current_dir": "/…",
    "project_dir": "/…",
    "added_dirs": [],
    "git_worktree": "feature-xyz"
  },
  "version": "2.1.90",
  "output_style": { "name": "default" },
  "cost": {
    "total_cost_usd": 0.01234,
    "total_duration_ms": 45000,
    "total_api_duration_ms": 2300,
    "total_lines_added": 156,
    "total_lines_removed": 23
  },
  "context_window": {
    "total_input_tokens": 15234,
    "total_output_tokens": 4521,
    "context_window_size": 200000,
    "used_percentage": 8,
    "remaining_percentage": 92,
    "current_usage": {
      "input_tokens": 8500,
      "output_tokens": 1200,
      "cache_creation_input_tokens": 5000,
      "cache_read_input_tokens": 2000
    }
  },
  "exceeds_200k_tokens": false,
  "rate_limits": {
    "five_hour": { "used_percentage": 23.5, "resets_at": 1738425600 },
    "seven_day": { "used_percentage": 12.0, "resets_at": 1738857600 }
  }
}
```

(Older versions also emitted `"hook_event_name": "Status"`; newer payloads omit it. The `transcript_path` field has been stable.)

**The status‑line payload does not include any direct "awaiting input" flag.** There is no field that says "AskUserQuestion is pending." Detection must be inferred.

### 3.2 Recommended detection strategies (ranked by reliability)

**A. Hook + side‑channel file (most reliable for a single machine).**
Configure paired hooks that write a state file the status‑line script reads:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "AskUserQuestion",
      "hooks": [{ "type": "command",
        "command": "jq -c '{session_id, ts: now, questions: .tool_input.questions}' >> ~/.claude/state/$(jq -r .session_id).pending"
      }]
    }],
    "PostToolUse": [{
      "matcher": "AskUserQuestion",
      "hooks": [{ "type": "command",
        "command": "rm -f ~/.claude/state/$(jq -r .session_id).pending"
      }]
    }]
  }
}
```

The status‑line script then checks `~/.claude/state/${session_id}.pending`. This is the pattern shown in `anthropics/claude-code#12605` (using a backend POST instead of a file). Caveats: hooks may not fire in `claude -p` mode (`#40506`); `PostToolUse` payload may be stripped of the answer due to `#12031`, but the *event firing* is enough to clear the marker.

**B. Tail the transcript JSONL.**
The status‑line script already has `transcript_path`. A pending question is the case where the **last** `tool_use` content block in the file with `name=="AskUserQuestion"` has no matching `tool_result` line for its `id` after it. A fast bash heuristic:

```bash
TP=$(jq -r .transcript_path)
# Read just the tail; questions are usually answered within seconds
LAST_AUQ=$(tac "$TP" | grep -m1 '"name":"AskUserQuestion"')
LAST_AUQ_ID=$(printf %s "$LAST_AUQ" | jq -r '.message.content[]? | select(.type=="tool_use" and .name=="AskUserQuestion") | .id' | head -1)
if [ -n "$LAST_AUQ_ID" ] && ! grep -q "\"tool_use_id\":\"$LAST_AUQ_ID\"" "$TP"; then
  echo "❓ awaiting menu input"
fi
```

Tail‑safe variants should `tac` and stop on the first match. The Anthropic API guarantee that `tool_result` immediately follows its `tool_use` means false positives are essentially zero — once the answer arrives, the result block is appended in the next conversation tick.

**C. Combine with `Stop` and `Notification` hooks.**
The Hooks reference shows `Stop` fires when the assistant's turn finishes. If a `Stop` event arrives without a paired `tool_result` for the latest `AskUserQuestion`, the model is genuinely waiting on the user. This disambiguates against the unreliable `idle_prompt` notification matcher.

**D. For multi‑session monitoring.**
All sessions write to `~/.claude/projects/<workspace‑slug>/<session>.jsonl`. A single watcher (inotify/fswatch) over `~/.claude/projects/**/*.jsonl` lets one process monitor every session on the machine. Combine with the per‑session `state/` file pattern from (A) for low‑latency notification, and with (B) as the source of truth.

### 3.3 Caveats for status lines specifically

- The status line script only reads the **first line of stdout** and is throttled to one update per 300 ms (per `code.claude.com/docs/en/statusline`). Slow scripts cause stale output; in‑flight scripts are cancelled when a new tick arrives. Keep transcript reads small (tail‑based, last N kB).
- `current_usage` is `null` before the first API call and just after `/compact`.
- The status line does **not** receive `hook_event_name` reliably in current versions; do not depend on it.
- The status line is *not* updated specifically when `AskUserQuestion` opens — it updates on conversation message changes, so it will tick once when the assistant's message lands. After that, no further ticks until the user answers, which means a status‑line script running purely off its stdin will see the "pending" state on the tick that delivers the question and won't be re‑invoked until the answer is submitted. For this reason a side‑channel (hook‑written file or tail of transcript with an external watcher) is necessary if you want a continuously‑updating "waiting for input for N seconds" indicator.

---

## 4. Concrete grep‑able strings

For James's external monitoring tooling, these are the exact byte sequences worth grepping for on disk and in stream output:

| String | Where it appears | Meaning |
|---|---|---|
| `"name":"AskUserQuestion"` | transcript JSONL, stream‑json `assistant` events | The model invoked the tool |
| `"tool_name":"AskUserQuestion"` | hook stdin (`PreToolUse`/`PostToolUse`/`PermissionRequest`) | Hook fired for this tool |
| `"hook_event_name":"PreToolUse"` *with* `AskUserQuestion` tool_name | hook stdin | Earliest hook signal of a pending question |
| `"deferred_tool_use"` with `"name":"AskUserQuestion"` | SDK result object in headless `-p` mode | Tool was deferred via `permissionDecision:"defer"` (≥ v2.1.89) |
| `"stop_reason":"tool_deferred"` | SDK result | Same path as above |
| `"questions":[` inside a `tool_use.input` | transcript / stream | Schema confirmation |
| `"tool_use_id":"<the-AUQ-id>"` *absent* from later transcript lines | transcript JSONL | The question is **still pending** |
| `User has answered your questions:` | `tool_result.content` text | The user has answered (post‑answer marker) |

---

## 5. What is *not* publicly documented

Worth flagging for honest engineering planning:

- There is no documented "is‑awaiting‑input" boolean in any session/state file the CLI writes.
- The internal name of the state directory used by the TUI render of the question is not documented; community efforts (`#12605`, `#16712`) treat the JSONL transcript as the only stable source of truth.
- The exact behavior of `PreToolUse:AskUserQuestion` hooks across versions has churned during 2025 and into 2026, with multiple open bugs (`#12031` strips response data; `#40506` reports hooks don't fire in `-p` mode; `#28273` was closed as a duplicate in Feb 2026). Verify behavior against the specific Claude Code version your tool targets — the `version` field in the status‑line stdin payload is the right place to read it.
- The `preview` field on options (HTML/markdown previews) is a TypeScript‑SDK‑only feature; Claude Code's own TUI does not currently surface it.
- `AskUserQuestion` is not available to sub‑agents (Task tool / Explore / Plan), so you will never see its `tool_use` carrying a non‑null `parent_tool_use_id`. That means filters like `parent_tool_use_id == null` are safe.

---

## 6. Recommended implementation for James's monitor

1. Install a project‑level (or `~/.claude/settings.json`) hook pair on `PreToolUse:AskUserQuestion` and `PostToolUse:AskUserQuestion` that writes/removes a marker file keyed by `session_id` under e.g. `~/.claude/state/<session>.pending`.
2. The status‑line script reads `transcript_path` and `session_id` from stdin and tests for the marker file. If present, render `"⏸ menu"` or similar.
3. A single external watcher process monitors `~/.claude/state/*.pending` (or `~/.claude/projects/**/*.jsonl`) to surface multi‑session status, since the per‑session status‑line invocation is event‑driven and won't tick while a session is idle.
4. Fallback to transcript‑tail detection (§3.2 B) for any session that started before the hooks were configured, or where hooks didn't fire (e.g. headless `-p` mode subject to `#40506`).
5. For headless integrations, prefer the SDK `canUseTool` callback (Python/TypeScript) or a `PreToolUse` hook that returns `permissionDecision:"defer"` — both surface the question payload as structured JSON and avoid the disappearing‑TUI problem documented in oneryalcin.medium.com.

This combination gives a real‑time, reliable "an interactive menu is currently waiting for user input" signal across both interactive and headless sessions, using only publicly documented surfaces.