# Chairman Full Orchestration — Design Spec
**Date:** 2026-03-27
**Status:** Approved

---

## Problem

The Chairman (@Chatlead) currently only routes chat messages to agents. There is no bridge between terminals and chat in either direction — permission prompts go unseen, @mentions don't reach terminals, assigned tasks go unmonitored, and idle agents go undetected.

## Goal

The Chairman becomes a full orchestration layer: monitoring all participant terminals, bridging messages in both directions, tracking task execution, and detecting gaps between what should be happening and what is.

### Capabilities

1. **Terminal Approval** — permission prompts posted to chat with Approve/Reject/View buttons
2. **Message Bridge** — @mentions in chat injected into the addressed agent's terminal if not received
3. **Task Watchdog** — assigned tasks monitored; idle agents nudged in chat and in their terminal
4. **Gap Detection** — identifies tasks assigned but not started, agents active but not reporting, terminals idle on in-progress work

---

## Architecture

Ten components modified or created:

| File | Change |
|------|--------|
| `packages/app/server/terminal-monitor.ts` | NEW — polls terminals for permission prompts + idle state |
| `packages/app/server/message-bridge.ts` | NEW — bridges chat @mentions into agent terminals |
| `packages/app/server/task-watchdog.ts` | NEW — tracks task assignments, detects gaps, nudges agents |
| `packages/app/server/routes/chairman.ts` | EXTEND — terminal-action, session, room endpoints |
| `packages/app/server/chairman-bridge.ts` | EXTEND — starts/stops all three new modules |
| `packages/app/src/utils/protocolTypes.ts` | EXTEND — add `terminal_approval` type |
| `packages/app/src/components/TerminalApprovalCard.tsx` | NEW — pending/resolved card UI |
| `packages/app/src/components/MessageBubble.tsx` | EXTEND — render TerminalApprovalCard |
| `packages/app/src/components/ChairmanPanel.tsx` | EXTEND — session + room selector |
| `packages/app/src/store.ts` | EXTEND — `chairmanRoom` setting |

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

## Not In Scope (Phase 1)

- Support for non-Claude-Code permission prompts (e.g. sudo) — can be added later via additional pattern strings
- Telegram/Slack bridge for approval (chat-only for now)
- Persistent seenPrompts across server restarts
- Auto-approve rules / always-allow patterns

---

## Foundation: Agent-Terminal Mapping

All three new modules share a common function `getRoomParticipants(roomName)` that calls:

```
GET /api/chat-rooms/:roomName/participants
→ [{ terminalSessionId, agentName, model }]
```

The `chairman_room` setting (new, alongside `chairman_session`) names the chat room to monitor. The chairman derives both the conversation session ID and all terminal IDs from this one room name.

`ChairmanPanel.tsx` gains a room selector: a dropdown populated from `GET /api/chat-rooms` that sets `chairman_room` via `POST /api/chairman/room`.

---

## Module 8: `message-bridge.ts`

Bridges chat @mentions to agent terminals when they aren't received.

### Trigger

Polls the chairman session for new human messages every 3s. For each message containing `@<agentHandle>`:

1. Looks up `terminalSessionId` for that handle from room participants
2. Checks whether that terminal's recent output (last 10s via output cursor delta) shows any sign of activity — if the output cursor advanced after the message timestamp, the agent likely received it already
3. If no activity after a 6s grace period → injects the raw message content into the terminal

### Injection Format

Raw message content pasted directly via `ptyProcess.write(message.content + "\n")`. No wrapping — the agent sees it as if it were typed at the prompt.

### De-duplication

Tracks `injectedMessageIds: Set<string>` in module scope. A message ID is added to the set when injected; never injected twice regardless of re-detection.

### What counts as "received"

Terminal output cursor has advanced by ≥1 event since message timestamp + 6s. This is a simple heuristic — if the agent's terminal produced any output it likely processed the message. If not, the injection ensures delivery.

---

## Module 9: `task-watchdog.ts`

Monitors task assignments and ensures assigned agents are working.

### Task State Tracking

On startup and every 30s, loads all tasks from `GET /api/tasks` and coordination tasks from `GET /api/v2/agent/context?session_id={chairmanSession}`. Builds a map:

```typescript
interface WatchedTask {
  taskId: string;
  assignedHandle: string;       // e.g. "@ANTClaude"
  terminalSessionId: string;    // from room participant lookup
  assignedAt: Date;
  lastOutputCursor: number;     // terminal output cursor at time of assignment
  nudgedAt: Date | null;
  status: "in_progress" | "todo" | "done";
}
```

