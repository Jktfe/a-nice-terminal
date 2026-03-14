# Chat Sidecar Rebuild — "Bold Voices"

## Context

ANT's chat sidecar (`chat-server.ts`) is a 40-line shell with fundamental issues: WebSocket room management is missing (`join_session`/`leave_session` events are ignored), no auth middleware, no graceful shutdown, and no way to distinguish between agents in a conversation. Real-time message delivery only works because the main server's `handlers.ts` duplicates chat logic — the sidecar's Socket.IO broadcasts to empty rooms.

Meanwhile the conversation UI treats all messages identically — no visual distinction between human, Claude, Codex, Gemini, or system messages. There are no interactions beyond delete.

The terminal rebuild proved the sidecar pattern works. Now the chat sidecar needs to earn its place: proper WebSocket infrastructure, rich message identity, and meaningful interactions.

## Goals

1. **Fix the sidecar** — proper room management, auth, shutdown. The chat server becomes the single owner of conversation traffic.
2. **Bold identity** — each voice (human, Claude, Codex, Gemini, Copilot, system) gets its own colour world, logo, and spatial position. Scan a conversation and instantly know who's talking.
3. **Interactions** — annotate, reply (Slack-style threads), copy, collapse/expand, store to Obsidian, delete.
4. **Clean separation** — main server owns terminals + agent API. Chat sidecar owns conversations + presence + threads. No duplication.

## Non-Goals

- Full agent registration/management system
- Deep thread nesting (replies to replies)
- Real-time collaborative editing of messages
- Obsidian sync (bidirectional) — this is write-only

---

## Architecture

```
Main Server (:6458)              Chat Sidecar (:6464)
├── Terminal PTY lifecycle       ├── Message CRUD + threads
├── /terminal namespace (WS)     ├── Annotations
├── Agent API (REST + SSE)       ├── Presence broadcasting
├── Session/workspace CRUD       ├── Store to Obsidian
└── Vite dev server              └── Chat WebSocket rooms
                                      ├── join_session
     Shared: SQLite WAL DB            ├── leave_session
     (better-sqlite3)                 ├── message_created
                                      ├── thread_reply
                                      └── annotation_changed
```

Both servers share the same SQLite database with WAL mode. To handle concurrent writes safely, both servers **must** set `db.pragma("busy_timeout = 5000")` so writes from either process wait rather than failing with `SQLITE_BUSY`.

The main server no longer handles any conversation WebSocket events (`new_message`, `stream_chunk`, `stream_end` are removed from `handlers.ts`).

---

## Schema Changes

### Modified: `messages` table

New columns added via migration (non-destructive — existing messages get defaults). Each column uses the established try/ALTER/catch pattern from existing migrations in `db.ts`:

