# ANT v3 — Implementation Plan

## The Problem with v2

The current ANT is a Frankenstein monorepo: Express daemon (50+ TS files), React frontend, separate bridge/capture/cli/mcp packages, better-sqlite3 with node-gyp headaches, Socket.IO for real-time, and a growing pile of routes that were bolted on as features evolved. It works, but it's slow to iterate on, hard to reason about, and carries a lot of dead weight.

## The v3 Vision

A single SvelteKit + Bun application that does everything the current monorepo does, in roughly a third of the code, with better performance, simpler deployment, and a clear upgrade path to native.

---

## Architecture at a Glance

```
Mac Mini M4 Pro (64GB)
├── launchd LaunchDaemon (auto-start, auto-restart)
│   └── Bun + SvelteKit (port 3000)
│       ├── Server: API routes + WebSocket (native Bun)
│       ├── PTY: node-pty managing terminal sessions
│       ├── DB: bun:sqlite + WAL + FTS5
│       ├── Capture: dual-source pipeline
│       │   ├── node-pty onData → terminal_transcripts
│       │   └── ~/.claude/ JSONL watcher → structured data
│       └── Client: SvelteKit SSR + PWA
│           ├── Terminal: xterm.js (→ ghostty-web later)
│           ├── Chat: Svelte 5 reactive UI
│           └── Search: FTS5 via API routes
├── Tailscale (tailscale serve --bg 3000)
│   └── Auto HTTPS at jamess-mac-mini.tail34caea.ts.net
└── Obsidian vault (session summaries as markdown)
```

---

## Phase 1: Foundation (Days 1-3)

### 1.1 Project scaffold
```bash
bun create svelte@latest ant-v3  # SvelteKit with TypeScript
cd ant-v3
bun add @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-serialize
bun add node-pty nanoid strip-ansi gray-matter
bun add -d drizzle-orm drizzle-kit
```

Single package. No monorepo. SvelteKit handles both server and client.

### 1.2 Database (bun:sqlite + Drizzle)

**Schema design** — 6 core tables:

```sql
-- Sessions: unified container for terminals, chats, and agents
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('terminal','chat','agent')),
  workspace_id TEXT,
  root_dir TEXT,
  status TEXT DEFAULT 'idle',
  archived INTEGER DEFAULT 0,
  meta TEXT DEFAULT '{}',  -- JSON extensibility
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Messages: chat messages with FTS5 search
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,  -- 'user', 'assistant', 'system', 'tool'
  content TEXT NOT NULL,
  format TEXT DEFAULT 'text',
  status TEXT DEFAULT 'complete',
  meta TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

-- FTS5 index for message search (trigram for code, porter for prose)
CREATE VIRTUAL TABLE messages_fts USING fts5(
  content, tokenize='trigram'
);
-- Auto-sync triggers
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

-- Terminal transcripts: chunked raw output as BLOBs
CREATE TABLE terminal_transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  raw_data BLOB NOT NULL,  -- compressed raw terminal output
  timestamp TEXT DEFAULT (datetime('now'))
);

-- Workspaces: project grouping
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_dir TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Server state: heartbeat, shutdown tracking
CREATE TABLE server_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**PRAGMA config:**
```typescript
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA synchronous = NORMAL");
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA foreign_keys = ON");
db.run("PRAGMA cache_size = -64000");      // 64MB
db.run("PRAGMA mmap_size = 268435456");     // 256MB
db.run("PRAGMA temp_store = MEMORY");
```

### 1.3 PTY manager

Port the core PTY logic from `daemon/src/pty-manager.ts`. Key simplifications:
- Use Bun's native WebSocket instead of Socket.IO
- Direct `node-pty` → WebSocket pipe (no intermediate event bus)
- Session lifecycle: spawn → attach → detach → reattach → kill
- `dtach` for session persistence across server restarts

```typescript
// Simplified PTY lifecycle
class PTYManager {
  private sessions = new Map<string, pty.IPty>();

  spawn(sessionId: string, cwd: string): pty.IPty;
  write(sessionId: string, data: string): void;
  resize(sessionId: string, cols: number, rows: number): void;
  kill(sessionId: string): void;

  // Dual capture: raw output → DB + stripped text → signals
  onData(sessionId: string, callback: (raw: Buffer) => void): void;
}
```

### 1.4 Tailscale + launchd

**LaunchDaemon plist** (`/Library/LaunchDaemons/vc.newmodel.ant.plist`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>vc.newmodel.ant</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/jamesking/.bun/bin/bun</string>
    <string>run</string>
    <string>build/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/jamesking/projects/ant-v3</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>UserName</key>
  <string>jamesking</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ANT_PORT</key>
    <string>3000</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>StandardOutPath</key>
  <string>/var/log/ant/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/ant/stderr.log</string>
</dict>
</plist>
```

**Tailscale HTTPS:**
```bash
tailscale serve --bg 3000
# Auto-provisions cert for jamess-mac-mini.tail34caea.ts.net
```

---

## Phase 2: Server API (Days 3-5)

### 2.1 SvelteKit API routes