### Idle Detection

Every 30s, for each `in_progress` task:

1. Gets current terminal output cursor via `getTerminalOutputCursor(terminalSessionId)`
2. Compares to `lastOutputCursor` recorded when task was assigned (or last nudge)
3. If cursor hasn't advanced in **5 minutes** → trigger a nudge

### Nudge Action (both chat + terminal)

**In chat** — posts:
```
[@Chatlead] @ANTClaude — T001 has been in_progress for 8 minutes with no terminal
activity detected. Are you working on it? Post a status update.
```

**In terminal** — injects via `ptyProcess.write()`:
```
[Chatlead] Task T001 still shows in_progress — please post a status update in chat.\n
```

Both use raw paste (option A from brainstorm). `nudgedAt` is set to prevent re-nudging within 10 minutes per task.

### Gap Detection

Beyond idle tasks, the watchdog also detects:

- **Unstarted assignments**: task has `status: "todo"` but was assigned (has `assigned_name`) more than 3 minutes ago → posts: *"@ANTClaude — T002 was assigned to you 4 mins ago but hasn't been started. Ready to begin?"*
- **Active terminal, no chat update**: agent's terminal shows output activity but no chat message from that agent in 15 minutes → posts: *"@ANTClaude — good terminal activity on T001 but no chat update in 15 mins. How's it going?"*
- **Task marked done in chat but terminal still active**: task status changed to done but agent's terminal shows continued activity → posts: *"@ANTClaude — T001 is marked done but terminal still active. Follow-up work, or should I update the task?"*

### Thresholds (all configurable via env vars)

| Threshold | Default | Env Var |
|-----------|---------|---------|
| Idle before nudge | 5 min | `WATCHDOG_IDLE_MS` |
| Unstarted assignment alert | 3 min | `WATCHDOG_UNSTARTED_MS` |
| No chat update alert | 15 min | `WATCHDOG_SILENT_MS` |
| Re-nudge cooldown | 10 min | `WATCHDOG_COOLDOWN_MS` |

---

## Updated `chairman-bridge.ts` Lifecycle

```typescript
import { startTerminalMonitor, stopTerminalMonitor } from "./terminal-monitor.js";
import { startMessageBridge, stopMessageBridge } from "./message-bridge.js";
import { startTaskWatchdog, stopTaskWatchdog } from "./task-watchdog.js";

export function startChairmanBridge(): void {
  startTerminalMonitor();
  startMessageBridge();
  startTaskWatchdog();
  // ... existing poll loop
}

export function stopChairmanBridge(): void {
  stopTerminalMonitor();
  stopMessageBridge();
  stopTaskWatchdog();
  // ...
}
```

All three modules check `isEnabled()` and `getSessionId()` / `getRoomName()` on every cycle, consistent with the existing chairman bridge pattern.

---

## Updated `routes/chairman.ts` Additions

### `GET /api/chairman/status` — extended response
```json
{
  "enabled": true,
  "model": "openai/gpt-oss-20b",
  "session": "RbL8N2Aco2qH",
  "room": "ChatV2"
}
```

### `POST /api/chairman/room`
```typescript
body: { room: string }
// Writes chairman_room to server_state
```

### `GET /api/chairman/rooms`
Returns available room names from `ChatRoomRegistry` for the room selector dropdown.

---

## Updated Error Handling

| Scenario | Behaviour |
|----------|-----------|
| No active PTY for terminal_id | Card shows "Terminal ended", buttons disabled |
| Chairman disabled mid-poll | All modules skip, nothing posted |
| No session or room set | All modules skip, ChairmanPanel shows warning |
| Same prompt re-detected after server restart | One duplicate card possible; 409 on action prevents double-execution |
| Network error on terminal-action call | Card shows inline error, buttons re-enable for retry |
| Agent not in room participants | Watchdog skips that task, logs warning |
| Message bridge injection fails (PTY gone) | Logs warning, message ID still marked as processed |
| Task watchdog nudge: agent already responded | `nudgedAt` cooldown prevents spam |

---

## Not In Scope

- Support for non-Claude-Code permission prompts (e.g. sudo)
- Telegram/Slack bridge for approvals
- Persistent seenPrompts / injectedMessageIds across server restarts
- Auto-approve rules / always-allow patterns
- Chairman responding in the terminal on behalf of the agent (reads only, no AI generation in terminal)