```ts
// Each column added individually with try/catch (column may already exist)
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_type TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_cwd TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_persona TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN thread_id TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN annotations TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`); } catch {}
```

| Column | Type | Default | Purpose |
|--------|------|---------|---------|
| `sender_type` | TEXT | NULL | `claude`, `codex`, `gemini`, `copilot`, `human`, `system`, `unknown` |
| `sender_name` | TEXT | NULL | Display name (e.g. "Claude", "James") |
| `sender_cwd` | TEXT | NULL | Working directory at time of message |
| `sender_persona` | TEXT | NULL | Role/persona (e.g. "code-reviewer") |
| `thread_id` | TEXT | NULL | Parent message ID for thread replies. NULL = top-level. |
| `annotations` | TEXT | NULL | JSON array of annotations |
| `starred` | INTEGER | 0 | Boolean flag for fast `?starred=true` queries (avoids JSON scanning) |

**INSERT default:** When `sender_type` is not provided on a new message, it is inferred from `role` at INSERT time: `human` → `human`, `agent` → `unknown`, `system` → `system`.

**Migration for existing rows:**
```sql
UPDATE messages SET sender_type = 'human' WHERE sender_type IS NULL AND role = 'human';
UPDATE messages SET sender_type = 'unknown' WHERE sender_type IS NULL AND role = 'agent';
UPDATE messages SET sender_type = 'system' WHERE sender_type IS NULL AND role = 'system';
```

**Thread parent deletion:** Deleting a parent message cascades — all replies with `thread_id` pointing to it are also deleted. This is implemented in the DELETE handler (not via FK constraint, since SQLite's FK support for same-table references is limited).

**Indices:**
```sql
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_starred ON messages(starred) WHERE starred = 1;
```

### New: `settings` updates

Obsidian vault path stored in `server_state` table (already exists):
- Key: `obsidian_vault_path`, Value: absolute path to vault folder

---

## Chat Sidecar Server (`chat-server.ts`)

### Current Problems
- `join_session`/`leave_session` events are never handled — Socket.IO rooms are empty
- No auth middleware — wide open to any connection
- No graceful shutdown or heartbeat
- `cors: "*"` with no restrictions

### Rebuild

**New file: `server/ws/chat-handlers.ts`**

Handles Socket.IO events for the chat sidecar:
- `join_session` — join Socket.IO room, track per-socket
- `leave_session` — leave room
- `stream_chunk` — client→server: `{ sessionId, messageId, content }` — append content to streaming message, broadcast to room
- `stream_end` — client→server: `{ sessionId, messageId }` — finalise streaming message, broadcast `message_updated`
- `disconnect` — clean up joined sessions
- Mirrors the pattern established in `terminal-namespace.ts`

**Rebuilt `chat-server.ts`:**
- **Socket.IO auth middleware:** Uses a Socket.IO-compatible wrapper (not Express middleware directly). Same logic as `server/index.ts` lines 67-79: extract API key from `socket.handshake.auth.apiKey`, `socket.handshake.query.apiKey`, or `Authorization` header. Check against `ANT_API_KEY` env var. Also check `isAllowedHost` on the socket's remote address.
- **Express middleware:** `tailscaleOnly` + `apiKeyAuth` for REST routes (imported from existing middleware files).
- Register chat handlers via `chat-handlers.ts`
- Mount routes: messages, annotations, store, settings/obsidian
- Graceful shutdown with `last_shutdown_chat` key in `server_state` (namespaced separately from main server's `last_shutdown`)
- Heartbeat every 30s using `last_heartbeat_chat` key (avoids write conflicts with main server's `last_heartbeat`)

---

## Bold Identity System

### Colour Assignments

| Sender Type | Accent Colour | Hex | Bubble Position |
|------------|---------------|-----|-----------------|
| `human` | Emerald | `#10b981` | Right-aligned |
| `claude` | Orange/Amber | `#f59e0b` | Left-aligned |
| `codex` | Green | `#22c55e` | Left-aligned |
| `gemini` | Blue | `#3b82f6` | Left-aligned |
| `copilot` | Purple | `#a855f7` | Left-aligned |
| `system` | Neutral grey | `#525252` | Centre-aligned, muted |
| `unknown` | White/default | `#e5e5e5` | Left-aligned |

### Message Bubble Anatomy

```
┌─ Agent messages (left-aligned) ──────────────────────┐
│                                                       │
│  [Logo]  3px accent border left                       │
│          Message content here...                      │
│                                                       │
│          [👍] [🚩]                    14:32            │
│          2 replies ▾                                  │
└───────────────────────────────────────────────────────┘

              ┌─ Human messages (right-aligned) ────────┐
              │                                         │
              │       3px accent border right    [Logo] │
              │       Your message here...              │
              │                                         │
              │       14:33                              │
              └─────────────────────────────────────────┘

          ┌─ System messages (centre-aligned) ──┐
          │  [⚙]  System notification text       │
          │                          14:34       │
          └──────────────────────────────────────┘
```

### Components

**`SenderAvatar.tsx`:**
- 20px logo icon for each sender type (model logos, person silhouette, gear icon)
- Tooltip on hover: compact card showing sender name, persona, cwd
- Falls back to a generic icon for `unknown` type

**`MessageBubble.tsx`:**
- Receives full message object with sender fields
- Applies colour theme from `senderTheme.ts`
- Right-aligned for human, left-aligned for agents, centre for system
- 3px accent border on the appropriate side
- Auto-collapse for messages >15 lines (first 6 lines + gradient fade + "Show more")
- Renders annotation pills below content
- Thread indicator ("N replies" with participant avatars) below annotations

