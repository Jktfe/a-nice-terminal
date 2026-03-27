# Chairman Full Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend @Chatlead into a full orchestration layer: terminal permission approval cards, bidirectional chat↔terminal message bridging, and task watchdog with idle detection and nudging.

**Architecture:** Three new server modules (`terminal-monitor`, `message-bridge`, `task-watchdog`) started and stopped by `chairman-bridge`. All share room participant data (`terminalSessionId` per agent handle) fetched from the chat room API. A new `TerminalApprovalCard` React component handles interactive approval in-chat.

**Tech Stack:** TypeScript, Express, node-pty, better-sqlite3, Socket.IO, Vitest, React, Tailwind CSS

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/app/server/terminal-monitor.ts` | CREATE | Polls headless screen lines; detects permission prompts; posts approval cards |
| `packages/app/server/message-bridge.ts` | CREATE | Polls chat for @mentions; injects into agent terminals |
| `packages/app/server/task-watchdog.ts` | CREATE | Tracks task assignments; detects idle agents; nudges in chat + terminal |
| `packages/app/server/routes/chairman.ts` | MODIFY | Add `/terminal-action`, `/room`, `/rooms`; extend `/status` |
| `packages/app/server/chairman-bridge.ts` | MODIFY | Start/stop all three modules |
| `packages/app/src/utils/protocolTypes.ts` | MODIFY | Add `terminal_approval` type |
| `packages/app/src/components/TerminalApprovalCard.tsx` | CREATE | Approve/Reject/View card UI |
| `packages/app/src/components/MessageBubble.tsx` | MODIFY | Render TerminalApprovalCard when metadata type matches |
| `packages/app/src/components/ChairmanPanel.tsx` | MODIFY | Add room selector dropdown |
| `packages/app/server/__tests__/terminal-monitor.test.ts` | CREATE | Unit tests for prompt detection logic |
| `packages/app/server/__tests__/message-bridge.test.ts` | CREATE | Unit tests for bridge logic |
| `packages/app/server/__tests__/task-watchdog.test.ts` | CREATE | Unit tests for watchdog logic |

---

## Task 1: Chairman Room Settings (Server)

Adds `chairman_room` to server_state and exposes it via the existing chairman routes.

**Files:**
- Modify: `packages/app/server/routes/chairman.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/server/__tests__/chairman-routes.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import supertest from "supertest";
import express from "express";
import chairmanRouter from "../routes/chairman.js";
import { testDb } from "./setup.ts";

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(chairmanRouter);
  return app;
}

describe("GET /api/chairman/status", () => {
  it("includes room in response", async () => {
    const res = await supertest(createApp()).get("/api/chairman/status");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("room");
    expect(res.body.room).toBe("");
  });
});

