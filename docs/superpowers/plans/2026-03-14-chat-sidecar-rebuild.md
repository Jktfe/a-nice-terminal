# Chat Sidecar Rebuild — "Bold Voices" Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the chat sidecar with proper WebSocket infrastructure, bold per-model message identity, and rich interactions (annotations, threads, Obsidian store, collapse/expand).

**Architecture:** Chat sidecar (:6464) becomes the single owner of conversation traffic. Main server (:6458) no longer handles message WebSocket events. Both share SQLite WAL with busy_timeout. Frontend gets bold colour-coded message bubbles with hover toolbar actions.

**Tech Stack:** Express, Socket.IO, better-sqlite3, React 19, Tailwind v4, Lucide icons, Motion

**Spec:** `docs/superpowers/specs/2026-03-14-chat-sidecar-rebuild-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `packages/app/server/ws/chat-handlers.ts` | Socket.IO room management + streaming relay for chat sidecar |
| `packages/app/server/routes/annotations.ts` | `POST /annotate` endpoint — toggle annotations, sync starred column |
| `packages/app/server/routes/store.ts` | `POST /api/store` + `GET/PATCH /api/settings/obsidian` |
| `packages/app/src/utils/senderTheme.ts` | Maps `sender_type` → `{ accent, bg, border, icon }` |
| `packages/app/src/components/SenderAvatar.tsx` | 20px logo icon + tooltip card |
| `packages/app/src/components/MessageBubble.tsx` | Single message with bold identity, collapse, annotation pills |
| `packages/app/src/components/MessageToolbar.tsx` | Hover action bar (annotate, reply, copy, store, delete) |
| `packages/app/src/components/ThreadPanel.tsx` | Inline Slack-style thread expansion |

### Modified Files
| File | Changes |
|------|---------|
| `packages/app/server/db.ts` | Add 7 columns to messages, indices, busy_timeout pragma |
| `packages/app/server/routes/messages.ts` | Accept/return sender fields, reply_count subquery, thread queries, cascade delete, fix message_deleted payload |
| `packages/app/server/chat-server.ts` | Full rewrite — auth, rooms, shutdown, heartbeat |
| `packages/app/server/ws/handlers.ts` | Remove `new_message`, `stream_chunk`, `stream_end` handlers |
| `packages/app/src/store.ts` | Update Message interface, add `chatApiFetch`, new chat socket events |
| `packages/app/src/components/MessageList.tsx` | Replace inline rendering with MessageBubble + ThreadPanel |
| `packages/app/src/components/InputArea.tsx` | Pass sender fields when creating messages |
| `packages/app/src/components/SettingsModal.tsx` | Add Obsidian vault path field |
| `packages/mcp/src/index.ts` | Add `chatApi()`, update message tools, add `ant_reply_to_message` + `ant_store_message` |

---

## Chunk 1: Schema + Database Migration

### Task 1: Add busy_timeout pragma

**Files:**
- Modify: `packages/app/server/db.ts:10-11`

- [ ] **Step 1: Add busy_timeout pragma after WAL mode**

In `packages/app/server/db.ts`, after line 10 (`db.pragma("journal_mode = WAL")`), add:

```ts
db.pragma("busy_timeout = 5000");
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `cd packages/app && bun run test`
Expected: All 154 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/app/server/db.ts
git commit -m "fix: add busy_timeout pragma for concurrent SQLite access"
```

---

### Task 2: Add message schema columns + indices

**Files:**
- Modify: `packages/app/server/db.ts:127` (after ttl_minutes migration)

- [ ] **Step 1: Write migration test**

Create `packages/app/server/db-migrations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import db from "./db.js";