Replace the 20+ Express route files with SvelteKit's file-based routing:

```
src/routes/
├── api/
│   ├── health/+server.ts              GET
│   ├── sessions/
│   │   ├── +server.ts                 GET (list), POST (create)
│   │   └── [id]/
│   │       ├── +server.ts             GET, PATCH, DELETE
│   │       ├── messages/+server.ts    GET, POST
│   │       └── terminal/
│   │           └── input/+server.ts   POST
│   ├── workspaces/+server.ts          GET, POST
│   ├── search/+server.ts              GET (FTS5 query)
│   └── upload/+server.ts              POST
├── +layout.svelte                      Shell layout
├── +page.svelte                        Dashboard / session list
└── session/
    └── [id]/+page.svelte               Session detail (chat/terminal)
```

~10 route files replacing ~20 Express route files. Each is self-contained with its own request handlers.

### 2.2 WebSocket handler

Bun has native WebSocket support. SvelteKit doesn't directly expose it, but we can attach a WebSocket upgrade handler in the server hooks:

```typescript
// src/hooks.server.ts
export const handle: Handle = async ({ event, resolve }) => {
  // WebSocket upgrade for terminal I/O
  if (event.request.headers.get('upgrade') === 'websocket') {
    return handleWebSocket(event);
  }
  return resolve(event);
};
```

This replaces Socket.IO entirely. Native WebSocket is simpler, faster, and has no client library dependency. The iOS app's SocketIO client would need updating to use standard WebSocket — but that's a cleaner protocol anyway.

### 2.3 Middleware

Port from v2 but simplify:
- **Tailscale IP check**: verify `request.headers.get('x-forwarded-for')` or direct peer IP is in 100.64.0.0/10
- **API key auth**: optional Bearer token check
- **Rate limiting**: not needed for single-user

---

## Phase 3: Frontend (Days 5-8)

### 3.1 Svelte 5 UI

The entire React frontend (zustand stores, React components, Socket.IO client) gets rewritten in Svelte 5. Key advantages:
- Svelte 5 runes (`$state`, `$derived`, `$effect`) replace zustand stores
- No virtual DOM overhead — direct DOM updates
- Smaller bundle — ~30% less JS shipped
- You already know Svelte

**Component structure:**
```
src/lib/
├── components/
│   ├── SessionList.svelte         Session sidebar
│   ├── SessionCard.svelte         Individual session card
│   ├── Terminal.svelte            xterm.js wrapper
│   ├── Chat.svelte                Chat interface
│   ├── MessageBubble.svelte       Chat message
│   ├── MessageInput.svelte        Chat input bar
│   ├── CLIInput.svelte            Terminal input bar
│   ├── SignalView.svelte          Parsed terminal signals
│   ├── SearchPanel.svelte         FTS5 search UI
│   └── Settings.svelte            Configuration
├── stores/
│   ├── sessions.svelte.ts         Session state (Svelte 5 runes)
│   ├── terminal.svelte.ts         Terminal state per session
│   ├── messages.svelte.ts         Chat messages per session
│   └── ws.svelte.ts               WebSocket connection manager
├── utils/
│   ├── ansi.ts                    ANSI stripping/parsing
│   ├── signals.ts                 Terminal signal classifier
│   └── time.ts                    Relative time formatting
└── theme.ts                       Design tokens
```

### 3.2 Terminal rendering

```svelte
<script lang="ts">
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';

  let { sessionId } = $props();
  let termRef = $state<HTMLDivElement>();

  $effect(() => {
    if (!termRef) return;
    const term = new Terminal({ /* theme colours */ });
    const fit = new FitAddon();
    term.loadAddon(fit);

    try { term.loadAddon(new WebglAddon()); }
    catch { /* canvas fallback for Safari */ }

    term.open(termRef);
    fit.fit();

    // WebSocket connection to PTY
    const ws = new WebSocket(`wss://${location.host}/ws/terminal/${sessionId}`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => term.write(new Uint8Array(e.data));
    term.onData((data) => ws.send(data));

    return () => { ws.close(); term.dispose(); };
  });
</script>

