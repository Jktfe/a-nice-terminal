# Chairman Terminal Monitor — Design Spec
**Date:** 2026-03-27
**Status:** Approved

---

## Problem

The Chairman (@Chatlead) currently only routes chat messages to agents. When Claude Code or another agent running in a terminal requires user approval (permission prompts, tool use confirmations), there is no bridge between the terminal and the chat — the user must context-switch to the terminal manually.

## Goal

When a terminal shows a permission prompt, the Chairman automatically posts an interactive card in the watched chat session. The user can approve, reject, or inspect the prompt directly from chat without touching the terminal.

---

## Architecture

Seven components modified or created:

| File | Change |
|------|--------|
| `packages/app/server/terminal-monitor.ts` | NEW — polls terminals, detects prompts, posts cards |
| `packages/app/server/routes/chairman.ts` | EXTEND — `/api/chairman/terminal-action` + `/api/chairman/session` |
| `packages/app/server/chairman-bridge.ts` | EXTEND — start/stop terminal monitor with bridge lifecycle |
| `packages/app/src/utils/protocolTypes.ts` | EXTEND — add `terminal_approval` type |
| `packages/app/src/components/TerminalApprovalCard.tsx` | NEW — pending/resolved card UI |
| `packages/app/src/components/MessageBubble.tsx` | EXTEND — render TerminalApprovalCard |
| `packages/app/src/components/ChairmanPanel.tsx` | EXTEND — session selector dropdown |

### Data Flow

```
PTY sessions
  → terminal-monitor polls getScreenLines() every 2s
  → detects Claude Code permission prompt patterns
  → de-dupes via prompt fingerprint Set
  → POSTs terminal_approval message to chairman_session via ANT API

User sees TerminalApprovalCard in chat
  → clicks Approve / Reject / View
  → POST /api/chairman/terminal-action
  → server writes y\n or n\n to PTY (or returns screen snapshot)
  → DB patches message metadata.status
  → socket emits message_updated
  → card renders resolved state
```

---

## Module 1: `terminal-monitor.ts`

Standalone module started/stopped alongside the chairman bridge. Has no shared state with `chairman-bridge.ts` — clean separation.

### Polling

- Interval: 2000ms (configurable via `TERMINAL_MONITOR_POLL_MS` env var)
- Reads all active PTY sessions from DB (`SELECT id, title FROM sessions WHERE type = 'terminal'`)
- For each session, calls `getHeadless(sessionId)?.getScreenLines()` — the same clean screen state the browser sees, no ANSI stripping required

### Prompt Detection

Runs against the array of screen lines:

```typescript
const screen = lines.join("\n");
const isPermissionPrompt =
  screen.includes("Do you want to proceed") ||
  (screen.includes("Allow") && (screen.includes("❯ Yes") || screen.includes("❯ No"))) ||
  screen.includes("Allow this action") ||
  screen.includes("Allow bash") ||
  screen.includes("Allow tool");
```

When matched, extracts:
- **tool_type**: first of `Bash`, `Edit`, `Write`, `Read`, `WebFetch`, `MultiEdit` found on screen
- **detail**: the line immediately after the tool type line (command or file path), truncated to 200 chars
- **terminal_name**: session title from DB, fallback `"Terminal"`

### De-duplication

```typescript
const promptId = crypto.createHash("sha1")
  .update(`${sessionId}:${toolType}:${detail}`)
  .digest("hex")
  .slice(0, 12);
if (seenPrompts.has(promptId)) return; // already posted
seenPrompts.add(promptId);
```

`seenPrompts` is a `Set<string>` in module scope. It is cleared when a session ends (listen to `onCommandLifecycle` for session destroy events).

### Posting to Chat

Posts via `POST {ANT_URL}/api/sessions/{chairman_session}/messages`:

