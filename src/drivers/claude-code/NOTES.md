# ClaudeCodeDriver — Deviations & Observations

**Agent:** Claude Code  
**Version tested:** 2.1.89 (Opus 4.6)  
**Probe date:** 2026-04-13  
**Probe directory:** `ant-probe/`

---

## Deviations from Spec Predictions

### 1. `permission_request (read)` — does not exist in 2.1.89

The spec predicted that reading a file would trigger a permission TUI.

**Observed:** P01 ("Read the contents of test-file.txt") completed with no TUI prompt.  
Claude Code 2.1.89 auto-reads files in the working directory and its subdirectories without user authorisation. The `⏺ Reading 1 file…` line is a *progress* indicator, not a permission request.

**Driver impact:** The `permission_request/read` subclass is documented in `spec.json` with `"pattern": null`. The driver will never produce a `permission_request` event for read operations.

---

### 2. `multi_choice` — no native TUI selector

The spec predicted a keyboard-navigable Ink/React selector for both numbered (P04) and tab-able (P05) variants.

**Observed:** Both P04 and P05 produced plain-text numbered lists in the conversation followed by a question ("Which one would you like to go with?"). No TUI component rendered. The user types the option number at the `❯` prompt.

**Driver impact:** `multi_choice` detection relies on text patterns (`^\s*\d+\.\s+\S` lines + a `choose one` question). Response method is `{number}\n` via send-keys.

---

### 3. `confirmation` — text-level only, then triggers `permission_request`

The spec predicted a native Yes/No TUI dialog.

**Observed:** P06 ("Delete output.txt — but ask me to confirm before doing it") produced:
1. Model text: "I'd like to delete output.txt. Shall I go ahead?" (a `confirmation` / `free_text` event)
2. After the user typed "yes", the actual bash `rm` command triggered the standard `permission_request (execute)` TUI

There is no standalone `confirmation` TUI in Claude Code 2.1.89. The spec's `confirmation` class maps to a text-level exchange followed by the usual bash permission TUI.

**Driver impact:** `confirmation` is detected as text (regex on "shall I go ahead" etc.) and responded to with `yes\n` or `no\n`. The subsequent bash TUI is a separate `permission_request (execute)` event.

---

### 4. `error_retry` — no Retry/Abort/Modify TUI card

The spec predicted a structured card with Retry / Abort / Modify options.

**Observed:** P10 ("Read the file missing-file-that-does-not-exist.txt") was handled silently at the tool level — Claude Code attempted to read the file, received an error, and then offered in plain text: "That file doesn't exist... Would you like me to create it, or did you mean a different file?"

This is effectively a `free_text` event. No TUI card was rendered.

**Driver impact:** `error_retry` is detected by regex matching both an error description and a recovery offer in the same text block. Response is a typed instruction.

---

## Confirmed TUI Patterns (as expected)

### `permission_request (write)` — confirmed via P02, P08

```
────────────────────────────────────────────────────── (wide ─ divider)
 Create file
 output.txt
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
  1 hello
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 Do you want to create output.txt?
 ❯ 1. Yes
   2. Yes, allow all edits during this session (shift+tab)
   3. No

 Esc to cancel · Tab to amend
```

### `permission_request (execute)` — confirmed via P03, P06

```
────────────────────────────────────────────────────── (wide ─ divider)
 Bash command

   bash /path/to/test-script.sh
   Run test-script.sh

 This command requires approval

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for: bash:*
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain
```

### `tool_auth` — confirmed via P09 (Web Search)

```
────────────────────────────────────────────────────── (wide ─ divider)
 Tool use

   Web Search("Node.js current LTS version 2026")
   Claude wants to search the web for: Node.js current LTS version 2026

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for Web Search commands in /path/to/dir
   3. No

 Esc to cancel · Tab to amend
```

---

## TUI Input Method (applies to all three TUI types)

The `❯ 1. Yes` option is **pre-highlighted**. Pressing **Enter alone** (no preceding number) confirms Yes. Typing `3` + Enter denies. Typing `2` + Enter grants permanent/session-wide permission.

The earlier attempt to send `1\n` (number + Enter) caused the `1` to register but the `\n` was then queued into the next interaction. The correct method is an **empty Enter** for approval.

---

## Spinner Labels

Claude Code 2.1.89 uses rotating unicode symbols + gerund words during generation:

| Symbol | Example |
|--------|---------|
| `✽` | `✽ Beaming…` |
| `✳` | `✳ Elucidating…` |
| `✻` | `✻ Zesting…` |
| `✶` | `✶ Synthesizing…`, `✶ Cerebrating…` |
| `·` | `· Slithering…` |
| `★` | not yet observed in this session |
| `⏺` | `⏺ Reading 1 file…`, `⏺ Searching for 1 pattern…` (tool ops) |

Status bar switches from `? for shortcuts` → `esc to interrupt` during active generation. This is the most reliable idle/active discriminator.

---

## Status Bar Observations

| State | Status Bar Text |
|-------|----------------|
| Idle (waiting for input) | `? for shortcuts` |
| Active (generating) | `esc to interrupt` |
| Permission TUI open | `esc to interrupt` |
| Stop hooks running | `✽ Reticulating… (running stop hooks… N/N)` |

---

## Open Questions for v2

1. Does `permission_request (read)` appear for files outside the working directory? Not tested.
2. Does `shift+tab` for "Yes, allow all edits during this session" work via send-keys? Not validated.
3. Tab + amend flow: pressing Tab in a TUI brings up an edit overlay — structure unknown.
4. ctrl+e in bash permission TUI: shows an explanation. Might be useful for richer extraction.
5. The "2 MCP servers need auth" notice in the status bar at session start: does this trigger a `tool_auth` event separately from the per-query flow? Not investigated.