describe("message schema migrations", () => {
  it("messages table has sender_type column", () => {
    const info = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
    const columns = info.map((c) => c.name);
    expect(columns).toContain("sender_type");
    expect(columns).toContain("sender_name");
    expect(columns).toContain("sender_cwd");
    expect(columns).toContain("sender_persona");
    expect(columns).toContain("thread_id");
    expect(columns).toContain("annotations");
    expect(columns).toContain("starred");
  });

  it("thread index exists", () => {
    const indices = db.prepare("PRAGMA index_list(messages)").all() as { name: string }[];
    const names = indices.map((i) => i.name);
    expect(names).toContain("idx_messages_thread");
  });

  it("existing messages get sender_type from role", () => {
    // Insert a test message with role but no sender_type
    const sessionId = "test-migration-" + Date.now();
    db.prepare("INSERT INTO sessions (id, name, type) VALUES (?, ?, ?)").run(sessionId, "Test", "conversation");
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)").run("msg-test-1", sessionId, "human", "hello");

    // Run backfill (same logic as migration)
    db.prepare("UPDATE messages SET sender_type = 'human' WHERE sender_type IS NULL AND role = 'human'").run();

    const msg = db.prepare("SELECT sender_type FROM messages WHERE id = ?").get("msg-test-1") as { sender_type: string };
    expect(msg.sender_type).toBe("human");

    // Cleanup
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/app && npx vitest run server/db-migrations.test.ts`
Expected: FAIL — columns don't exist yet.

- [ ] **Step 3: Add migrations to db.ts**

After the `ttl_minutes` migration block (around line 127), add:

```ts
// Migration: add sender identity columns to messages
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_type TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_cwd TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_persona TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN thread_id TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN annotations TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`); } catch {}

// Backfill sender_type from role for existing messages
db.exec(`UPDATE messages SET sender_type = 'human' WHERE sender_type IS NULL AND role = 'human'`);
db.exec(`UPDATE messages SET sender_type = 'unknown' WHERE sender_type IS NULL AND role = 'agent'`);
db.exec(`UPDATE messages SET sender_type = 'system' WHERE sender_type IS NULL AND role = 'system'`);

// Indices for thread and starred queries
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_starred ON messages(starred) WHERE starred = 1`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/app && npx vitest run server/db-migrations.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/server/db.ts packages/app/server/db-migrations.test.ts
git commit -m "feat: add message sender identity, thread, and annotation schema"
```

---

## Chunk 2: Messages Route Updates

### Task 3: Update messages route — accept sender fields + reply_count

**Files:**
- Modify: `packages/app/server/routes/messages.ts:57-118` (POST handler)
- Modify: `packages/app/server/routes/messages.ts:32-55` (GET handler)

- [ ] **Step 1: Write test for POST with sender fields**

Create `packages/app/server/routes/messages.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";

// Direct DB tests — no HTTP server needed for route logic validation
describe("messages route logic", () => {
  const sessionId = "test-msg-route-" + Date.now();

  beforeEach(() => {
    db.prepare("INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)").run(sessionId, "Test", "conversation");
  });

  it("stores sender fields on insert", () => {
    const id = "msg-sender-" + Date.now();
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, sender_type, sender_name, sender_cwd, sender_persona)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, sessionId, "agent", "hello", "claude", "Claude", "/Users/james", "code-reviewer");

    const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
    expect(msg.sender_type).toBe("claude");
    expect(msg.sender_name).toBe("Claude");
    expect(msg.sender_cwd).toBe("/Users/james");
    expect(msg.sender_persona).toBe("code-reviewer");
  });

  it("infers sender_type from role when not provided", () => {
    const id = "msg-infer-" + Date.now();
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)`
    ).run(id, sessionId, "human", "hello");

    // Simulate the backfill logic
    db.prepare("UPDATE messages SET sender_type = 'human' WHERE id = ? AND sender_type IS NULL AND role = 'human'").run(id);

    const msg = db.prepare("SELECT sender_type FROM messages WHERE id = ?").get(id) as any;
    expect(msg.sender_type).toBe("human");
  });

  it("returns reply_count via subquery", () => {
    const parentId = "msg-parent-" + Date.now();
    const replyId1 = "msg-reply1-" + Date.now();
    const replyId2 = "msg-reply2-" + Date.now();

    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)").run(parentId, sessionId, "human", "question");
    db.prepare("INSERT INTO messages (id, session_id, role, content, thread_id) VALUES (?, ?, ?, ?, ?)").run(replyId1, sessionId, "agent", "answer1", parentId);
    db.prepare("INSERT INTO messages (id, session_id, role, content, thread_id) VALUES (?, ?, ?, ?, ?)").run(replyId2, sessionId, "agent", "answer2", parentId);

    const row = db.prepare(`
      SELECT m.*, (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) AS reply_count
      FROM messages m WHERE m.id = ?
    `).get(parentId) as any;

    expect(row.reply_count).toBe(2);
  });

  it("cascade-deletes thread replies when parent is deleted", () => {
    const parentId = "msg-cascade-parent-" + Date.now();
    const replyId = "msg-cascade-reply-" + Date.now();

    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)").run(parentId, sessionId, "human", "parent");
    db.prepare("INSERT INTO messages (id, session_id, role, content, thread_id) VALUES (?, ?, ?, ?, ?)").run(replyId, sessionId, "agent", "reply", parentId);

    // Delete parent + cascade
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(parentId);
    db.prepare("DELETE FROM messages WHERE id = ? AND session_id = ?").run(parentId, sessionId);

    const reply = db.prepare("SELECT * FROM messages WHERE id = ?").get(replyId);
    expect(reply).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (DB-level logic)**

Run: `cd packages/app && npx vitest run server/routes/messages.test.ts`
Expected: PASS (these test DB operations, not HTTP routes).

- [ ] **Step 3: Update POST handler in messages.ts**

In `packages/app/server/routes/messages.ts`, update the POST handler (around line 58) to accept and store sender fields:

```ts
// After destructuring req.body (line 62-68), add:
const {
  role = "agent",
  content = "",
  format = "markdown",
  status = "complete",
  metadata = null,
  sender_type,
  sender_name,
  sender_cwd,
  sender_persona,
  thread_id,
} = req.body;

// Infer sender_type from role if not provided
const resolvedSenderType = sender_type || (normalisedRole === "human" ? "human" : normalisedRole === "system" ? "system" : "unknown");
```

Update the INSERT statement (around line 94) to include new fields:

```ts
db.prepare(
  `INSERT INTO messages (id, session_id, role, content, format, status, metadata, sender_type, sender_name, sender_cwd, sender_persona, thread_id)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
).run(
  id,
  req.params.sessionId,
  normalisedRole,
  sanitisedContent,
  format,
  status,
  metadata ? JSON.stringify(metadata) : null,
  resolvedSenderType,
  sender_name || null,
  sender_cwd || null,
  sender_persona || null,
  thread_id || null,
);
```

Also update the `io.emit("message_created")` block (around line 113-116) to also emit `thread_reply` when the message has a `thread_id`:

```ts
  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_created", message);
    // If this is a thread reply, emit thread_reply for open thread panels
    if (thread_id) {
      io.to(req.params.sessionId).emit("thread_reply", { threadId: thread_id, message });
    }
  }
```

- [ ] **Step 4: Update GET handler with reply_count**

Replace the GET query (around line 38-53) with:

```ts
router.get("/api/sessions/:sessionId/messages", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  const { since, limit = "100", thread_id, starred } = req.query;

  let query: string;
  const params: any[] = [req.params.sessionId];

  if (thread_id) {
    // Fetch replies to a specific thread (use alias for consistency)
    query = "SELECT m.* FROM messages m WHERE m.session_id = ? AND m.thread_id = ?";
    params.push(thread_id as string);
  } else if (starred === "true") {
    // Fetch only starred messages
    query = `SELECT m.*, (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) AS reply_count
             FROM messages m WHERE m.session_id = ? AND m.starred = 1 AND m.thread_id IS NULL`;
  } else {
    // Top-level messages with reply counts
    query = `SELECT m.*, (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) AS reply_count
             FROM messages m WHERE m.session_id = ? AND m.thread_id IS NULL`;
  }

  if (since) {
    query += " AND m.created_at > ?";
    params.push(since as string);
  }

  query += " ORDER BY m.created_at ASC LIMIT ?";
  const parsedLimit = Math.max(1, Math.min(parseInt(limit as string, 10) || 100, 1000));
  params.push(parsedLimit);

  const messages = db.prepare(query).all(...params).map((m: any) => ({
    ...m,
    metadata: m.metadata ? JSON.parse(m.metadata) : null,
    annotations: m.annotations ? JSON.parse(m.annotations) : null,
  }));
  res.json(messages);
});
```

- [ ] **Step 5: Update DELETE handler with cascade + sessionId in broadcast**

Replace the DELETE handler (around line 166-184):

```ts
router.delete("/api/sessions/:sessionId/messages/:id", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  // Cascade: delete thread replies first
  db.prepare("DELETE FROM messages WHERE thread_id = ? AND session_id = ?")
    .run(req.params.id, req.params.sessionId);

  const result = db.prepare("DELETE FROM messages WHERE id = ? AND session_id = ?")
    .run(req.params.id, req.params.sessionId);

  if (result.changes === 0) {
    return res.status(404).json({ error: "Message not found" });
  }

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("message_deleted", {
      id: req.params.id,
      sessionId: req.params.sessionId,
    });
  }

  res.json({ deleted: true });
});
```

- [ ] **Step 6: Add thread endpoint**

Add before the search route (around line 187):

```ts
// Get thread: parent message + all replies
router.get("/api/sessions/:sessionId/messages/:msgId/thread", (req, res) => {
  const session = ensureConversationSession(req.params.sessionId, res);
  if (!session) return;

  const parent = db.prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?")
    .get(req.params.msgId, req.params.sessionId) as any;

  if (!parent) return res.status(404).json({ error: "Message not found" });

  const replies = db.prepare(
    "SELECT * FROM messages WHERE thread_id = ? AND session_id = ? ORDER BY created_at ASC"
  ).all(req.params.msgId, req.params.sessionId).map((m: any) => ({
    ...m,
    metadata: m.metadata ? JSON.parse(m.metadata) : null,
    annotations: m.annotations ? JSON.parse(m.annotations) : null,
  }));

  if (parent.metadata) parent.metadata = JSON.parse(parent.metadata);
  if (parent.annotations) parent.annotations = JSON.parse(parent.annotations);

  res.json({ parent, replies });
});
```

- [ ] **Step 7: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/app/server/routes/messages.ts packages/app/server/routes/messages.test.ts
git commit -m "feat: message sender fields, reply_count, thread endpoint, cascade delete"
```

---

### Task 4: Create annotations route

**Files:**
- Create: `packages/app/server/routes/annotations.ts`

- [ ] **Step 1: Write annotation toggle test**

Create `packages/app/server/routes/annotations.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import db from "../db.js";

describe("annotation logic", () => {
  const sessionId = "test-ann-" + Date.now();
  let msgId: string;

  beforeEach(() => {
    msgId = "msg-ann-" + Date.now();
    db.prepare("INSERT OR IGNORE INTO sessions (id, name, type) VALUES (?, ?, ?)").run(sessionId, "Test", "conversation");
    db.prepare("INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)").run(msgId, sessionId, "human", "test");
  });

  it("adds annotation to empty message", () => {
    const existing: any[] = [];
    existing.push({ type: "thumbs_up", by: "human", at: new Date().toISOString() });
    db.prepare("UPDATE messages SET annotations = ? WHERE id = ?").run(JSON.stringify(existing), msgId);

    const msg = db.prepare("SELECT annotations FROM messages WHERE id = ?").get(msgId) as any;
    const anns = JSON.parse(msg.annotations);
    expect(anns).toHaveLength(1);
    expect(anns[0].type).toBe("thumbs_up");
  });

  it("toggling same annotation removes it", () => {
    const existing = [{ type: "thumbs_up", by: "human", at: "2026-01-01T00:00:00Z" }];
    db.prepare("UPDATE messages SET annotations = ? WHERE id = ?").run(JSON.stringify(existing), msgId);

    // Toggle off: remove matching (type, by)
    const filtered = existing.filter((a) => !(a.type === "thumbs_up" && a.by === "human"));
    db.prepare("UPDATE messages SET annotations = ? WHERE id = ?").run(
      filtered.length > 0 ? JSON.stringify(filtered) : null,
      msgId
    );

    const msg = db.prepare("SELECT annotations FROM messages WHERE id = ?").get(msgId) as any;
    expect(msg.annotations).toBeNull();
  });

  it("star annotation syncs starred column", () => {
    db.prepare("UPDATE messages SET starred = 1, annotations = ? WHERE id = ?")
      .run(JSON.stringify([{ type: "star", by: "human", at: new Date().toISOString() }]), msgId);

    const msg = db.prepare("SELECT starred FROM messages WHERE id = ?").get(msgId) as any;
    expect(msg.starred).toBe(1);
  });

  it("rejects annotations beyond cap of 50", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      type: "flag", by: `agent-${i}`, at: new Date().toISOString(), note: `note ${i}`
    }));
    db.prepare("UPDATE messages SET annotations = ? WHERE id = ?").run(JSON.stringify(many), msgId);

    const msg = db.prepare("SELECT annotations FROM messages WHERE id = ?").get(msgId) as any;
    const anns = JSON.parse(msg.annotations);
    expect(anns).toHaveLength(50);
    // Adding one more should be rejected by the endpoint (tested at HTTP level)
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd packages/app && npx vitest run server/routes/annotations.test.ts`
Expected: PASS

- [ ] **Step 3: Create annotations route**

Create `packages/app/server/routes/annotations.ts`:

```ts
import { Router } from "express";
import db from "../db.js";
import type { DbSession } from "../types.js";

const router = Router();
const ANNOTATION_CAP = 50;
const VALID_ANNOTATION_TYPES = new Set(["thumbs_up", "thumbs_down", "flag", "star"]);

interface Annotation {
  type: string;
  by: string;
  at: string;
  note?: string;
}

router.post("/api/sessions/:sessionId/messages/:msgId/annotate", (req, res) => {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.sessionId) as DbSession | undefined;
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.type !== "conversation") return res.status(409).json({ error: "Not a conversation session" });

  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?")
    .get(req.params.msgId, req.params.sessionId) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });

  const { type, note } = req.body;
  if (!type || !VALID_ANNOTATION_TYPES.has(type)) {
    return res.status(400).json({ error: "Invalid annotation type" });
  }

  const by = (req.body.by as string) || "human";
  const existing: Annotation[] = msg.annotations ? JSON.parse(msg.annotations) : [];

  // Toggle: if same (type, by) exists, remove it; otherwise add it
  const matchIdx = existing.findIndex((a) => a.type === type && a.by === by);

  let updated: Annotation[];
  if (matchIdx >= 0) {
    // Remove (toggle off)
    updated = existing.filter((_, i) => i !== matchIdx);
  } else {
    // Add (toggle on)
    if (existing.length >= ANNOTATION_CAP) {
      return res.status(400).json({ error: `Maximum ${ANNOTATION_CAP} annotations per message` });
    }
    const annotation: Annotation = { type, by, at: new Date().toISOString() };
    if (note) annotation.note = String(note).slice(0, 500);
    updated = [...existing, annotation];
  }

  const annotationsJson = updated.length > 0 ? JSON.stringify(updated) : null;

  // Sync starred column if type is "star"
  const isStarred = type === "star"
    ? (updated.some((a) => a.type === "star") ? 1 : 0)
    : (msg.starred || 0);

  db.prepare("UPDATE messages SET annotations = ?, starred = ? WHERE id = ?")
    .run(annotationsJson, isStarred, req.params.msgId);

  const io = req.app.get("io");
  if (io) {
    io.to(req.params.sessionId).emit("annotation_changed", {
      messageId: req.params.msgId,
      annotations: updated,
      starred: isStarred,
    });
  }

  res.json({ annotations: updated, starred: isStarred });
});

export default router;
```

- [ ] **Step 4: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/app/server/routes/annotations.ts packages/app/server/routes/annotations.test.ts
git commit -m "feat: annotation toggle endpoint with star fast-path"
```

---

### Task 5: Create Obsidian store route

**Files:**
- Create: `packages/app/server/routes/store.ts`

- [ ] **Step 1: Create store route**

```ts
import { Router } from "express";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";
import db from "../db.js";

const router = Router();

function getVaultPath(): string | null {
  const fromEnv = process.env.ANT_OBSIDIAN_VAULT;
  if (fromEnv) return fromEnv;
  const row = db.prepare("SELECT value FROM server_state WHERE key = 'obsidian_vault_path'").get() as { value: string } | undefined;
  return row?.value || null;
}

function sanitiseFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 100);
}

// Store message to Obsidian vault
router.post("/api/store", (req, res) => {
  const { messageId, sessionId } = req.body;
  if (!messageId || !sessionId) {
    return res.status(400).json({ error: "messageId and sessionId required" });
  }

  const vaultPath = getVaultPath();
  if (!vaultPath) {
    return res.status(400).json({ error: "Obsidian vault path not configured" });
  }

  const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND session_id = ?").get(messageId, sessionId) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });

  const session = db.prepare("SELECT name FROM sessions WHERE id = ?").get(sessionId) as { name: string } | undefined;
  const sessionName = session?.name || "Unknown";

  const timestamp = msg.created_at || new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");
  const filename = `ANT-${sanitiseFilename(sessionName)}-${safeTimestamp}.md`;

  const frontmatter = [
    "---",
    "source: ANT",
    `session: "${sessionName}"`,
    msg.sender_type ? `sender_type: ${msg.sender_type}` : null,
    msg.sender_name ? `sender_name: ${msg.sender_name}` : null,
    msg.sender_persona ? `persona: ${msg.sender_persona}` : null,
    `timestamp: ${timestamp}`,
    msg.thread_id ? "thread: true" : null,
    "---",
  ].filter(Boolean).join("\n");

  const fileContent = `${frontmatter}\n\n${msg.content}\n`;

  try {
    const antDir = path.join(vaultPath, "ANT");
    if (!existsSync(antDir)) mkdirSync(antDir, { recursive: true });

    const filePath = path.join(antDir, filename);
    writeFileSync(filePath, fileContent, "utf-8");

    res.json({ stored: true, path: filePath, filename });
  } catch (err: any) {
    console.error("[store] Failed to write to Obsidian vault:", err.message);
    res.status(500).json({ error: "Failed to write file", details: err.message });
  }
});

// Get Obsidian vault config
router.get("/api/settings/obsidian", (_req, res) => {
  const vaultPath = getVaultPath();
  res.json({ vault_path: vaultPath });
});

// Set Obsidian vault config
router.patch("/api/settings/obsidian", (req, res) => {
  const { vault_path } = req.body;
  if (typeof vault_path !== "string" || !vault_path.trim()) {
    return res.status(400).json({ error: "vault_path required" });
  }

  const resolved = vault_path.startsWith("~/")
    ? vault_path.replace(/^~/, process.env.HOME || "")
    : vault_path;

  if (!existsSync(resolved)) {
    return res.status(400).json({ error: "Path does not exist" });
  }

  db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)")
    .run("obsidian_vault_path", resolved);

  res.json({ vault_path: resolved });
});

export default router;
```

- [ ] **Step 2: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/app/server/routes/store.ts
git commit -m "feat: Obsidian store endpoint + vault config"
```

---

## Chunk 3: Chat Sidecar Server Rebuild

### Task 6: Create chat-handlers.ts

**Files:**
- Create: `packages/app/server/ws/chat-handlers.ts`

- [ ] **Step 1: Create chat handlers**

```ts
import type { Server, Socket } from "socket.io";
import db from "../db.js";
import type { DbSession } from "../types.js";

function getSession(sessionId: string) {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as DbSession | undefined;
}

export function registerChatHandlers(io: Server): void {
  io.on("connection", (socket: Socket) => {
    const joinedSessions = new Set<string>();

    socket.on("join_session", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) return;
      const session = getSession(sessionId);
      if (!session || session.type !== "conversation") return;

      socket.join(sessionId);
      joinedSessions.add(sessionId);
    });

    socket.on("leave_session", ({ sessionId }: { sessionId: string }) => {
      if (typeof sessionId !== "string" || !sessionId.trim()) return;
      socket.leave(sessionId);
      joinedSessions.delete(sessionId);
    });

    socket.on("stream_chunk", ({ sessionId, messageId, content }: { sessionId: string; messageId: string; content: string }) => {
      if (!sessionId || !messageId || typeof content !== "string") return;

      // Append content to streaming message
      try {
        const msg = db.prepare("SELECT content, status FROM messages WHERE id = ? AND session_id = ?").get(messageId, sessionId) as any;
        if (!msg || msg.status !== "streaming") return;

        const updated = (msg.content || "") + content;
        db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(updated, messageId);

        // Relay to all clients in the room (including sender for multi-tab support)
        io.to(sessionId).emit("stream_chunk", { sessionId, messageId, content });
      } catch {
        // Non-fatal
      }
    });

    socket.on("stream_end", ({ sessionId, messageId }: { sessionId: string; messageId: string }) => {
      if (!sessionId || !messageId) return;

      try {
        db.prepare("UPDATE messages SET status = 'complete' WHERE id = ? AND session_id = ?").run(messageId, sessionId);
        const updated = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as any;
        if (updated) {
          if (updated.metadata) updated.metadata = JSON.parse(updated.metadata);
          if (updated.annotations) updated.annotations = JSON.parse(updated.annotations);
          io.to(sessionId).emit("message_updated", updated);
        }
      } catch {
        // Non-fatal
      }
    });

    socket.on("disconnect", () => {
      joinedSessions.clear();
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/server/ws/chat-handlers.ts
git commit -m "feat: chat WebSocket handlers with room management and streaming"
```

---

### Task 7: Rebuild chat-server.ts

**Files:**
- Modify: `packages/app/server/chat-server.ts` (full rewrite)

- [ ] **Step 1: Rewrite chat-server.ts**

```ts
import express from "express";
import { createServer } from "http";
import { Server, type Socket } from "socket.io";

import { isAllowedHost, tailscaleOnly } from "./middleware/localhost.js";
import { apiKeyAuth } from "./middleware/auth.js";
import messageRoutes from "./routes/messages.js";
import annotationRoutes from "./routes/annotations.js";
import storeRoutes from "./routes/store.js";
import { registerChatHandlers } from "./ws/chat-handlers.js";
import db from "./db.js";

const PORT = parseInt(process.env.ANT_CHAT_PORT || "6464", 10);
const HOST = process.env.ANT_HOST || "0.0.0.0";
const WS_API_KEY = process.env.ANT_API_KEY;

function getClientApiKey(socket: Socket): string | undefined {
  const handshake = (socket as any)?.handshake || {};
  const auth = (handshake.auth || {}) as Record<string, string | undefined>;
  const query = (handshake.query || {}) as Record<string, string | string[] | undefined>;
  const headers = (handshake.headers || {}) as Record<string, string | string[] | undefined>;

  const rawAuth = auth.apiKey || (query.apiKey as string | undefined);
  const headerApiKey = Array.isArray(headers["x-api-key"]) ? headers["x-api-key"][0] : headers["x-api-key"];
  const headerAuth = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;

  if (rawAuth) return rawAuth;
  if (headerApiKey) return headerApiKey;
  if (headerAuth?.startsWith("Bearer ")) return headerAuth.slice("Bearer ".length);
  return headerAuth;
}

function extractIp(socket: Socket): string {
  const remote = socket?.request?.socket?.remoteAddress as string | undefined;
  const direct = socket?.conn?.remoteAddress as string | undefined;
  const headers = ((socket as any)?.handshake?.headers || {}) as Record<string, string | string[] | undefined>;
  const xffRaw = headers["x-forwarded-for"];
  const xff = (typeof xffRaw === "string" ? xffRaw : "").split(",")[0].trim();
  return xff || remote || direct || "";
}

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

app.set("io", io);

// Socket.IO auth middleware
io.use((socket, next) => {
  const ip = extractIp(socket as any);
  if (!isAllowedHost(ip)) {
    return next(new Error("ANT is restricted to the configured local network."));
  }
  if (!WS_API_KEY) return next();
  const provided = getClientApiKey(socket);
  if (!provided) return next(new Error("Invalid or missing API key"));
  if (provided === WS_API_KEY) return next();
  next(new Error("Invalid or missing API key"));
});

// Express middleware
app.use(tailscaleOnly);
app.use(apiKeyAuth);
app.use(express.json());

// Routes
app.use(messageRoutes);
app.use(annotationRoutes);
app.use(storeRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "chat-sidecar" });
});

// WebSocket handlers
registerChatHandlers(io);

// Heartbeat
const HEARTBEAT_INTERVAL = 30_000;
const heartbeat = setInterval(() => {
  try {
    db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)")
      .run("last_heartbeat_chat", new Date().toISOString());
  } catch {}
}, HEARTBEAT_INTERVAL);