**`senderTheme.ts`:**
- Maps `sender_type` → `{ accent, bg, border, icon }`
- Single source of truth for all colour decisions

---

## Interactions

### Hover Toolbar (`MessageToolbar.tsx`)

Appears top-right of bubble on hover. Icons only, tooltips on hover. Actions:

| Icon | Action | Behaviour |
|------|--------|-----------|
| 👍 | Thumbs up | Toggle annotation |
| 👎 | Thumbs down | Toggle annotation |
| 🚩 | Flag | Toggle annotation (optional note via popover) |
| ⭐ | Star/bookmark | Toggle — adds gold accent border, searchable |
| ↩ | Reply | Opens inline thread panel below message |
| 📋 | Copy | Copy message content as markdown |
| 📥 | Store | Write to Obsidian vault |
| 🗑 | Delete | Existing delete behaviour |

### Annotations

Stored as JSON array in the `annotations` column:

```json
[
  { "type": "thumbs_up", "by": "human", "at": "2026-03-14T10:30:00Z" },
  { "type": "flag", "by": "human", "at": "2026-03-14T10:31:00Z", "note": "useful pattern" }
]
```

Types: `thumbs_up`, `thumbs_down`, `flag`, `star`

**Toggle semantics:** The `POST /annotate` endpoint is idempotent by `(type, by)` pair. If an annotation with the same `type` and `by` already exists, it is removed (toggle off). Otherwise it is added (toggle on). This means posting `thumbs_up` twice removes it.

**The `by` field:** For UI-initiated annotations, `by` is always `"human"`. For MCP/API-initiated annotations, `by` is the value of the `sender_name` or `sender_type` header, or defaults to `"api"`. This allows agents to annotate messages too (e.g. an agent flagging its own output as uncertain).

**Star fast-path:** Starring is **only** done via the annotation endpoint (`POST /annotate` with `type: "star"`). There is no separate star mechanism. When the annotation endpoint toggles a `star` annotation on, it also sets the `starred` INTEGER column to `1`. When toggled off, set to `0`. This single code path prevents the annotation JSON and the column from getting out of sync. The toolbar's star button simply calls the same annotate endpoint.

**Annotation cap:** Maximum 50 annotations per message. The endpoint rejects additions beyond this limit with a `400` response. This prevents unbounded growth from programmatic annotation.

Displayed as small pills below message content. Star also adds a visual accent to the bubble border.

### Threads (`ThreadPanel.tsx`)

Slack-style inline expansion:

- Click "Reply" or "N replies" → panel expands below the parent message
- All replies are flat within the thread (no nesting)
- Replies use the same bold identity system at ~85% scale
- Compact compose box at the bottom of the thread panel
- New replies broadcast via `thread_reply` WebSocket event to update open threads in real time
- Thread can be collapsed back to the "N replies" indicator

### Copy

- Copies full message content as markdown to clipboard
- Code blocks within messages get individual copy buttons (standard pattern)

### Collapse/Expand

- Messages >15 lines auto-collapse on render
- Shows first 6 lines + gradient fade + "Show more" toggle
- Manual toggle state is client-side only (not persisted)
- Collapsed state resets on page refresh

### Store to Obsidian

**Endpoint:** `POST /api/store`

**Request:** `{ messageId, sessionId }`

**Server behaviour:**
1. Read message from DB (with sender fields)
2. Format as markdown with YAML frontmatter
3. Write to `{vault_path}/ANT/{filename}.md`
4. Create `ANT/` subdirectory if it doesn't exist

**Response:** `{ stored: true, path: "/absolute/path/to/vault/ANT/filename.md", filename: "ANT-session-name-2026-03-14T10-30-00Z.md" }`
**Error responses:** `400` if vault path not configured, `404` if message not found, `500` if write fails.

**File format:**
```markdown
---
source: ANT
session: "Session Name"
sender_type: claude
sender_name: Claude
persona: code-reviewer
timestamp: 2026-03-14T10:30:00Z
thread: true  # if this is a thread reply
---

Message content here...
```

