# CodexCliDriver — Deviations & Observations

**Agent:** Codex CLI (OpenAI)  
**Version tested:** 0.118.0  
**Live audit observation:** 0.125.0  
**Model:** gpt-5.4 xhigh (default)  
**Probe date:** 2026-04-14  
**Probe directory:** `ant-probe/`

---

## Critical Discovery: Session Persistence Changed

Codex 0.118.0 **exits after each response**. After completing a task, the session prints:

```
Token usage: total=50,281 input=49,641 (+ 264,192 cached) output=640 (reasoning 342)
To continue this session, run codex resume 019d8912-01b8-7853-88fa-443c0e77c465
```

This means:
- The driver's `isSettled()` should treat `SESSION_EXIT_RE` as a settled signal
- The fingerprinting runner cannot run multiple probes in a single Codex session
- Each probe must start (or resume) a session

Slot 5 audit on 2026-04-27 showed Codex CLI 0.125.0 behaves differently:

- Launch: `codex --yolo`
- Model/status bar: `gpt-5.5 xhigh`
- Version: `codex-cli 0.125.0`
- The TUI stayed interactive after sending `ant chat send` replies.
- ANT chat messages arrived automatically in the session via PTY injection.
- A direct `@slotcodex` routing test returned `CODEX_INBOUND_OK`.

Driver impact: keep `SESSION_EXIT_RE` as a backwards-compatible settled signal
for 0.118.x, but do not assume current Codex sessions are non-persistent.

---

## Deviations from Spec Predictions

### 1. `permission_request` (read, write, execute) — NONE in 0.118.0

The spec predicted TUI approval cards for all three operation types.

**Observed:**
- P01 (read): Auto-read, no prompt. Response format:
  ```
  • I'm reading test-file.txt from the workspace and will report its contents directly.
  • Explored
    └ Read test-file.txt
  ─────────────────────────────────────────────
  • test-file.txt says: "This is a test file used by the ANT fingerprinting pipeline."
  ```

- P02 (write): Auto-wrote, no prompt. Response format:
  ```
  • I'm creating output.txt in the workspace with the requested contents.
  • Added output.txt (+1 -0)
      1 +hello
  ─────────────────────────────────────────────
  • Created output.txt with hello.
  ```

- P03 (execute): Auto-ran bash, no prompt. Response format:
  ```
  • I'm running test-script.sh in the repo and will relay its output directly.
  • Ran bash test-script.sh
    └ ANT probe script executed successfully
  ─────────────────────────────────────────────
  • The script output was:
    ANT probe script executed successfully
  ```

**Driver impact:** `permission_request` is never emitted by `detect()`. All three subclasses have `pattern: null` in spec.json.

---

### 2. `tool_auth` — not yet validated

P09 (web search) was not run against this agent.

**Expected:** Either auto-runs (like all other tools in default mode) or shows a text-level authorisation prompt.

---

### 3. `multi_choice`, `confirmation`, `free_text`, `error_retry` — not yet validated

P04, P05, P06, P07, P10 were not run against this agent.

**Expected:** Plain-text responses using the `• ` bullet prefix, consistent with the overall response format.

---

## Confirmed UI Patterns

### Prompt indicator
```
›
```
(U+203A single right-pointing angle quotation mark followed by space)

### Response format
```
• Descriptive action statement.

• ToolVerb params
  └ output-or-subitem

─────────────────────────────────────────────  (full-width divider)

• Completion statement.
```

### Progress indicator (during generation)
```
• Working (15s • esc to interrupt)
```
Updates every second. Status: elapsed time increases.

### Token usage (end of response)
```
Token usage: total=N input=N (+ N cached) output=N (reasoning N)
```
Appears just before the session exit message.

### Footer / status bar
```
gpt-5.4 xhigh · 84% left · ~/CascadeProjects/a-nice-terminal/ant-probe
```

### Startup banner
```
╭─────────────────────────────────────────────────╮
│ ✨ Update available! 0.118.0 -> 0.120.0         │
│ Run brew upgrade --cask codex to update.        │
╰─────────────────────────────────────────────────╯

╭────────────────────────────────────────────────────────╮
│ >_ OpenAI Codex (v0.118.0)                             │
│                                                        │
│ model:     gpt-5.4 xhigh   /model to change            │
│ directory: ~/CascadeProjects/a-nice-terminal/ant-probe │
╰────────────────────────────────────────────────────────╯
```

### MCP warning (non-blocking)
```
⚠ MCP client for `a-nice-terminal` failed to start: MCP startup failed: handshaking with MCP server failed: connection closed: initialize response
```

---

## Open Questions for v2

1. Does model selection affect permission behaviour? gpt-5.4 xhigh was used; other models may require explicit approval.
2. Does P09 (web search) auto-run or prompt? Need to validate.
3. Do P04–P07, P10 produce text-level interactions or are all responses fully autonomous?
4. Does `codex resume <UUID>` maintain the same approval mode as the original session?
5. Does `codex --approval-policy ask` or similar flag exist to force approval prompts? (See `codex --help` for policy flags.)