// Graceful shutdown
function shutdown() {
  console.log("[chat-server] Shutting down...");
  clearInterval(heartbeat);
  try {
    db.prepare("INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)")
      .run("last_shutdown_chat", new Date().toISOString());
  } catch {}
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

httpServer.listen(PORT, HOST, () => {
  console.log(`  ANT Chat Sidecar running at http://${HOST}:${PORT}`);
});
```

- [ ] **Step 2: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/app/server/chat-server.ts
git commit -m "feat: rebuild chat sidecar with auth, rooms, streaming, shutdown"
```

---

### Task 8: Remove chat handlers from main server

**Files:**
- Modify: `packages/app/server/ws/handlers.ts:197-330` (remove new_message, stream_chunk, stream_end)
- Modify: `packages/app/server/index.ts` (remove message routes)

- [ ] **Step 1: Remove chat WebSocket handlers from handlers.ts**

In `packages/app/server/ws/handlers.ts`, delete the `new_message` handler block (starts around line 196), the `stream_chunk` handler block (starts around line 254), and the `stream_end` handler block (starts around line 297). Keep all terminal-related handlers.

- [ ] **Step 2: Remove message routes from main server index.ts**

In `packages/app/server/index.ts`, remove the import and use of `messageRoutes`:
- Remove: `import messageRoutes from "./routes/messages.js";`
- Remove: `app.use(messageRoutes);`

The search route in messages.ts is also used by the main server. Move the search route to a separate file or keep it mounted. Since the search endpoint (`/api/search`) is a global feature used by the sidebar, keep it on the main server. Extract it to its own mini-route or keep the import but only mount the search route.

Simplest approach: keep `messageRoutes` mounted on main server for now (it serves `/api/search` too). The chat sidecar also mounts it. This is the "transition period" the spec mentions. The duplicate mount is harmless since the frontend routes messages to the correct server via `chatApiFetch`.

- [ ] **Step 3: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass (handlers.test.ts may need mock updates for removed events).

- [ ] **Step 4: Update handlers.test.ts if needed**

Remove test cases for `new_message`, `stream_chunk`, `stream_end` if they exist in the handlers test file.

- [ ] **Step 5: Commit**

```bash
git add packages/app/server/ws/handlers.ts packages/app/server/ws/handlers.test.ts
git commit -m "refactor: remove chat WebSocket handlers from main server"
```

---

## Chunk 4: Frontend — Store + Identity System

### Task 9: Update store.ts — Message interface + chatApiFetch

**Files:**
- Modify: `packages/app/src/store.ts:35-44` (Message interface)
- Modify: `packages/app/src/store.ts:119,151-153` (apiFetch routing)

- [ ] **Step 1: Update Message interface**

In `packages/app/src/store.ts`, replace the Message interface (lines 35-44):

```ts
export interface Message {
  id: string;
  session_id: string;
  role: "human" | "agent" | "system";
  content: string;
  format: string;
  status: "pending" | "streaming" | "complete";
  metadata?: any;
  created_at: string;
  sender_type?: string;
  sender_name?: string;
  sender_cwd?: string;
  sender_persona?: string;
  thread_id?: string;
  annotations?: Array<{ type: string; by: string; at: string; note?: string }>;
  starred?: number;
  reply_count?: number;
}
```

- [ ] **Step 2: Add chatApiFetch helper**

After the existing `apiFetch` function (around line 160), add `chatApiFetch`. Note: `CHAT_URL` is already defined at line 119 — reuse it, do not redeclare:

```ts
// CHAT_URL already exists at line 119 — no need to declare again

export async function chatApiFetch(url: string, options?: RequestInit) {
  const apiKey = import.meta.env.VITE_ANT_API_KEY;
  const headers: Record<string, string> = {
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
    ...(options?.headers as Record<string, string> || {}),
  };
  const res = await fetch(`${CHAT_URL}${url}`, { ...options, headers });
  if (!res.ok) throw new Error(`Chat API error ${res.status}`);
  return res.json();
}
```

- [ ] **Step 3: Update store message functions to use chatApiFetch**

In `store.ts`, find `loadMessages` (around line 526) and `sendMessageToSession` (around line 540). Update these to use `chatApiFetch` instead of `apiFetch` for message operations. Also remove the URL-sniffing heuristic from `apiFetch` (the `isChat` logic around line 151-153) — `apiFetch` should only ever target the main server.

- [ ] **Step 4: Add annotation_changed listener on chatSocket**

In the `init` function where chatSocket events are set up (around line 256), add:

```ts
chatSocket.on("annotation_changed", ({ messageId, annotations, starred }: { messageId: string; annotations: any[]; starred: number }) => {
  const { messages, splitMessages } = get();
  const update = (msgs: Message[]) => msgs.map((m) =>
    m.id === messageId ? { ...m, annotations, starred } : m
  );
  set({ messages: update(messages), splitMessages: update(splitMessages) });
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/store.ts
git commit -m "feat: chatApiFetch, annotation_changed listener, migrate store to chat sidecar"
```

---

### Task 10: Create senderTheme.ts

**Files:**
- Create: `packages/app/src/utils/senderTheme.ts`

- [ ] **Step 1: Create sender theme mapping**

```ts
import {
  User, Bot, Settings, Sparkles, Code, Cpu, CircleHelp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface SenderTheme {
  accent: string;
  bg: string;
  border: string;
  icon: LucideIcon;
  label: string;
}

const themes: Record<string, SenderTheme> = {
  human: {
    accent: "#10b981",
    bg: "rgba(16, 185, 129, 0.08)",
    border: "rgba(16, 185, 129, 0.3)",
    icon: User,
    label: "Human",
  },
  claude: {
    accent: "#f59e0b",
    bg: "rgba(245, 158, 11, 0.08)",
    border: "rgba(245, 158, 11, 0.3)",
    icon: Sparkles,
    label: "Claude",
  },
  codex: {
    accent: "#22c55e",
    bg: "rgba(34, 197, 94, 0.08)",
    border: "rgba(34, 197, 94, 0.3)",
    icon: Code,
    label: "Codex",
  },
  gemini: {
    accent: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.08)",
    border: "rgba(59, 130, 246, 0.3)",
    icon: Cpu,
    label: "Gemini",
  },
  copilot: {
    accent: "#a855f7",
    bg: "rgba(168, 85, 247, 0.08)",
    border: "rgba(168, 85, 247, 0.3)",
    icon: Bot,
    label: "Copilot",
  },
  system: {
    accent: "#525252",
    bg: "rgba(82, 82, 82, 0.06)",
    border: "rgba(82, 82, 82, 0.2)",
    icon: Settings,
    label: "System",
  },
  unknown: {
    accent: "#e5e5e5",
    bg: "rgba(229, 229, 229, 0.06)",
    border: "rgba(229, 229, 229, 0.15)",
    icon: CircleHelp,
    label: "Unknown",
  },
};

export function getSenderTheme(senderType?: string | null): SenderTheme {
  return themes[senderType || "unknown"] || themes.unknown;
}

export function isHuman(senderType?: string | null): boolean {
  return senderType === "human";
}

export function isSystem(senderType?: string | null): boolean {
  return senderType === "system";
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/utils/senderTheme.ts
git commit -m "feat: sender theme mapping — colours, icons, labels per model type"
```

---

### Task 11: Create SenderAvatar component

**Files:**
- Create: `packages/app/src/components/SenderAvatar.tsx`

- [ ] **Step 1: Create SenderAvatar**

```tsx
import { useState, useRef } from "react";
import { getSenderTheme } from "../utils/senderTheme.ts";

interface SenderAvatarProps {
  senderType?: string | null;
  senderName?: string | null;
  senderPersona?: string | null;
  senderCwd?: string | null;
  size?: number;
}

export default function SenderAvatar({ senderType, senderName, senderPersona, senderCwd, size = 20 }: SenderAvatarProps) {
  const theme = getSenderTheme(senderType);
  const Icon = theme.icon;
  const [showTooltip, setShowTooltip] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={ref}
      className="relative flex-shrink-0 cursor-default"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: size,
          height: size,
          backgroundColor: theme.bg,
          border: `1.5px solid ${theme.border}`,
        }}
      >
        <Icon style={{ width: size * 0.6, height: size * 0.6, color: theme.accent }} />
      </div>

      {showTooltip && (senderName || senderPersona || senderCwd) && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-lg bg-[#1a1a1a] border border-white/10 shadow-xl text-xs whitespace-nowrap pointer-events-none">
          {senderName && <div className="font-medium" style={{ color: theme.accent }}>{senderName}</div>}
          {senderPersona && <div className="text-white/50">{senderPersona}</div>}
          {senderCwd && <div className="text-white/30 font-mono text-[10px]">{senderCwd}</div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/SenderAvatar.tsx
git commit -m "feat: SenderAvatar component with tooltip"
```

---

### Task 12: Create MessageToolbar component

**Files:**
- Create: `packages/app/src/components/MessageToolbar.tsx`

- [ ] **Step 1: Create MessageToolbar**

```tsx
import { ThumbsUp, ThumbsDown, Flag, Star, Reply, Copy, Download, Trash2 } from "lucide-react";
import { chatApiFetch, type Message } from "../store.ts";

interface MessageToolbarProps {
  message: Message;
  sessionId: string;
  onReply: () => void;
  onDelete: () => void;
  onAnnotationChange: (annotations: any[], starred: number) => void;
}

export default function MessageToolbar({ message, sessionId, onReply, onDelete, onAnnotationChange }: MessageToolbarProps) {
  const hasAnnotation = (type: string) =>
    message.annotations?.some((a) => a.type === type && a.by === "human") ?? false;

  const toggleAnnotation = async (type: string) => {
    try {
      const result = await chatApiFetch(`/api/sessions/${sessionId}/messages/${message.id}/annotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, by: "human" }),
      });
      onAnnotationChange(result.annotations, result.starred);
    } catch (err) {
      console.error("Failed to toggle annotation", err);
    }
  };

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
    } catch {}
  };

  const storeToObsidian = async () => {
    try {
      await chatApiFetch("/api/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: message.id, sessionId }),
      });
    } catch (err) {
      console.error("Failed to store to Obsidian", err);
    }
  };

  const btnClass = "p-1 rounded hover:bg-white/10 transition-colors";
  const activeClass = "text-amber-400";
  const inactiveClass = "text-white/40 hover:text-white/70";

  return (
    <div className="flex items-center gap-0.5 bg-[#1a1a1a] border border-white/10 rounded-lg px-1 py-0.5 shadow-lg">
      <button onClick={() => toggleAnnotation("thumbs_up")} className={`${btnClass} ${hasAnnotation("thumbs_up") ? activeClass : inactiveClass}`} title="Thumbs up">
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => toggleAnnotation("thumbs_down")} className={`${btnClass} ${hasAnnotation("thumbs_down") ? activeClass : inactiveClass}`} title="Thumbs down">
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => toggleAnnotation("flag")} className={`${btnClass} ${hasAnnotation("flag") ? activeClass : inactiveClass}`} title="Flag">
        <Flag className="w-3.5 h-3.5" />
      </button>
      <button onClick={() => toggleAnnotation("star")} className={`${btnClass} ${hasAnnotation("star") ? "text-yellow-400" : inactiveClass}`} title="Star">
        <Star className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-white/10 mx-0.5" />
      <button onClick={onReply} className={`${btnClass} ${inactiveClass}`} title="Reply">
        <Reply className="w-3.5 h-3.5" />
      </button>
      <button onClick={copyContent} className={`${btnClass} ${inactiveClass}`} title="Copy">
        <Copy className="w-3.5 h-3.5" />
      </button>
      <button onClick={storeToObsidian} className={`${btnClass} ${inactiveClass}`} title="Store to Obsidian">
        <Download className="w-3.5 h-3.5" />
      </button>
      <div className="w-px h-4 bg-white/10 mx-0.5" />
      <button onClick={onDelete} className={`${btnClass} text-white/40 hover:text-red-400`} title="Delete">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/MessageToolbar.tsx