**File naming:** `ANT-{session-name}-{ISO-timestamp}.md` (sanitised for filesystem)

**Configuration:**
- `ANT_OBSIDIAN_VAULT` env var or via `PATCH /api/settings/obsidian`
- Stored in `server_state` table as `obsidian_vault_path`
- Settings modal gets an "Obsidian Vault" field to configure the path

---

## API Surface

### Modified Endpoints

**`POST /api/sessions/:id/messages`** — accepts new fields:
```json
{
  "role": "agent",
  "content": "...",
  "format": "markdown",
  "sender_type": "claude",
  "sender_name": "Claude",
  "sender_cwd": "/Users/james/proj",
  "sender_persona": "code-reviewer",
  "thread_id": "parent_msg_id_or_null"
}
```

**`GET /api/sessions/:id/messages`** — returns sender fields, annotations, and `reply_count` (integer, number of messages with `thread_id` pointing to this message). Computed via correlated subquery:
```sql
SELECT m.*, (SELECT COUNT(*) FROM messages r WHERE r.thread_id = m.id) AS reply_count
FROM messages m WHERE m.session_id = ? AND m.thread_id IS NULL
ORDER BY m.created_at ASC LIMIT ?
```
This enables the UI to render "N replies" indicators without N+1 queries. Supports:
- `?thread_id=X` — fetch only replies to message X
- `?starred=true` — fetch only starred messages (uses the `starred` INTEGER column for fast filtering)