```typescript
{
  role: "agent",
  content: `**@Chatlead** — Terminal approval required\n\n**${toolType}**: \`${detail}\`\n\nRespond using the card below.`,
  format: "markdown",
  sender_name: "@Chatlead",
  sender_type: "agent",
  metadata: {
    type: "terminal_approval",
    terminal_id: sessionId,
    terminal_name: terminalName,
    tool_type: toolType,
    detail: detail,
    prompt_id: promptId,
    status: "pending"
  }
}
```

---

## Module 2: Chairman Route Extensions

### `POST /api/chairman/terminal-action`

```typescript
body: {
  terminal_id: string,
  action: "approve" | "reject" | "view",
  message_id: string,
  session_id: string
}
```

**approve**: writes `y\n` to PTY via `getPty(terminal_id)?.write("y\n")`, patches message `metadata.status = "approved"`, emits `message_updated` socket event with payload `{ messageId, metadata: { ...existing, status: "approved" } }`.

**reject**: writes `n\n` to PTY, patches `status = "rejected"`, emits `message_updated` with `{ messageId, metadata: { ...existing, status: "rejected" } }`.

**view**: calls `getHeadless(terminal_id)?.getScreenLines()`, returns `{ lines: string[] }`. Does not write to PTY. Does not update message status.

**Error cases:**
- PTY not found → 404 `{ error: "Terminal not found" }`
- PTY write fails → 502 `{ error: "Terminal write failed" }`
- Message already resolved (status !== "pending") → 409 `{ error: "Already resolved" }`

### `POST /api/chairman/session`

Already stubbed in `routes/chairman.ts`. Accepts `{ session: string }`, writes to `server_state`. Used by ChairmanPanel session selector.

---

## Module 3: `chairman-bridge.ts` Changes

In `startChairmanBridge()`:
```typescript
import { startTerminalMonitor } from "./terminal-monitor.js";
startTerminalMonitor();
```

In `stopChairmanBridge()`:
```typescript
import { stopTerminalMonitor } from "./terminal-monitor.js";
stopTerminalMonitor();
```

The terminal monitor inherits the same `chairman_enabled` + `chairman_session` check — it reads these from DB on every poll cycle, same pattern as the chairman bridge.

---

## Module 4: Protocol Type Extension

In `packages/app/src/utils/protocolTypes.ts`, add:

```typescript
// Existing ProtocolType union — add:
| "terminal_approval"

// Metadata shape:
interface TerminalApprovalMetadata {
  type: "terminal_approval";
  terminal_id: string;
  terminal_name: string;
  tool_type: string;
  detail: string;
  prompt_id: string;
  status: "pending" | "approved" | "rejected";
}
```

---

## Module 5: `TerminalApprovalCard.tsx`

New component following the `ProtocolCard` pattern (same amber colour scheme as Chairman).

### States

**pending:**
```
┌─ 🖥 Terminal Approval ──────────── PENDING ─┐
│ Bash                                         │
│ rm -rf /tmp/build                            │
│ Terminal: Claude Code session                │
│ [✅ Approve]  [❌ Reject]  [🔍 View]         │
└──────────────────────────────────────────────┘
```

**approved / rejected:** buttons replaced by a status line:
```
│ ✅ Approved  (or ❌ Rejected)
```

**view expanded:** `<pre>` block with screen lines rendered below buttons (does not replace buttons, user may still approve/reject after viewing).

### Implementation

```typescript
const [status, setStatus] = useState(metadata.status);
const [loading, setLoading] = useState<"approve"|"reject"|"view"|null>(null);
const [screenLines, setScreenLines] = useState<string[]|null>(null);

async function handleAction(action: "approve"|"reject"|"view") {
  setLoading(action);
  const res = await apiFetch("/api/chairman/terminal-action", {
    method: "POST",
    body: JSON.stringify({ terminal_id, action, message_id, session_id })
  });
  if (action === "view") {
    setScreenLines(res.lines);
  } else {
    setStatus(action === "approve" ? "approved" : "rejected");
  }
  setLoading(null);
}
```

Socket event `message_updated` also updates status if another participant acts first (prevents double-action).

---

## Module 6: `MessageBubble.tsx` Change

Below the existing `isProtocolMessage` check, add:

```tsx
{metadata?.type === "terminal_approval" && (
  <TerminalApprovalCard
    metadata={metadata}
    messageId={message.id}
    sessionId={sessionId}
  />
)}
```

---

## Module 7: `ChairmanPanel.tsx` Change

Add a session selector below the model selector. Loads current sessions via `GET /api/sessions`, lets user pick which conversation the Chairman monitors. Saves via `POST /api/chairman/session`. Shows the currently set session name as a confirmation.

This fixes the bug where `chairman_session` was empty and the Chairman had no conversation to watch.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No active PTY for terminal_id | Card shows "Terminal ended", buttons disabled |
| Chairman disabled mid-poll | Monitor skips, no message posted |
| No session set | Monitor skips, logs warning |
| Same prompt re-detected after server restart | `seenPrompts` Set is in-memory; on restart it is empty, so one duplicate card may appear. Acceptable — the 409 on action prevents double-execution. |
| Network error on terminal-action call | Card shows inline error, buttons re-enable for retry |

---

## Not In Scope

- Support for non-Claude-Code permission prompts (e.g. sudo) — can be added later via additional pattern strings
- Telegram/Slack bridge for approval (chat-only for now)
- Persistent seenPrompts across server restarts
- Auto-approve rules / always-allow patterns