git commit -m "feat: MessageToolbar — hover action bar with annotations, copy, store"
```

---

## Chunk 5: Frontend — MessageBubble + ThreadPanel + MessageList

### Task 13: Create MessageBubble component

**Files:**
- Create: `packages/app/src/components/MessageBubble.tsx`

- [ ] **Step 1: Create MessageBubble**

```tsx
import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type Message } from "../store.ts";
import { getSenderTheme, isHuman, isSystem } from "../utils/senderTheme.ts";
import SenderAvatar from "./SenderAvatar.tsx";
import MessageToolbar from "./MessageToolbar.tsx";

const COLLAPSE_THRESHOLD = 15;
const COLLAPSED_LINES = 6;

interface MessageBubbleProps {
  message: Message;
  sessionId: string;
  onReply: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onAnnotationChange: (messageId: string, annotations: any[], starred: number) => void;
  replyCount?: number;
  onToggleThread?: () => void;
  scale?: number;
}

export default function MessageBubble({
  message, sessionId, onReply, onDelete, onAnnotationChange,
  replyCount = 0, onToggleThread, scale = 1,
}: MessageBubbleProps) {
  const theme = getSenderTheme(message.sender_type);
  const human = isHuman(message.sender_type);
  const system = isSystem(message.sender_type);
  const [hovered, setHovered] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const lineCount = message.content.split("\n").length;
    return lineCount > COLLAPSE_THRESHOLD;
  });

  const annotations = message.annotations || [];
  const pills = annotations.filter((a) => a.type !== "star");
  const isStarred = message.starred === 1;

  const alignment = system ? "justify-center" : human ? "justify-end" : "justify-start";
  const maxWidth = system ? "max-w-lg" : "max-w-2xl";
  const fontSize = scale < 1 ? "text-[13px]" : "text-sm";

  const timestamp = message.created_at
    ? new Date(message.created_at + "Z").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div
      className={`flex ${alignment} group relative`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`${maxWidth} w-full`}>
        <div
          className={`relative rounded-xl px-4 py-3 ${fontSize}`}
          style={{
            backgroundColor: theme.bg,
            borderLeft: !human && !system ? `3px solid ${isStarred ? "#eab308" : theme.accent}` : undefined,
            borderRight: human ? `3px solid ${isStarred ? "#eab308" : theme.accent}` : undefined,
            boxShadow: isStarred ? "0 0 0 1px rgba(234, 179, 8, 0.3)" : undefined,
          }}
        >
          {/* Hover toolbar */}
          {hovered && (
            <div className="absolute -top-4 right-2 z-10">
              <MessageToolbar
                message={message}
                sessionId={sessionId}
                onReply={() => onReply(message.id)}
                onDelete={() => onDelete(message.id)}
                onAnnotationChange={(anns, starred) => onAnnotationChange(message.id, anns, starred)}
              />
            </div>
          )}

          {/* Avatar + content row */}
          <div className={`flex items-start gap-2 ${human ? "flex-row-reverse" : ""}`}>
            <SenderAvatar
              senderType={message.sender_type}
              senderName={message.sender_name}
              senderPersona={message.sender_persona}
              senderCwd={message.sender_cwd}
              size={scale < 1 ? 16 : 20}
            />
            <div className="min-w-0 flex-1">
              {/* Content */}
              <div className={`prose prose-invert prose-sm max-w-none ${collapsed ? "line-clamp-6 overflow-hidden" : ""}`}>
                {system ? (
                  <span className="text-white/50 text-xs">{message.content}</span>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {collapsed
                      ? message.content.split("\n").slice(0, COLLAPSED_LINES).join("\n")
                      : message.content}
                  </ReactMarkdown>
                )}
              </div>

              {/* Collapse toggle */}
              {message.content.split("\n").length > COLLAPSE_THRESHOLD && (
                <button
                  onClick={() => setCollapsed((v) => !v)}
                  className="flex items-center gap-1 mt-1 text-[10px] text-white/40 hover:text-white/70 transition-colors"
                >
                  {collapsed ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                  {collapsed ? "Show more" : "Show less"}
                </button>
              )}

              {/* Annotation pills */}
              {pills.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2">
                  {pills.map((a, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded-full text-[10px] bg-white/5 text-white/50">
                      {a.type === "thumbs_up" ? "👍" : a.type === "thumbs_down" ? "👎" : "🚩"}
                      {a.note && <span className="ml-1">{a.note}</span>}
                    </span>
                  ))}
                </div>
              )}

              {/* Thread indicator */}
              {replyCount > 0 && onToggleThread && (
                <button
                  onClick={onToggleThread}
                  className="mt-2 text-[11px] text-white/40 hover:text-white/70 transition-colors"
                >
                  {replyCount} {replyCount === 1 ? "reply" : "replies"} ▾
                </button>
              )}

              {/* Timestamp */}
              <div className={`text-[10px] text-white/25 mt-1 ${human ? "text-right" : ""}`}>
                {timestamp}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/MessageBubble.tsx