**`DELETE /api/sessions/:id/messages/:msgId`** — **fix:** broadcast `{ id, sessionId }` (currently only sends `{ id }`). Also cascade-delete all messages where `thread_id = msgId`.

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/sessions/:id/messages/:msgId/thread` | Get parent message + all replies |
| `POST` | `/api/sessions/:id/messages/:msgId/annotate` | Add/toggle annotation: `{ type, note? }` |
| `POST` | `/api/store` | Store message to Obsidian: `{ messageId, sessionId }` |
| `GET` | `/api/settings/obsidian` | Get vault path config |
| `PATCH` | `/api/settings/obsidian` | Set vault path |

### WebSocket Events (Chat Sidecar)

| Event | Direction | Payload |
|-------|-----------|---------|
| `join_session` | client→server | `{ sessionId }` |
| `leave_session` | client→server | `{ sessionId }` |
| `message_created` | server→client | Full message with sender fields + `reply_count` |
| `message_updated` | server→client | Full message |
| `message_deleted` | server→client | `{ id, sessionId }` |
| `stream_chunk` | bidirectional | client→server: `{ sessionId, messageId, content }`. Server relays to room as server→client so all connected tabs see streaming content in real time. |
| `stream_end` | bidirectional | client→server: `{ sessionId, messageId }`. Server finalises message, broadcasts `message_updated` to room. |
| `thread_reply` | server→client | `{ threadId, message }` |
| `annotation_changed` | server→client | `{ messageId, annotations, starred }` |
| `agent_state_update` | server→client | `{ sessionId, agentId, state }` |

### Removed from Main Server

- `new_message` handler in `ws/handlers.ts`
- `stream_chunk` handler in `ws/handlers.ts`
- `stream_end` handler in `ws/handlers.ts`

These are now exclusively handled by the chat sidecar.

### MCP Tool Changes

**Base URL routing:** The MCP server (`packages/mcp/src/index.ts`) currently uses a single `BASE_URL` for all API calls. Message-related tools must target the chat sidecar, not the main server. Add a new env var:

```
ANT_CHAT_URL — defaults to http://127.0.0.1:6464
```

Add a `chatApi()` helper alongside the existing `api()` function, using `CHAT_BASE_URL`. Terminal/session tools continue using `BASE_URL` (main server). Message/annotation/store tools use `CHAT_BASE_URL`.

**Modified:**
- `ant_send_message` — uses `chatApi()`, accepts `sender_type`, `sender_name`, `sender_cwd`, `sender_persona`, `thread_id`
- `ant_stream_message` — uses `chatApi()`
- `ant_complete_stream` — uses `chatApi()`
- `ant_read_messages` — uses `chatApi()`
- `ant_delete_message` — uses `chatApi()`

**New:**
- `ant_reply_to_message` — convenience wrapper: `{ sessionId, messageId, content, sender_type, ... }` → sets `thread_id` automatically
- `ant_store_message` — wraps `POST /api/store`: `{ sessionId, messageId }`

---

## File Structure

### New Files
- `server/ws/chat-handlers.ts` — Socket.IO room management + event handlers
- `server/routes/annotations.ts` — annotation endpoints
- `server/routes/store.ts` — Obsidian store endpoint
- `src/components/MessageBubble.tsx` — single message with bold identity + collapse
- `src/components/ThreadPanel.tsx` — inline Slack-style thread expansion
- `src/components/SenderAvatar.tsx` — logo icon + tooltip
- `src/components/MessageToolbar.tsx` — hover action bar
- `src/utils/senderTheme.ts` — colour/icon mapping

### Modified Files
- `server/chat-server.ts` — rebuilt with auth, rooms, shutdown
- `server/db.ts` — migration for sender columns, thread_id, annotations
- `server/routes/messages.ts` — accept/return sender fields, thread queries
- `server/ws/handlers.ts` — remove `new_message`, `stream_chunk`, `stream_end`
- `src/components/MessageList.tsx` — use MessageBubble, thread expansion
- `src/store.ts` — replace `apiFetch` URL-sniffing heuristic with explicit `chatApiFetch(url, options)` that always targets `CHAT_URL`. All message/annotation/store/thread calls use `chatApiFetch`. Terminal/session calls continue using `apiFetch` (main server). Add `stream_chunk`/`stream_end` events on the chat socket.
- `src/components/SettingsModal.tsx` — Obsidian vault path config
- `packages/mcp/src/index.ts` — updated/new MCP tools

### Unchanged
- Terminal pipeline (entire rebuild from this session)
- Session/workspace CRUD
- Main server structure
- SQLite WAL, tmux backend, connection lifecycle
- Sidebar, Header, QuickSwitcher, SearchPanel, StatusBar

---

## What We Keep

- **Sidecar pattern** — proven by the terminal rebuild. Chat server and main server crash independently.
- **Shared SQLite** — both servers read/write the same `ant.db`. WAL mode handles concurrent access. Both servers set `db.pragma("busy_timeout = 5000")` to avoid `SQLITE_BUSY` errors from concurrent writes.
- **Shared route code** — `messages.ts` is imported by the chat sidecar only. The main server no longer mounts message routes (they are served exclusively by the sidecar). Session CRUD routes remain on the main server.
- **Message schema backward compatibility** — new columns are nullable, existing messages get sensible defaults via migration.

---

## Verification

### Chat sidecar
1. Start chat sidecar → health endpoint returns `{ status: "ok" }`
2. Connect WebSocket → `join_session` puts client in room
3. POST a message via REST → `message_created` event reaches connected clients
4. Disconnect → client removed from room

### Bold identity
1. Human sends message → emerald, right-aligned, person icon
2. Claude agent posts → amber, left-aligned, Claude logo
3. System message → grey, centred, gear icon
4. Hover any agent icon → tooltip shows name, persona, cwd

### Interactions
1. Hover message → toolbar appears
2. Click thumbs up → annotation pill appears, persists on refresh
3. Click reply → thread panel expands inline
4. Post reply → appears in thread, `thread_reply` event fires
5. Click store → `.md` file appears in Obsidian vault `ANT/` folder
6. Long message → auto-collapses, "Show more" expands

### MCP
```bash
# Agent sends identified message
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"content":"Hello","role":"agent","sender_type":"claude","sender_name":"Claude"}' \
  http://localhost:6464/api/sessions/$SID/messages

# Reply to a message
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"content":"Follow-up","role":"agent","sender_type":"claude","thread_id":"MSG_ID"}' \
  http://localhost:6464/api/sessions/$SID/messages

# Store to Obsidian
curl -X POST -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"messageId":"MSG_ID","sessionId":"SID"}' \
  http://localhost:6464/api/store
```
