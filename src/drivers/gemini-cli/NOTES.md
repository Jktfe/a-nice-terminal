# GeminiCliDriver — Deviations & Observations

**Agent:** Gemini CLI  
**Version tested:** 0.37.0  
**Probe date:** 2026-04-14  
**Probe directory:** `ant-probe/`

---

## Critical Discovery: Approval Mode System

Gemini CLI 0.37.0 does **not** have per-tool approval TUI dialogs in the same style as Claude Code.
Instead, approval is controlled by a **pre-submission mode toggle** cycled with Shift+Tab (BTab).

### Three Modes (status bar patterns)

| Mode | Status bar | Submit key | Behaviour |
|------|-----------|-----------|-----------|
| **default** | `Shift+Tab to accept edits` | **BTab** | BTab submits AND switches to auto-accept |
| **auto_accept** | `auto-accept edits Shift+Tab to plan` | **Enter** | All tools auto-run, Enter submits |
| **plan** | `plan Shift+Tab to manual` | **BTab** | Read-only, writes/shell blocked |

**Important:** Pressing BTab from default mode simultaneously *submits the prompt* and *changes the mode to auto-accept*. This means the first probe in a fresh session runs in auto-accept mode even if you started in default mode.

---

## Deviations from Spec Predictions

### 1. `permission_request` — no TUI dialog in any mode

The spec predicted a visual Yes/No approval card before file writes or bash executions.

**Observed:** Both write (P02) and execute (P03) operations completed without any approval TUI. Tool results appear as completed `✓` boxes AFTER execution.

**Example write result box:**
```
╭───────────────────────────────────────────────────────╮
│ ✓  WriteFile Writing to output.txt                     │
│                                                        │
│ 1 hello                                                │
╰───────────────────────────────────────────────────────╯
✦ The file output.txt has been created with the content "hello".
```

**Example execute result box:**
```
╭───────────────────────────────────────────────────────────────────────────────╮
│ ✓  Shell bash test-script.sh [current working directory /path/to/dir] (desc)  │
│                                                                                │
│ ANT probe script executed successfully                                         │
╰───────────────────────────────────────────────────────────────────────────────╯
✦ The output of test-script.sh is: ANT probe script executed successfully
```

**Driver impact:** `detect()` returns `progress` events for these tool result boxes, not `permission_request`. The `permission_request` class is never emitted by this driver.

---

### 2. `tool_auth` — not yet validated

P09 (web search) was not run against this agent.

**Expected:** Probably follows same pattern as write/execute — `│ ✓  WebSearch ... │` result box, no pre-approval TUI.

**Driver impact:** `tool_auth` will never be emitted by `detect()`. TODO: validate.

---

### 3. Submit key confusion: Enter vs BTab

The TUI's multiline input area uses:
- **Enter** → inserts a newline (in default mode)
- **BTab (Shift+Tab)** → submits the prompt AND toggles approval mode (in default mode)
- **Enter** → submits the prompt (in auto-accept mode, after the first BTab submit)

This is counter-intuitive but confirmed by direct observation. After the first probe is sent via BTab, the session remains in auto-accept mode for all subsequent probes, making Enter the effective submit key for the rest of the session.

---

### 4. Multi-choice, confirmation, free_text, error_retry — not yet validated

P04, P05, P06, P07, P10 were not run against this agent.

**Expected:** Gemini likely returns plain-text responses for these (numbered lists, yes/no questions, open questions) with the `✦` prefix. Detection patterns are provided in `driver.ts` with TODO markers.

---

## Confirmed Patterns

### Response prefix

All Gemini model responses are prefixed with `✦` (heavy four balloon-spoked asterisk, U+2736).

### Progress indicator

```
  Responding with gemini-3-flash-preview
```
This appears above the response while the model is generating. The model name varies by the auto-selected model.

### Status bar

| State | Status bar |
|-------|-----------|
| Idle | `? for shortcuts` |
| Active (generating) | (TODO: capture exact wording) |
| Default mode | `Shift+Tab to accept edits` (right side) |
| Auto-accept mode | `auto-accept edits Shift+Tab to plan` (left side) |

### Footer

```
workspace (/directory) | branch | /model | context
~/CascadeProjects/.../ant-probe | main | Auto (Gemini 3) | 0% used
```

### MCP notices

```
ℹ MCP issues detected. Run /mcp list for status.
```
Appears at startup when MCP servers have issues. Does not block operation.

---

## Open Questions for v2

1. Does Gemini show an approval dialog in any sub-mode of "default" approval mode? Not fully investigated.
2. Does `--approval-mode default` launched via CLI behave differently from the interactive BTab toggle?
3. P09 web search: does it trigger `tool_auth` or auto-run with a `│ ✓  WebSearch │` box?
4. What does the status bar show during generation (active state)?
5. Does `plan` mode (read-only) produce a specific error or response when asked to write?