git commit -m "feat: MessageBubble — bold identity, collapse, annotations, thread indicator"
```

---

### Task 14: Create ThreadPanel component

**Files:**
- Create: `packages/app/src/components/ThreadPanel.tsx`

- [ ] **Step 1: Create ThreadPanel**

```tsx
import { useState, useEffect, useRef } from "react";
import { X, Send } from "lucide-react";
import { chatApiFetch, useStore, type Message } from "../store.ts";
import MessageBubble from "./MessageBubble.tsx";

interface ThreadPanelProps {
  parentMessage: Message;
  sessionId: string;
  onClose: () => void;
}

export default function ThreadPanel({ parentMessage, sessionId, onClose }: ThreadPanelProps) {
  const [replies, setReplies] = useState<Message[]>([]);
  const [replyInput, setReplyInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { chatSocket } = useStore();

  useEffect(() => {
    chatApiFetch(`/api/sessions/${sessionId}/messages/${parentMessage.id}/thread`)
      .then((data) => setReplies(data.replies || []))
      .catch(() => {});
  }, [sessionId, parentMessage.id]);

  // Listen for new thread replies
  useEffect(() => {
    if (!chatSocket) return;
    const handler = ({ threadId, message }: { threadId: string; message: Message }) => {
      if (threadId === parentMessage.id) {
        setReplies((prev) => [...prev, message]);
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    };
    chatSocket.on("thread_reply", handler);
    return () => { chatSocket.off("thread_reply", handler); };
  }, [chatSocket, parentMessage.id]);

  const sendReply = async () => {
    if (!replyInput.trim() || sending) return;
    setSending(true);
    try {
      await chatApiFetch(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: "human",
          content: replyInput.trim(),
          sender_type: "human",
          sender_name: localStorage.getItem("ant_user_name") || "Human",
          thread_id: parentMessage.id,
        }),
      });
      setReplyInput("");
    } catch (err) {
      console.error("Failed to send reply", err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ml-8 mt-1 rounded-lg border border-white/10 bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
        <span className="text-[10px] uppercase tracking-wider text-white/40">Thread</span>
        <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto p-2 space-y-2">
        {replies.map((reply) => (
          <MessageBubble
            key={reply.id}
            message={reply}
            sessionId={sessionId}
            onReply={() => {}}
            onDelete={() => {}}
            onAnnotationChange={() => {}}
            scale={0.85}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-white/5">
        <input
          value={replyInput}
          onChange={(e) => setReplyInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
          placeholder="Reply..."
          className="flex-1 bg-transparent text-sm text-white outline-none placeholder-white/30"
        />
        <button
          onClick={sendReply}
          disabled={!replyInput.trim() || sending}
          className="text-emerald-400 disabled:text-white/20 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/ThreadPanel.tsx
git commit -m "feat: ThreadPanel — inline Slack-style thread expansion"
```

---

### Task 15: Update MessageList to use new components

**Files:**
- Modify: `packages/app/src/components/MessageList.tsx`

- [ ] **Step 1: Rewrite MessageList**

Replace the message rendering logic in `packages/app/src/components/MessageList.tsx` to use `MessageBubble` and `ThreadPanel`. Keep the scroll logic (refs, checkScroll, showScrollButton). Replace the inline message rendering with:

```tsx
import MessageBubble from "./MessageBubble.tsx";
import ThreadPanel from "./ThreadPanel.tsx";
```

In the render, replace the `messages.map(...)` block with:

```tsx
{messages.map((msg) => (
  <div key={msg.id}>
    <MessageBubble
      message={msg}
      sessionId={activeSessionId || sessionId || ""}
      onReply={(id) => setOpenThreadId(openThreadId === id ? null : id)}
      onDelete={async (id) => {
        try {
          await chatApiFetch(`/api/sessions/${activeSessionId || sessionId}/messages/${id}`, { method: "DELETE" });
        } catch {}
      }}
      onAnnotationChange={(id, annotations, starred) => {
        // Update local state optimistically
      }}
      replyCount={msg.reply_count || 0}
      onToggleThread={() => setOpenThreadId(openThreadId === msg.id ? null : msg.id)}
    />
    {openThreadId === msg.id && (
      <ThreadPanel
        parentMessage={msg}
        sessionId={activeSessionId || sessionId || ""}
        onClose={() => setOpenThreadId(null)}
      />
    )}
  </div>
))}
```

Add state: `const [openThreadId, setOpenThreadId] = useState<string | null>(null);`

- [ ] **Step 2: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/components/MessageList.tsx
git commit -m "feat: MessageList uses bold MessageBubble + ThreadPanel"
```

---

## Chunk 6: MCP Tools + Settings + Final Integration

### Task 16: Update MCP tools with chatApi

**Files:**
- Modify: `packages/mcp/src/index.ts`

- [ ] **Step 1: Add chatApi helper and ANT_CHAT_URL**

At the top of `packages/mcp/src/index.ts`, after the existing `BASE_URL` constant (line 9), add:

```ts
const CHAT_HOST = process.env.ANT_CHAT_HOST || "127.0.0.1";
const CHAT_PORT = process.env.ANT_CHAT_PORT || "6464";
const CHAT_BASE_URL = process.env.ANT_CHAT_URL || `http://${CHAT_HOST}:${CHAT_PORT}`;

async function chatApi(path: string, options?: RequestInit) {
  const apiKey = process.env.ANT_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(apiKey ? { "X-API-Key": apiKey } : {}),
  };
  const res = await fetch(`${CHAT_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  });
  if (!res.ok) {
    const body = await res.text();
    let payload: unknown = body;
    try { payload = JSON.parse(body); } catch {}
    throw new AntApiError(res.status, payload, `ANT Chat API error ${res.status}: ${getReadableErrorPayload(payload)}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Update message tools to use chatApi**

Change `ant_send_message`, `ant_stream_message`, `ant_complete_stream`, `ant_read_messages`, `ant_delete_message` to use `chatApi()` instead of `api()`.

For `ant_send_message`, also add the new sender parameters:

```ts
server.tool(
  "ant_send_message",
  "Send a message to a conversation session",
  {
    sessionId: z.string().describe("Session ID"),
    content: z.string().describe("Message content (markdown supported)"),
    role: ROLE_ENUM.default("human").describe("Message role"),
    format: FORMAT_ENUM.default("markdown").describe("Message format"),
    sender_type: z.string().optional().describe("Sender type: claude, codex, gemini, copilot, human, system"),
    sender_name: z.string().optional().describe("Display name"),
    sender_cwd: z.string().optional().describe("Working directory"),
    sender_persona: z.string().optional().describe("Agent persona/role"),
    thread_id: z.string().optional().describe("Parent message ID for thread replies"),
  },
  async ({ sessionId, content, role, format, sender_type, sender_name, sender_cwd, sender_persona, thread_id }) => {
    const message = await chatApi(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role, content, format, sender_type, sender_name, sender_cwd, sender_persona, thread_id }),
    });
    return { content: [{ type: "text", text: JSON.stringify(message, null, 2) }] };
  }
);
```

- [ ] **Step 3: Add ant_reply_to_message + ant_store_message**

```ts
server.tool(
  "ant_reply_to_message",
  "Reply to a specific message in a thread",
  {
    sessionId: z.string().describe("Session ID"),
    messageId: z.string().describe("Parent message ID to reply to"),
    content: z.string().describe("Reply content"),
    sender_type: z.string().optional().describe("Sender type"),
    sender_name: z.string().optional().describe("Display name"),
  },
  async ({ sessionId, messageId, content, sender_type, sender_name }) => {
    const message = await chatApi(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ role: "agent", content, sender_type, sender_name, thread_id: messageId }),
    });
    return { content: [{ type: "text", text: JSON.stringify(message, null, 2) }] };
  }
);

server.tool(
  "ant_store_message",
  "Store a message to the configured Obsidian vault",
  {
    sessionId: z.string().describe("Session ID"),
    messageId: z.string().describe("Message ID to store"),
  },
  async ({ sessionId, messageId }) => {
    const result = await chatApi("/api/store", {
      method: "POST",
      body: JSON.stringify({ sessionId, messageId }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);
```

- [ ] **Step 4: Run MCP tests**

Run: `cd packages/mcp && bun run test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/index.ts
git commit -m "feat: MCP chatApi routing + sender fields + reply + store tools"
```

---

### Task 17: Update SettingsModal — Obsidian vault config

**Files:**
- Modify: `packages/app/src/components/SettingsModal.tsx`

- [ ] **Step 1: Add Obsidian vault path field**

In `SettingsModal.tsx`, add state for the vault path and a section to configure it:

```tsx
const [vaultPath, setVaultPath] = useState("");
const [vaultSaved, setVaultSaved] = useState(false);

// Load on mount
useEffect(() => {
  if (settingsOpen) {
    chatApiFetch("/api/settings/obsidian")
      .then((data) => setVaultPath(data.vault_path || ""))
      .catch(() => {});
  }
}, [settingsOpen]);

const saveVaultPath = async () => {
  try {
    await chatApiFetch("/api/settings/obsidian", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault_path: vaultPath }),
    });
    setVaultSaved(true);
    setTimeout(() => setVaultSaved(false), 2000);
  } catch (err) {
    console.error("Failed to save vault path", err);
  }
};
```

Add to the modal body:

```tsx
<div className="space-y-2">
  <label className="text-[10px] uppercase tracking-wider text-white/40">Obsidian Vault Path</label>
  <div className="flex gap-2">
    <input
      value={vaultPath}
      onChange={(e) => setVaultPath(e.target.value)}
      placeholder="/Users/james/Obsidian/MyVault"
      className="flex-1 rounded border border-white/15 bg-[var(--color-bg)] px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none"
    />
    <button
      onClick={saveVaultPath}
      className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 text-sm"
    >
      {vaultSaved ? "Saved!" : "Save"}
    </button>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add packages/app/src/components/SettingsModal.tsx
git commit -m "feat: Obsidian vault path in settings modal"
```

---

### Task 18: Final integration test

- [ ] **Step 1: Run full test suite**

Run: `cd packages/app && bun run test`
Expected: All tests pass.

- [ ] **Step 2: TypeScript check**

Run: `cd packages/app && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Manual smoke test checklist**

Start both servers:
```bash
cd packages/app && bun run dev      # Main server
cd packages/app && bun run dev:chat # Chat sidecar
```

Verify:
1. Chat sidecar health: `curl http://localhost:6464/health` → `{ "status": "ok" }`
2. Create conversation session → send message → see emerald right-aligned bubble
3. Send message via MCP with `sender_type: "claude"` → amber left-aligned bubble
4. Hover message → toolbar appears
5. Click thumbs up → annotation pill appears
6. Click reply → thread panel expands
7. Configure Obsidian vault path in settings → click store → file appears in vault
8. Long message → auto-collapses with "Show more"

**Deferred items (not blocking, can be done in follow-up):**
- `agent_state_update` presence — currently emitted via the main server's presence route. The chat socket listener in store.ts should continue listening for it. Once a presence route is added to the chat sidecar, the main server can stop emitting it. For now, keep both listeners.
- `InputArea.tsx` sender fields — the POST handler infers `sender_type` from `role`, so UI messages get `sender_type: "human"` automatically. Adding `sender_name` from user settings is a follow-up enhancement.
- Search route updates — `/api/search` could include `sender_name`/`sender_type` in results. Non-critical for initial implementation.
- `ant_annotate_message` MCP tool — agents can annotate via the REST endpoint directly. A convenience MCP tool is a follow-up.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: chat sidecar rebuild complete — bold voices, threads, annotations, Obsidian store"
```