describe("POST /api/chairman/room", () => {
  it("sets chairman_room in server_state", async () => {
    const res = await supertest(createApp())
      .post("/api/chairman/room")
      .send({ room: "ChatV2" });
    expect(res.status).toBe(200);
    expect(res.body.room).toBe("ChatV2");

    const row = testDb
      .prepare("SELECT value FROM server_state WHERE key = 'chairman_room'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe("ChatV2");
  });

  it("returns 400 when room is missing", async () => {
    const res = await supertest(createApp())
      .post("/api/chairman/room")
      .send({});
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/jamesking/CascadeProjects/a-nice-terminal/packages/app
pnpm test -- --reporter=verbose server/__tests__/chairman-routes.test.ts
```

Expected: FAIL — `room` not in status response, no `/room` endpoint.

- [ ] **Step 3: Implement the changes**

In `packages/app/server/routes/chairman.ts`, update `GET /api/chairman/status` and add `POST /api/chairman/room` and `GET /api/chairman/rooms`:

```typescript
// At top, existing imports remain. Add ChatRoomRegistry import:
import { registry as chatRoomRegistry } from "../chat-rooms.js";

// Update GET /api/chairman/status
router.get("/api/chairman/status", (_req, res) => {
  res.json({
    enabled: getSetting("chairman_enabled", "0") === "1",
    model: getSetting("chairman_model", DEFAULT_MODEL),
    session: getSetting("chairman_session", ""),
    room: getSetting("chairman_room", ""),
  });
});

// Add after existing POST /api/chairman/session:
router.post("/api/chairman/room", (req, res) => {
  const { room } = req.body;
  if (!room?.trim()) return res.status(400).json({ error: "room is required" });
  setSetting("chairman_room", room.trim());
  res.json({ room: room.trim() });
});

router.get("/api/chairman/rooms", (_req, res) => {
  try {
    const rooms = chatRoomRegistry.listRooms().map((r: any) => ({
      name: r.name,
      conversationSessionId: r.conversationSessionId,
    }));
    res.json({ rooms });
  } catch (err: any) {
    res.status(502).json({ error: "Cannot list rooms", detail: err.message });
  }
});
```

**Note:** Check `packages/app/server/chat-rooms.ts` for the exact export name of the registry. If it is not `registry`, update the import accordingly.

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test -- --reporter=verbose server/__tests__/chairman-routes.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/server/routes/chairman.ts packages/app/server/__tests__/chairman-routes.test.ts
git commit -m "feat: add chairman_room setting to routes and status"
```

---

## Task 2: ChairmanPanel Room Selector (UI)

Adds a room selector dropdown to the existing Chairman panel.

**Files:**
- Modify: `packages/app/src/components/ChairmanPanel.tsx`

- [ ] **Step 1: Add room state and effects**

In `ChairmanPanel.tsx`, add after the existing `saving` state:

```typescript
const [currentRoom, setCurrentRoom] = useState("");
const [rooms, setRooms] = useState<Array<{ name: string; conversationSessionId: string }>>([]);
const [loadingRooms, setLoadingRooms] = useState(false);
```

Update the existing `useEffect` that loads on `chairmanPanelOpen` to also fetch rooms and current room:

```typescript
useEffect(() => {
  if (!chairmanPanelOpen) return;
  apiFetch("/api/chairman/status")
    .then((data) => {
      setEnabled(data.enabled);
      setCurrentModel(data.model);
      setCurrentRoom(data.room ?? "");
    })
    .catch(() => {});

  setLoadingModels(true);
  setModelsError(null);
  apiFetch("/api/chairman/models")
    .then((data) => setModels(data.models))
    .catch(() => setModelsError("Cannot reach LM Studio"))
    .finally(() => setLoadingModels(false));

  setLoadingRooms(true);
  apiFetch("/api/chairman/rooms")
    .then((data) => setRooms(data.rooms ?? []))
    .catch(() => {})
    .finally(() => setLoadingRooms(false));
}, [chairmanPanelOpen]);
```

- [ ] **Step 2: Add handleRoomChange**

After `handleModelChange`:

```typescript
const handleRoomChange = async (room: string) => {
  setCurrentRoom(room);
  await apiFetch("/api/chairman/room", {
    method: "POST",
    body: JSON.stringify({ room }),
  }).catch(() => {});
};
```

- [ ] **Step 3: Add room selector to JSX**

Add after the model selector `<div className="flex flex-col gap-1.5">` block (before the `{/* Info */}` section):

```tsx
{/* Room selector */}
<div className="flex flex-col gap-1.5">
  <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">
    Watched Room
  </label>
  {loadingRooms ? (
    <div className="px-3 py-2 text-xs text-[var(--color-text-dim)]">
      Loading rooms...
    </div>
  ) : (
    <select
      value={currentRoom}
      onChange={(e) => handleRoomChange(e.target.value)}
      className="w-full px-3 py-2 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-amber-500/50 appearance-none cursor-pointer"
    >
      <option value="">— none —</option>
      {rooms.map((r) => (
        <option key={r.name} value={r.name}>
          {r.name}
        </option>
      ))}
    </select>
  )}
  {!currentRoom && (
    <p className="text-[10px] text-amber-400/70">
      Select a room so the Chairman knows which terminals to watch.
    </p>
  )}
</div>
```

- [ ] **Step 4: Verify UI renders**

```bash
cd /Users/jamesking/CascadeProjects/a-nice-terminal/packages/app
pnpm dev
```

Open the Chairman panel (⌘⇧H). Confirm the room dropdown appears and persists selection on re-open.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/ChairmanPanel.tsx
git commit -m "feat: add room selector to ChairmanPanel"
```

---

## Task 3: Protocol Type Extension

Adds `terminal_approval` to the shared protocol types so server and UI agree on the shape.

**Files:**
- Modify: `packages/app/src/utils/protocolTypes.ts`

- [ ] **Step 1: Read the current file**

```bash
cat packages/app/src/utils/protocolTypes.ts
```

- [ ] **Step 2: Add the new type**

Find the `ProtocolType` union and add `"terminal_approval"`. Then add the metadata interface. Example — adapt to match the existing file style:

```typescript
// Add to the ProtocolType union:
| "terminal_approval"

// Add the metadata interface alongside the others:
export interface TerminalApprovalMetadata {
  type: "terminal_approval";
  terminal_id: string;
  terminal_name: string;
  tool_type: string;   // "Bash" | "Edit" | "Write" | "Read" | "WebFetch" | "MultiEdit"
  detail: string;      // the command or file path (max 200 chars)
  prompt_id: string;   // sha1 fingerprint for de-duplication
  status: "pending" | "approved" | "rejected";
}

// Add to the ProtocolMetadata union:
| TerminalApprovalMetadata
```

Also add to `typeIcons` / `protocolLabel` / `protocolAccent` helper maps if they exist in the file — use amber (`#f59e0b`) as the accent for `terminal_approval` to match the Chairman's colour scheme, and `"Terminal Approval"` as the label.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/utils/protocolTypes.ts
git commit -m "feat: add terminal_approval protocol type"
```

---

## Task 4: Terminal Monitor

Polls headless terminal screen lines, detects Claude Code permission prompts, and posts approval cards to the watched chat session.

**Files:**
- Create: `packages/app/server/terminal-monitor.ts`
- Create: `packages/app/server/__tests__/terminal-monitor.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/server/__tests__/terminal-monitor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// Pure logic functions extracted from terminal-monitor — import them directly
import {
  detectPrompt,
  buildPromptId,
  extractToolType,
  extractDetail,
} from "../terminal-monitor.js";

describe("detectPrompt", () => {
  it("returns true for 'Do you want to proceed'", () => {
    const lines = ["Do you want to proceed?", "❯ Yes", "  No"];
    expect(detectPrompt(lines)).toBe(true);
  });

  it("returns true for Allow + Yes selector", () => {
    const lines = ["Allow bash command?", "❯ Yes, allow", "  No, deny"];
    expect(detectPrompt(lines)).toBe(true);
  });

  it("returns true for 'Allow this action'", () => {
    const lines = ["Allow this action?", "❯ Yes"];
    expect(detectPrompt(lines)).toBe(true);
  });

  it("returns false for normal shell output", () => {
    const lines = ["$ npm test", "  Running tests...", "  PASS"];
    expect(detectPrompt(lines)).toBe(false);
  });

  it("returns false for empty screen", () => {
    expect(detectPrompt([])).toBe(false);
  });
});

describe("extractToolType", () => {
  it("extracts Bash", () => {
    const lines = ["Allow bash command?", "Command: rm -rf /tmp/test"];
    expect(extractToolType(lines)).toBe("Bash");
  });

  it("extracts Edit", () => {
    const lines = ["Allow Edit?", "File: src/index.ts"];
    expect(extractToolType(lines)).toBe("Edit");
  });

  it("defaults to Unknown", () => {
    const lines = ["Do you want to proceed?"];
    expect(extractToolType(lines)).toBe("Unknown");
  });
});

describe("extractDetail", () => {
  it("returns the line after the tool type line", () => {
    const lines = ["Allow bash command?", "rm -rf /tmp/build", "❯ Yes"];
    expect(extractDetail(lines, "Bash")).toBe("rm -rf /tmp/build");
  });

  it("truncates to 200 chars", () => {
    const long = "x".repeat(300);
    const lines = ["Allow bash command?", long];
    expect(extractDetail(lines, "Bash").length).toBeLessThanOrEqual(200);
  });

  it("returns empty string when no detail found", () => {
    const lines = ["Do you want to proceed?"];
    expect(extractDetail(lines, "Unknown")).toBe("");
  });
});

describe("buildPromptId", () => {
  it("returns a 12-char hex string", () => {
    const id = buildPromptId("sess1", "Bash", "rm -rf");
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic", () => {
    const a = buildPromptId("s", "Bash", "cmd");
    const b = buildPromptId("s", "Bash", "cmd");
    expect(a).toBe(b);
  });

  it("differs for different inputs", () => {
    expect(buildPromptId("s", "Bash", "cmd1")).not.toBe(buildPromptId("s", "Bash", "cmd2"));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/jamesking/CascadeProjects/a-nice-terminal/packages/app
pnpm test -- --reporter=verbose server/__tests__/terminal-monitor.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `terminal-monitor.ts`**

Create `packages/app/server/terminal-monitor.ts`:

```typescript
/**
 * Terminal Monitor — polls headless terminal screen lines for Claude Code
 * permission prompts and posts terminal_approval cards to the watched
 * chairman chat session.
 *
 * Started/stopped by chairman-bridge alongside the chat routing loop.
 * Reads chairman_enabled + chairman_session + chairman_room from server_state
 * on every cycle — no restart needed to reconfigure.
 */

import crypto from "crypto";
import db from "./db.js";
import { getHeadless, getTerminalOutputCursor } from "./pty-manager.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const POLL_INTERVAL_MS = parseInt(process.env.TERMINAL_MONITOR_POLL_MS || "2000", 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";

// ─── Pure helper functions (exported for tests) ──────────────────────────────

const PROMPT_PATTERNS = [
  "Do you want to proceed",
  "Allow this action",
  "Allow bash",
  "Allow tool",
];

const TOOL_NAMES = ["Bash", "Edit", "Write", "Read", "WebFetch", "MultiEdit"];

export function detectPrompt(lines: string[]): boolean {
  const screen = lines.join("\n");
  const hasPromptText = PROMPT_PATTERNS.some((p) => screen.includes(p));
  const hasYesOption =
    screen.includes("❯ Yes") ||
    screen.includes("❯ Yes, allow") ||
    screen.includes("Allow") && screen.includes("❯");
  return hasPromptText || hasYesOption;
}

export function extractToolType(lines: string[]): string {
  const screen = lines.join(" ");
  for (const tool of TOOL_NAMES) {
    if (screen.toLowerCase().includes(tool.toLowerCase())) return tool;
  }
  return "Unknown";
}

export function extractDetail(lines: string[], toolType: string): string {
  const toolIdx = lines.findIndex((l) =>
    l.toLowerCase().includes(toolType.toLowerCase())
  );
  if (toolIdx === -1 || toolIdx + 1 >= lines.length) return "";
  const detail = lines[toolIdx + 1].trim();
  return detail.slice(0, 200);
}

export function buildPromptId(sessionId: string, toolType: string, detail: string): string {
  return crypto
    .createHash("sha1")
    .update(`${sessionId}:${toolType}:${detail}`)
    .digest("hex")
    .slice(0, 12);
}

// ─── Settings helpers ────────────────────────────────────────────────────────

function getSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM server_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function isEnabled(): boolean {
  return getSetting("chairman_enabled", "0") === "1";
}

function getSessionId(): string | null {
  return getSetting("chairman_session", "") || null;
}

function getRoomName(): string | null {
  return getSetting("chairman_room", "") || null;
}

// ─── Participant lookup ──────────────────────────────────────────────────────

interface Participant {
  terminalSessionId: string;
  agentName: string;
}

async function getRoomParticipants(roomName: string): Promise<Participant[]> {
  try {
    const res = await fetch(`${ANT_URL}/api/chat-rooms/${encodeURIComponent(roomName)}/participants`);
    if (!res.ok) return [];
    return (await res.json()) as Participant[];
  } catch {
    return [];
  }
}

// ─── Post approval card ──────────────────────────────────────────────────────

async function postApprovalCard(
  sessionId: string,
  terminalId: string,
  terminalName: string,
  toolType: string,
  detail: string,
  promptId: string,
): Promise<void> {
  await fetch(`${ANT_URL}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "agent",
      content: `**@Chatlead** — Terminal approval required\n\n**${toolType}**: \`${detail || "(no detail)"}\`\n\nUse the card below to respond.`,
      format: "markdown",
      status: "complete",
      sender_name: CHAIRMAN_NAME,
      sender_type: "agent",
      metadata: {
        type: "terminal_approval",
        terminal_id: terminalId,
        terminal_name: terminalName,
        tool_type: toolType,
        detail,
        prompt_id: promptId,
        status: "pending",
      },
    }),
  });
}

// ─── State ───────────────────────────────────────────────────────────────────

const seenPrompts = new Set<string>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let busy = false;

// ─── Poll ────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionId = getSessionId();
  const roomName = getRoomName();
  if (!sessionId || !roomName) return;

  busy = true;
  try {
    const participants = await getRoomParticipants(roomName);

    for (const { terminalSessionId, agentName } of participants) {
      const headless = getHeadless(terminalSessionId);
      if (!headless) continue;

      const lines = headless.getScreenLines();
      if (!detectPrompt(lines)) continue;

      const toolType = extractToolType(lines);
      const detail = extractDetail(lines, toolType);
      const promptId = buildPromptId(terminalSessionId, toolType, detail);

      if (seenPrompts.has(promptId)) continue;
      seenPrompts.add(promptId);

      await postApprovalCard(sessionId, terminalSessionId, agentName, toolType, detail, promptId);
      console.log(`[terminal-monitor] Approval card posted for ${agentName}: ${toolType} — ${detail.slice(0, 50)}`);
    }
  } catch (err) {
    console.warn("[terminal-monitor] Poll error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startTerminalMonitor(): void {
  if (intervalHandle) return;
  console.log(`[terminal-monitor] Starting (poll every ${POLL_INTERVAL_MS}ms)`);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopTerminalMonitor(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[terminal-monitor] Stopped");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose server/__tests__/terminal-monitor.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/server/terminal-monitor.ts packages/app/server/__tests__/terminal-monitor.test.ts
git commit -m "feat: add terminal-monitor with prompt detection"
```

---

## Task 5: Terminal Action Endpoint

Handles Approve/Reject/View actions from the chat card, writes to the PTY, and patches the message status.

**Files:**
- Modify: `packages/app/server/routes/chairman.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/app/server/__tests__/chairman-routes.test.ts`:

```typescript
import { vi } from "vitest";

vi.mock("../pty-manager.js", () => ({
  getPty: vi.fn(),
  getHeadless: vi.fn(),
}));

import { getPty, getHeadless } from "../pty-manager.js";

// Add inside the describe block or as a new describe:
describe("POST /api/chairman/terminal-action", () => {
  beforeEach(() => {
    // Seed a conversation session and a pending terminal_approval message
    testDb.prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)").run(
      "chat-sess", "Chat", "conversation"
    );
    testDb.prepare(
      "INSERT INTO messages (id, session_id, role, content, format, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(
      "msg-1", "chat-sess", "agent", "Approval required", "markdown", "complete",
      JSON.stringify({ type: "terminal_approval", status: "pending" })
    );
  });

  it("approve: writes y\\n to PTY and patches message status", async () => {
    const mockWrite = vi.fn();
    vi.mocked(getPty).mockReturnValue({ write: mockWrite } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "approve", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("y\n");
    const msg = testDb.prepare("SELECT metadata FROM messages WHERE id = 'msg-1'").get() as any;
    expect(JSON.parse(msg.metadata).status).toBe("approved");
  });

  it("reject: writes n\\n to PTY and patches message status", async () => {
    const mockWrite = vi.fn();
    vi.mocked(getPty).mockReturnValue({ write: mockWrite } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "reject", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(200);
    expect(mockWrite).toHaveBeenCalledWith("n\n");
    const msg = testDb.prepare("SELECT metadata FROM messages WHERE id = 'msg-1'").get() as any;
    expect(JSON.parse(msg.metadata).status).toBe("rejected");
  });

  it("returns 409 when message already resolved", async () => {
    testDb.prepare("UPDATE messages SET metadata = ? WHERE id = 'msg-1'").run(
      JSON.stringify({ type: "terminal_approval", status: "approved" })
    );
    vi.mocked(getPty).mockReturnValue({ write: vi.fn() } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "approve", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(409);
  });

  it("returns 404 when PTY not found", async () => {
    vi.mocked(getPty).mockReturnValue(undefined);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "missing", action: "approve", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(404);
  });

  it("view: returns screen lines without writing to PTY", async () => {
    vi.mocked(getHeadless).mockReturnValue({
      getScreenLines: () => ["line 1", "line 2"],
    } as any);

    const res = await supertest(createApp())
      .post("/api/chairman/terminal-action")
      .send({ terminal_id: "term-1", action: "view", message_id: "msg-1", session_id: "chat-sess" });

    expect(res.status).toBe(200);
    expect(res.body.lines).toEqual(["line 1", "line 2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --reporter=verbose server/__tests__/chairman-routes.test.ts
```

Expected: FAIL — endpoint not found.

- [ ] **Step 3: Implement the endpoint**

Add to `packages/app/server/routes/chairman.ts`:

```typescript
import { getPty, getHeadless } from "../pty-manager.js";

// POST /api/chairman/terminal-action
router.post("/api/chairman/terminal-action", (req, res) => {
  const { terminal_id, action, message_id, session_id } = req.body;

  if (!terminal_id || !action || !message_id || !session_id) {
    return res.status(400).json({ error: "terminal_id, action, message_id, session_id required" });
  }
  if (!["approve", "reject", "view"].includes(action)) {
    return res.status(400).json({ error: "action must be approve, reject, or view" });
  }

  // For approve/reject: check message is still pending
  if (action !== "view") {
    const msgRow = db
      .prepare("SELECT metadata FROM messages WHERE id = ? AND session_id = ?")
      .get(message_id, session_id) as { metadata: string } | undefined;

    if (!msgRow) return res.status(404).json({ error: "Message not found" });

    const meta = JSON.parse(msgRow.metadata || "{}");
    if (meta.status && meta.status !== "pending") {
      return res.status(409).json({ error: "Already resolved" });
    }

    const pty = getPty(terminal_id);
    if (!pty) return res.status(404).json({ error: "Terminal not found" });

    try {
      pty.write(action === "approve" ? "y\n" : "n\n");
    } catch {
      return res.status(502).json({ error: "Terminal write failed" });
    }

    const newStatus = action === "approve" ? "approved" : "rejected";
    const newMeta = JSON.stringify({ ...meta, status: newStatus });
    db.prepare("UPDATE messages SET metadata = ? WHERE id = ?").run(newMeta, message_id);

    // Emit socket event to live-update the card in all open browsers
    const io = req.app.get("io");
    if (io) {
      io.to(session_id).emit("message_updated", {
        messageId: message_id,
        metadata: { ...meta, status: newStatus },
      });
    }

    return res.json({ ok: true, status: newStatus });
  }

  // view: return current screen lines
  const headless = getHeadless(terminal_id);
  if (!headless) return res.status(404).json({ error: "Terminal not found" });

  return res.json({ lines: headless.getScreenLines() });
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose server/__tests__/chairman-routes.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/server/routes/chairman.ts packages/app/server/__tests__/chairman-routes.test.ts
git commit -m "feat: add terminal-action endpoint (approve/reject/view)"
```

---

## Task 6: TerminalApprovalCard Component

Interactive card rendered when a message has `metadata.type === "terminal_approval"`.

**Files:**
- Create: `packages/app/src/components/TerminalApprovalCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
/**
 * TerminalApprovalCard — rendered in MessageBubble when
 * metadata.type === "terminal_approval".
 *
 * Shows tool type, command detail, and three action buttons.
 * After approve/reject, buttons are replaced by a resolved badge.
 * View expands an inline terminal screenshot below the buttons.
 */
import { useState } from "react";
import { Terminal, Check, X, Eye, Loader2 } from "lucide-react";
import { apiFetch } from "../store.ts";
import type { TerminalApprovalMetadata } from "../utils/protocolTypes.ts";

interface TerminalApprovalCardProps {
  metadata: TerminalApprovalMetadata;
  messageId: string;
  sessionId: string;
}

export default function TerminalApprovalCard({
  metadata,
  messageId,
  sessionId,
}: TerminalApprovalCardProps) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(metadata.status);
  const [loading, setLoading] = useState<"approve" | "reject" | "view" | null>(null);
  const [screenLines, setScreenLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: "approve" | "reject" | "view") {
    setLoading(action);
    setError(null);
    try {
      const res = await apiFetch("/api/chairman/terminal-action", {
        method: "POST",
        body: JSON.stringify({
          terminal_id: metadata.terminal_id,
          action,
          message_id: messageId,
          session_id: sessionId,
        }),
      });
      if (action === "view") {
        setScreenLines(res.lines ?? []);
      } else {
        setStatus(action === "approve" ? "approved" : "rejected");
      }
    } catch (err: any) {
      setError(err.message ?? "Action failed");
    } finally {
      setLoading(null);
    }
  }

  const accent = "#f59e0b"; // amber — matches Chairman colour scheme

  return (
    <div
      className="rounded-lg border px-3 py-2 mt-2 text-xs"
      style={{ borderColor: `${accent}33`, backgroundColor: `${accent}0a` }}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Terminal style={{ width: 14, height: 14, color: accent }} />
        <span
          className="uppercase tracking-wider font-medium"
          style={{ color: accent, fontSize: 10 }}
        >
          Terminal Approval
        </span>
        <span
          className={`ml-auto px-1.5 py-0.5 rounded text-[9px] font-medium ${
            status === "pending"
              ? "bg-amber-500/20 text-amber-300"
              : status === "approved"
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-red-500/20 text-red-300"
          }`}
        >
          {status.toUpperCase()}
        </span>
      </div>

      {/* Tool + detail */}
      <div className="mb-2">
        <span className="font-mono text-white/50 mr-1.5">{metadata.tool_type}</span>
        {metadata.detail && (
          <code className="text-white/70 break-all">{metadata.detail}</code>
        )}
        <div className="text-white/30 text-[10px] mt-0.5">{metadata.terminal_name}</div>
      </div>

      {/* Actions */}
      {status === "pending" ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction("approve")}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 transition-colors"
          >
            {loading === "approve" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Approve
          </button>
          <button
            onClick={() => handleAction("reject")}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 disabled:opacity-40 transition-colors"
          >
            {loading === "reject" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <X className="w-3 h-3" />
            )}
            Reject
          </button>
          <button
            onClick={() => handleAction("view")}
            disabled={loading !== null}
            className="flex items-center gap-1 px-2 py-1 rounded bg-white/5 text-white/50 hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            {loading === "view" ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Eye className="w-3 h-3" />
            )}
            View
          </button>
        </div>
      ) : (
        <div className={`flex items-center gap-1.5 ${status === "approved" ? "text-emerald-300" : "text-red-300"}`}>
          {status === "approved" ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
          <span className="text-[11px] font-medium">
            {status === "approved" ? "Approved" : "Rejected"}
          </span>
        </div>
      )}

      {/* Inline error */}
      {error && (
        <div className="mt-2 text-[10px] text-red-400">{error} — try again</div>
      )}

      {/* Screen snapshot (view action) */}
      {screenLines && screenLines.length > 0 && (
        <pre className="mt-2 p-2 bg-black/40 rounded text-[10px] text-white/60 font-mono overflow-x-auto max-h-48 overflow-y-auto leading-snug">
          {screenLines.join("\n")}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/TerminalApprovalCard.tsx
git commit -m "feat: add TerminalApprovalCard component"
```

---

## Task 7: MessageBubble Integration

Wire `TerminalApprovalCard` into the existing message rendering.

**Files:**
- Modify: `packages/app/src/components/MessageBubble.tsx`

- [ ] **Step 1: Add import**

At the top of `MessageBubble.tsx`, add alongside the other component imports:

```typescript
import TerminalApprovalCard from "./TerminalApprovalCard.tsx";
```

- [ ] **Step 2: Add render**

Find the block:
```tsx
{/* Protocol card — rendered when metadata is a structured protocol message */}
{isProtocolMessage(message.metadata) && (
  <ProtocolCard metadata={message.metadata} />
)}
```

Add immediately after it:

```tsx
{/* Terminal approval card */}
{message.metadata?.type === "terminal_approval" && (
  <TerminalApprovalCard
    metadata={message.metadata as any}
    messageId={message.id}
    sessionId={sessionId}
  />
)}
```

- [ ] **Step 3: Handle socket message_updated**

The `useStore` needs to handle the `message_updated` socket event to update card state live. Find where socket events are handled in `store.ts` (grep for `socket.on`) and add:

```typescript
socket.on("message_updated", ({ messageId, metadata }: { messageId: string; metadata: any }) => {
  set((s) => ({
    messages: s.messages.map((m) =>
      m.id === messageId ? { ...m, metadata } : m
    ),
  }));
});
```

- [ ] **Step 4: Verify in browser**

Start dev server, open a chat session, manually POST a `terminal_approval` message with `status: "pending"` using curl:

```bash
curl -s -X POST http://localhost:${ANT_PORT:-6458}/api/sessions/RbL8N2Aco2qH/messages \
  -H "Content-Type: application/json" \
  -d '{
    "role": "agent",
    "content": "Test approval card",
    "format": "markdown",
    "status": "complete",
    "sender_name": "@Chatlead",
    "sender_type": "agent",
    "metadata": {
      "type": "terminal_approval",
      "terminal_id": "test-term",
      "terminal_name": "Test Terminal",
      "tool_type": "Bash",
      "detail": "rm -rf /tmp/test",
      "prompt_id": "abc123def456",
      "status": "pending"
    }
  }'
```

Confirm the card renders in chat with Approve/Reject/View buttons.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/MessageBubble.tsx packages/app/src/store.ts
git commit -m "feat: render TerminalApprovalCard in MessageBubble + live socket updates"
```

---

## Task 8: Message Bridge

Polls chat for new human @mention messages and injects raw content into the addressed agent's terminal when it wasn't received.

**Files:**
- Create: `packages/app/server/message-bridge.ts`
- Create: `packages/app/server/__tests__/message-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/server/__tests__/message-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  extractMentions,
  shouldInject,
} from "../message-bridge.js";

describe("extractMentions", () => {
  it("extracts @handles from message content", () => {
    expect(extractMentions("Hey @ANTClaude fix this")).toEqual(["@ANTClaude"]);
  });

  it("extracts multiple handles", () => {
    expect(extractMentions("@ANTClaude and @ANTGem both look at this")).toEqual([
      "@ANTClaude",
      "@ANTGem",
    ]);
  });

  it("returns empty array for no mentions", () => {
    expect(extractMentions("just a plain message")).toEqual([]);
  });

  it("is case-insensitive on the @ prefix", () => {
    expect(extractMentions("hi @antclaude")).toEqual(["@antclaude"]);
  });
});

describe("shouldInject", () => {
  it("returns true when terminal cursor has not advanced", () => {
    expect(shouldInject(5, 5)).toBe(true);
  });

  it("returns false when terminal cursor has advanced (agent received it)", () => {
    expect(shouldInject(5, 10)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --reporter=verbose server/__tests__/message-bridge.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `message-bridge.ts`**

Create `packages/app/server/message-bridge.ts`:

```typescript
/**
 * Message Bridge — polls the chairman chat session for new human messages
 * that @mention an agent. If the addressed agent's terminal has not produced
 * new output within the grace period, injects the raw message content into
 * the terminal so the agent is guaranteed to receive it.
 */

import db from "./db.js";
import { getPty, getTerminalOutputCursor } from "./pty-manager.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const POLL_INTERVAL_MS = parseInt(process.env.MESSAGE_BRIDGE_POLL_MS || "3000", 10);
const GRACE_PERIOD_MS = parseInt(process.env.MESSAGE_BRIDGE_GRACE_MS || "6000", 10);

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function extractMentions(content: string): string[] {
  const matches = content.match(/@[\w]+/g);
  return matches ?? [];
}

export function shouldInject(cursorAtSend: number, cursorNow: number): boolean {
  return cursorNow <= cursorAtSend;
}

// ─── Settings ────────────────────────────────────────────────────────────────

function getSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM server_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function isEnabled(): boolean {
  return getSetting("chairman_enabled", "0") === "1";
}

function getSessionId(): string | null {
  return getSetting("chairman_session", "") || null;
}

function getRoomName(): string | null {
  return getSetting("chairman_room", "") || null;
}

// ─── Participant lookup ──────────────────────────────────────────────────────

interface Participant {
  terminalSessionId: string;
  agentName: string;
}

async function getRoomParticipants(roomName: string): Promise<Participant[]> {
  try {
    const res = await fetch(
      `${ANT_URL}/api/chat-rooms/${encodeURIComponent(roomName)}/participants`
    );
    if (!res.ok) return [];
    return (await res.json()) as Participant[];
  } catch {
    return [];
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

const injectedMessageIds = new Set<string>();
let lastSeenAt: string | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let busy = false;

// ─── Poll ────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionId = getSessionId();
  const roomName = getRoomName();
  if (!sessionId || !roomName) return;

  busy = true;
  try {
    const url = lastSeenAt
      ? `${ANT_URL}/api/sessions/${sessionId}/messages?since=${encodeURIComponent(lastSeenAt)}`
      : `${ANT_URL}/api/sessions/${sessionId}/messages`;

    const res = await fetch(url);
    if (!res.ok) return;

    const messages: Array<{ id: string; role: string; content: string; created_at: string; sender_type: string }> =
      await res.json();

    if (messages.length === 0) return;
    lastSeenAt = messages[messages.length - 1].created_at;

    const participants = await getRoomParticipants(roomName);

    for (const msg of messages) {
      if (msg.role !== "human") continue;
      if (injectedMessageIds.has(msg.id)) continue;

      const mentions = extractMentions(msg.content);
      if (mentions.length === 0) continue;

      for (const mention of mentions) {
        const participant = participants.find(
          (p) => p.agentName.toLowerCase() === mention.toLowerCase()
        );
        if (!participant) continue;

        const cursorAtSend = getTerminalOutputCursor(participant.terminalSessionId);

        // Wait grace period then check if cursor advanced
        await new Promise((r) => setTimeout(r, GRACE_PERIOD_MS));

        const cursorNow = getTerminalOutputCursor(participant.terminalSessionId);

        if (!shouldInject(cursorAtSend, cursorNow)) {
          // Agent's terminal produced output — message was likely received
          continue;
        }

        // Inject raw message content into terminal
        const pty = getPty(participant.terminalSessionId);
        if (!pty) continue;

        try {
          pty.write(msg.content + "\n");
          console.log(
            `[message-bridge] Injected message ${msg.id} into ${participant.agentName}'s terminal`
          );
        } catch (err) {
          console.warn("[message-bridge] Inject failed:", err instanceof Error ? err.message : err);
        }
      }

      injectedMessageIds.add(msg.id);
    }
  } catch (err) {
    console.warn("[message-bridge] Poll error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startMessageBridge(): void {
  if (intervalHandle) return;
  console.log(`[message-bridge] Starting (poll every ${POLL_INTERVAL_MS}ms)`);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopMessageBridge(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[message-bridge] Stopped");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose server/__tests__/message-bridge.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/server/message-bridge.ts packages/app/server/__tests__/message-bridge.test.ts
git commit -m "feat: add message-bridge for chat→terminal injection"
```

---

## Task 9: Task Watchdog

Tracks in-progress task assignments, detects idle terminals, and nudges agents in both chat and their terminal.

**Files:**
- Create: `packages/app/server/task-watchdog.ts`
- Create: `packages/app/server/__tests__/task-watchdog.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/app/server/__tests__/task-watchdog.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isIdleOnTask,
  needsStartNudge,
  needsSilentNudge,
} from "../task-watchdog.js";

const FIVE_MIN = 5 * 60 * 1000;
const THREE_MIN = 3 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;

describe("isIdleOnTask", () => {
  it("returns true when cursor unchanged for over idle threshold", () => {
    const assignedAt = new Date(Date.now() - FIVE_MIN - 1000);
    expect(isIdleOnTask(10, 10, assignedAt, FIVE_MIN)).toBe(true);
  });

  it("returns false when cursor has advanced", () => {
    const assignedAt = new Date(Date.now() - FIVE_MIN - 1000);
    expect(isIdleOnTask(10, 15, assignedAt, FIVE_MIN)).toBe(false);
  });

  it("returns false when not enough time has passed", () => {
    const assignedAt = new Date(Date.now() - 1000); // just 1 second ago
    expect(isIdleOnTask(10, 10, assignedAt, FIVE_MIN)).toBe(false);
  });
});

describe("needsStartNudge", () => {
  it("returns true for todo task assigned more than threshold ago", () => {
    const assignedAt = new Date(Date.now() - THREE_MIN - 1000);
    expect(needsStartNudge("todo", assignedAt, THREE_MIN)).toBe(true);
  });

  it("returns false for in_progress task", () => {
    const assignedAt = new Date(Date.now() - THREE_MIN - 1000);
    expect(needsStartNudge("in_progress", assignedAt, THREE_MIN)).toBe(false);
  });

  it("returns false if assigned recently", () => {
    const assignedAt = new Date(Date.now() - 1000);
    expect(needsStartNudge("todo", assignedAt, THREE_MIN)).toBe(false);
  });
});

describe("needsSilentNudge", () => {
  it("returns true when terminal active but no chat update in threshold", () => {
    const lastChatAt = new Date(Date.now() - FIFTEEN_MIN - 1000);
    expect(needsSilentNudge(10, 20, lastChatAt, FIFTEEN_MIN)).toBe(true);
  });

  it("returns false when terminal has not advanced (agent is idle)", () => {
    const lastChatAt = new Date(Date.now() - FIFTEEN_MIN - 1000);
    expect(needsSilentNudge(10, 10, lastChatAt, FIFTEEN_MIN)).toBe(false);
  });

  it("returns false when agent posted recently", () => {
    const lastChatAt = new Date(Date.now() - 1000);
    expect(needsSilentNudge(10, 20, lastChatAt, FIFTEEN_MIN)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- --reporter=verbose server/__tests__/task-watchdog.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `task-watchdog.ts`**

Create `packages/app/server/task-watchdog.ts`:

```typescript
/**
 * Task Watchdog — monitors in-progress task assignments, detects idle agents,
 * and nudges them in both chat and their terminal.
 *
 * Gap detection:
 * - Idle in_progress task: terminal cursor hasn't advanced in IDLE_MS
 * - Unstarted assignment: todo task with assigned_name older than UNSTARTED_MS
 * - Silent agent: terminal active but no chat message in SILENT_MS
 */

import db from "./db.js";
import { getPty, getTerminalOutputCursor } from "./pty-manager.js";

const ANT_URL = `http://localhost:${process.env.ANT_PORT || "6458"}`;
const POLL_INTERVAL_MS = parseInt(process.env.WATCHDOG_POLL_MS || "30000", 10);
const IDLE_MS = parseInt(process.env.WATCHDOG_IDLE_MS || String(5 * 60 * 1000), 10);
const UNSTARTED_MS = parseInt(process.env.WATCHDOG_UNSTARTED_MS || String(3 * 60 * 1000), 10);
const SILENT_MS = parseInt(process.env.WATCHDOG_SILENT_MS || String(15 * 60 * 1000), 10);
const COOLDOWN_MS = parseInt(process.env.WATCHDOG_COOLDOWN_MS || String(10 * 60 * 1000), 10);
const CHAIRMAN_NAME = process.env.CHAIRMAN_NAME || "@Chatlead";

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

export function isIdleOnTask(
  cursorAtAssign: number,
  cursorNow: number,
  assignedAt: Date,
  idleThresholdMs: number
): boolean {
  const elapsed = Date.now() - assignedAt.getTime();
  return elapsed >= idleThresholdMs && cursorNow <= cursorAtAssign;
}

export function needsStartNudge(
  status: string,
  assignedAt: Date,
  unstartedThresholdMs: number
): boolean {
  if (status !== "todo") return false;
  return Date.now() - assignedAt.getTime() >= unstartedThresholdMs;
}

export function needsSilentNudge(
  cursorAtLastNudge: number,
  cursorNow: number,
  lastChatAt: Date,
  silentThresholdMs: number
): boolean {
  const terminalActive = cursorNow > cursorAtLastNudge;
  const noRecentChat = Date.now() - lastChatAt.getTime() >= silentThresholdMs;
  return terminalActive && noRecentChat;
}

// ─── Settings ────────────────────────────────────────────────────────────────

function getSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM server_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

function isEnabled(): boolean {
  return getSetting("chairman_enabled", "0") === "1";
}

function getSessionId(): string | null {
  return getSetting("chairman_session", "") || null;
}

function getRoomName(): string | null {
  return getSetting("chairman_room", "") || null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface WatchedTask {
  taskId: string;
  assignedHandle: string;
  terminalSessionId: string;
  assignedAt: Date;
  cursorAtAssign: number;
  nudgedAt: Date | null;
  cursorAtLastNudge: number;
  lastChatAt: Date;
}

interface Participant {
  terminalSessionId: string;
  agentName: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

const watchedTasks = new Map<string, WatchedTask>();
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let busy = false;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getRoomParticipants(roomName: string): Promise<Participant[]> {
  try {
    const res = await fetch(
      `${ANT_URL}/api/chat-rooms/${encodeURIComponent(roomName)}/participants`
    );
    if (!res.ok) return [];
    return (await res.json()) as Participant[];
  } catch {
    return [];
  }
}

async function postChat(sessionId: string, content: string): Promise<void> {
  await fetch(`${ANT_URL}/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      role: "agent",
      content,
      format: "markdown",
      status: "complete",
      sender_name: CHAIRMAN_NAME,
      sender_type: "agent",
    }),
  });
}

function injectTerminal(terminalSessionId: string, text: string): void {
  const pty = getPty(terminalSessionId);
  if (!pty) return;
  try {
    pty.write(text + "\n");
  } catch {
    // Terminal may have closed — ignore
  }
}

function minutesAgo(ms: number): string {
  return `${Math.round(ms / 60000)} min${ms >= 120000 ? "s" : ""}`;
}

function canNudge(task: WatchedTask): boolean {
  if (!task.nudgedAt) return true;
  return Date.now() - task.nudgedAt.getTime() >= COOLDOWN_MS;
}

function getLastAgentChatTime(sessionId: string, agentHandle: string): Date {
  const row = db
    .prepare(
      `SELECT created_at FROM messages
       WHERE session_id = ? AND sender_name = ?
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(sessionId, agentHandle) as { created_at: string } | undefined;
  return row ? new Date(row.created_at + "Z") : new Date(0);
}

// ─── Poll ────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (busy) return;
  if (!isEnabled()) return;

  const sessionId = getSessionId();
  const roomName = getRoomName();
  if (!sessionId || !roomName) return;

  busy = true;
  try {
    const participants = await getRoomParticipants(roomName);
    const participantMap = new Map(participants.map((p) => [p.agentName.toLowerCase(), p]));

    // Load active tasks with assignees
    type DbTask = {
      id: string;
      title: string;
      status: string;
      assigned_name: string | null;
      updated_at: string;
    };
    const tasks = db
      .prepare(
        "SELECT id, title, status, assigned_name, updated_at FROM tasks WHERE assigned_name IS NOT NULL AND status != 'done'"
      )
      .all() as DbTask[];

    for (const task of tasks) {
      const handle = task.assigned_name!;
      const participant = participantMap.get(handle.replace("@", "").toLowerCase()) ??
        participantMap.get(handle.toLowerCase());
      if (!participant) continue;

      const cursorNow = getTerminalOutputCursor(participant.terminalSessionId);
      const elapsed = Date.now() - new Date(task.updated_at + "Z").getTime();

      // Register new task
      if (!watchedTasks.has(task.id)) {
        watchedTasks.set(task.id, {
          taskId: task.id,
          assignedHandle: handle,
          terminalSessionId: participant.terminalSessionId,
          assignedAt: new Date(task.updated_at + "Z"),
          cursorAtAssign: cursorNow,
          nudgedAt: null,
          cursorAtLastNudge: cursorNow,
          lastChatAt: getLastAgentChatTime(sessionId, handle),
        });
        continue;
      }

      const watched = watchedTasks.get(task.id)!;
      if (!canNudge(watched)) continue;

      // Remove task from watch if done
      if (task.status === "done") {
        watchedTasks.delete(task.id);
        continue;
      }

      const elapsedMsg = minutesAgo(elapsed);

      // 1. Idle on in_progress task
      if (
        task.status === "in_progress" &&
        isIdleOnTask(watched.cursorAtAssign, cursorNow, watched.assignedAt, IDLE_MS)
      ) {
        const chatMsg = `**[@Chatlead]** ${handle} — \`${task.title}\` has been in_progress for ${elapsedMsg} with no terminal activity. Working on it?`;
        const termMsg = `[Chatlead] Task "${task.title}" (in_progress ${elapsedMsg}) — please post a status update in chat.`;
        await postChat(sessionId, chatMsg);
        injectTerminal(participant.terminalSessionId, termMsg);
        watched.nudgedAt = new Date();
        watched.cursorAtLastNudge = cursorNow;
        console.log(`[task-watchdog] Nudged ${handle} on task ${task.id} (idle)`);
        continue;
      }

      // 2. Unstarted assignment
      if (needsStartNudge(task.status, watched.assignedAt, UNSTARTED_MS)) {
        const chatMsg = `**[@Chatlead]** ${handle} — \`${task.title}\` was assigned ${elapsedMsg} ago but hasn't been started. Ready to begin?`;
        const termMsg = `[Chatlead] Task "${task.title}" assigned ${elapsedMsg} ago — please start when ready.`;
        await postChat(sessionId, chatMsg);
        injectTerminal(participant.terminalSessionId, termMsg);
        watched.nudgedAt = new Date();
        console.log(`[task-watchdog] Nudged ${handle} on task ${task.id} (unstarted)`);
        continue;
      }

      // 3. Terminal active but no chat update
      const lastChatAt = getLastAgentChatTime(sessionId, handle);
      if (needsSilentNudge(watched.cursorAtLastNudge, cursorNow, lastChatAt, SILENT_MS)) {
        const chatMsg = `**[@Chatlead]** ${handle} — terminal shows activity on \`${task.title}\` but no chat update in ${minutesAgo(SILENT_MS)}. How's it going?`;
        await postChat(sessionId, chatMsg);
        watched.nudgedAt = new Date();
        watched.cursorAtLastNudge = cursorNow;
        watched.lastChatAt = lastChatAt;
        console.log(`[task-watchdog] Nudged ${handle} on task ${task.id} (silent)`);
      }
    }

    // Clean up tasks no longer in DB
    for (const taskId of watchedTasks.keys()) {
      if (!tasks.find((t) => t.id === taskId)) {
        watchedTasks.delete(taskId);
      }
    }
  } catch (err) {
    console.warn("[task-watchdog] Poll error:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export function startTaskWatchdog(): void {
  if (intervalHandle) return;
  console.log(`[task-watchdog] Starting (poll every ${POLL_INTERVAL_MS}ms)`);
  intervalHandle = setInterval(poll, POLL_INTERVAL_MS);
  poll().catch(() => {});
}

export function stopTaskWatchdog(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log("[task-watchdog] Stopped");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- --reporter=verbose server/__tests__/task-watchdog.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/server/task-watchdog.ts packages/app/server/__tests__/task-watchdog.test.ts
git commit -m "feat: add task-watchdog with idle detection and nudging"
```

---

## Task 10: Wire Everything in Chairman Bridge

Start and stop all three new modules as part of the existing chairman bridge lifecycle.

**Files:**
- Modify: `packages/app/server/chairman-bridge.ts`

- [ ] **Step 1: Add imports**

At the top of `chairman-bridge.ts`, after the existing imports:

```typescript
import { startTerminalMonitor, stopTerminalMonitor } from "./terminal-monitor.js";
import { startMessageBridge, stopMessageBridge } from "./message-bridge.js";
import { startTaskWatchdog, stopTaskWatchdog } from "./task-watchdog.js";
```

- [ ] **Step 2: Start modules in `startChairmanBridge`**

Find the `export function startChairmanBridge(): void` function. After the existing `if (intervalHandle) return;` guard, add:

```typescript
startTerminalMonitor();
startMessageBridge();
startTaskWatchdog();
```

- [ ] **Step 3: Stop modules in `stopChairmanBridge`**

Find the `export function stopChairmanBridge(): void` function. Add before or after the existing stop logic:

```typescript
stopTerminalMonitor();
stopMessageBridge();
stopTaskWatchdog();
```

- [ ] **Step 4: Run the full test suite to check nothing broke**

```bash
cd /Users/jamesking/CascadeProjects/a-nice-terminal/packages/app
pnpm test
```

Expected: All existing tests plus the new ones PASS. Zero regressions.

- [ ] **Step 5: Smoke test end-to-end**

```bash
pnpm dev
```

Open the Chairman panel (⌘⇧H):
1. Select the LM Studio model
2. Select "ChatV2" from the room dropdown
3. Enable the Chairman (toggle to Active)

Confirm server logs show:
```
[terminal-monitor] Starting (poll every 2000ms)
[message-bridge] Starting (poll every 3000ms)
[task-watchdog] Starting (poll every 30000ms)
```

Disable and confirm logs show all three stopped.

- [ ] **Step 6: Commit**

```bash
git add packages/app/server/chairman-bridge.ts
git commit -m "feat: wire terminal-monitor, message-bridge, task-watchdog into chairman lifecycle"
```

---

## Task 11: Post in Chat — Set Chairman Session via Panel

The existing API for `/api/chairman/session` is already wired. Make sure ChairmanPanel also exposes the session selector so users don't need to call the API manually.

**Files:**
- Modify: `packages/app/src/components/ChairmanPanel.tsx`

- [ ] **Step 1: Add session state**

Add after the `currentRoom` state:

```typescript
const [currentSession, setCurrentSession] = useState("");
const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>([]);
```

- [ ] **Step 2: Load sessions in useEffect**

In the existing `useEffect`, also set session from status and load sessions:

```typescript
// Already setting currentRoom from status — add:
setCurrentSession(data.session ?? "");

// Load available conversation sessions:
apiFetch("/api/sessions?type=conversation")
  .then((data: Array<{ id: string; name: string }>) => {
    setSessions(data.filter((s: any) => s.type === "conversation" || !s.type));
  })
  .catch(() => {});
```

- [ ] **Step 3: Add handleSessionChange**

```typescript
const handleSessionChange = async (session: string) => {
  setCurrentSession(session);
  await apiFetch("/api/chairman/session", {
    method: "POST",
    body: JSON.stringify({ session }),
  }).catch(() => {});
};
```

- [ ] **Step 4: Add session selector to JSX**

Add after the room selector, before the info section:

```tsx
{/* Session selector */}
<div className="flex flex-col gap-1.5">
  <label className="text-[10px] uppercase tracking-wider text-[var(--color-text-dim)] font-semibold">
    Watched Session
  </label>
  <select
    value={currentSession}
    onChange={(e) => handleSessionChange(e.target.value)}
    className="w-full px-3 py-2 bg-[var(--color-input-bg)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] focus:outline-none focus:border-amber-500/50 appearance-none cursor-pointer"
  >
    <option value="">— none —</option>
    {sessions.map((s) => (
      <option key={s.id} value={s.id}>
        {s.name}
      </option>
    ))}
  </select>
</div>
```

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/components/ChairmanPanel.tsx
git commit -m "feat: add session selector to ChairmanPanel"
```

---

## Post-Implementation Checklist

- [ ] Run full test suite: `cd packages/app && pnpm test` — all pass
- [ ] Start dev server and enable Chairman with room + session set
- [ ] Confirm terminal-monitor posts a card when a Claude Code permission prompt appears
- [ ] Confirm card Approve button sends `y\n` to the PTY
- [ ] Confirm card Reject button sends `n\n` to the PTY
- [ ] Confirm card View button shows terminal screen lines inline
- [ ] Confirm message-bridge injects an @mention into the addressed terminal when not received
- [ ] Confirm task-watchdog posts a nudge after idle threshold and also injects into terminal
- [ ] Disable Chairman and confirm all three modules stop (check server logs)