<div bind:this={termRef} class="h-full w-full"></div>
```

**Future swap to ghostty-web:** change the import and terminal instantiation. The API is xterm.js-compatible. Monitor the ghostty-web npm package for the RenderState delta-update API adoption.

### 3.3 PWA manifest

```json
{
  "name": "ANT",
  "short_name": "ANT",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0A1628",
  "theme_color": "#22C55E",
  "icons": [{ "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }]
}
```

Add `visibilitychange` listener for WebSocket reconnection on iPad sleep/wake.

---

## Phase 4: Capture Pipeline (Days 8-10)

### 4.1 Source 1: PTY raw capture

Already built into the PTY manager. Every `onData` callback:
1. Strips ANSI → stores clean text in `terminal_transcripts`
2. Runs signal classifier (error/success/prompt detection)
3. Emits to connected WebSocket clients

### 4.2 Source 2: Claude JSONL watcher

```typescript
// src/lib/server/capture/claude-watcher.ts
import { watch } from 'fs';

const CLAUDE_DIR = `${process.env.HOME}/.claude/projects`;

watch(CLAUDE_DIR, { recursive: true }, (event, filename) => {
  if (!filename?.endsWith('.jsonl')) return;
  // Parse new lines, extract messages, tool calls, tokens
  // Insert into messages table with session linkage
  // Update FTS5 index automatically via trigger
});
```

### 4.3 Obsidian integration

On session close or on-demand:
```typescript
import matter from 'gray-matter';

function writeSessionSummary(session: Session, summary: string) {
  const frontmatter = {
    session_id: session.id,
    project: session.workspace?.name,
    type: session.type,
    duration_minutes: calculateDuration(session),
    tokens_used: session.meta.tokens,
    tags: extractTags(summary),
    date: new Date().toISOString(),
  };

  const md = matter.stringify(summary, frontmatter);
  const path = `${VAULT_PATH}/coding-sessions/${year}/${month}/${session.name}.md`;
  Bun.write(path, md);
}
```

---

## Phase 5: Search & Polish (Days 10-12)

### 5.1 FTS5 search API

```typescript
// src/routes/api/search/+server.ts
export async function GET({ url }) {
  const q = url.searchParams.get('q');
  const results = db.prepare(`
    SELECT m.id, m.session_id, m.role,
           snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) as snippet,
           rank
    FROM messages_fts
    JOIN messages m ON messages_fts.rowid = m.rowid
    WHERE messages_fts MATCH ?
    ORDER BY rank
    LIMIT 50
  `).all(q);

  return json(results);
}
```

### 5.2 Retention lifecycle

- **Hot**: SQLite, 90 days (configurable)
- **Warm**: compressed JSONL archives on disk
- **Cold**: external storage (optional)
- Weekly: `FTS5 optimize` + `VACUUM`

---

## What Gets Carried Forward from v2

| Component | v2 | v3 | Notes |
|-----------|----|----|-------|
| Terminal signal classifier | `SignalClassifier` | Port directly | Regex patterns are good |
| PTY manager core logic | `pty-manager.ts` | Simplify & port | Remove dtach complexity initially |
| Tailscale middleware | `localhost.ts` | Port directly | IP checking logic works |
| API key auth | `auth.ts` | Port directly | Simple Bearer check |
| ANSI stripping | Custom regex | Port directly | Already working |
| Session/message schemas | better-sqlite3 | Migrate to bun:sqlite | Schema mostly same |
| Retention logic | `retention.ts` | Port & simplify | Timer-based sweep |

| Component | v2 | v3 | Notes |
|-----------|----|----|-------|
| Express | 20+ route files | SvelteKit file routes | ~50% less code |
| React + zustand | ~4000 LOC | Svelte 5 runes | ~60% less code |
| Socket.IO | Client + server | Native WebSocket | No dependency |
| better-sqlite3 | node-gyp pain | bun:sqlite | 3-6x faster reads |
| Monorepo (7 packages) | Complex builds | Single SvelteKit app | One `bun run build` |
| Vite dev proxy | Separate config | SvelteKit built-in | Zero config |
| PM2 / manual | Process management | launchd | Native macOS |

## What Gets Dropped

- **React** — replaced by Svelte 5
- **Socket.IO** — replaced by native WebSocket
- **better-sqlite3** — replaced by bun:sqlite
- **Express** — replaced by SvelteKit server routes
- **Monorepo structure** — single package
- **Tiptap** (rich text editor) — lightweight markdown rendering instead
- **zustand** — Svelte 5 runes handle state natively
- **The bridge/capture/daemon split** — unified into one server

---

## iOS App Impact

The antios Swift app needs updates to work with v3:

1. **WebSocket**: Replace SocketIO client with `URLSessionWebSocketTask` (native Swift WebSocket). This is actually simpler and removes the SocketIO dependency.
2. **API endpoints**: Same REST structure, so minimal changes. URL paths stay the same.
3. **Auth**: Same Bearer token mechanism.
4. **HTTPS**: Already configured with Tailscale certs.

The iOS changes are modest — mainly swapping SocketIO for native WebSocket.

---

## Timeline Summary

| Phase | Days | Deliverable |
|-------|------|-------------|
| 1. Foundation | 1-3 | Scaffold, DB, PTY, launchd, Tailscale |
| 2. Server API | 3-5 | All API routes, WebSocket handler, middleware |
| 3. Frontend | 5-8 | Svelte UI, terminal, chat, search |
| 4. Capture | 8-10 | Dual-source pipeline, Obsidian integration |
| 5. Polish | 10-12 | FTS5 search, retention, PWA manifest |

**Total: ~12 focused days to feature parity with v2, but cleaner, faster, and more maintainable.**

---

## First Commit Checklist

```bash
bun create svelte@latest ant-v3 -- --template skeleton --types typescript
cd ant-v3
bun add @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-serialize
bun add node-pty nanoid strip-ansi gray-matter chokidar
bun add -d drizzle-orm drizzle-kit tailwindcss @tailwindcss/vite
# Init DB, create schema, add first API route, render "Hello ANT v3"
```
