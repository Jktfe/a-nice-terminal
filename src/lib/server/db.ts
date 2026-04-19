// ANT v3 — Database layer
// Uses bun:sqlite when running under Bun, better-sqlite3 under Node
// Lazy initialization: DB is created on first access, not at import time
// This prevents build-time errors (SvelteKit build runs under Node)

import { join } from 'path';
import { mkdirSync } from 'fs';
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);

const DATA_DIR = process.env.ANT_DATA_DIR || join(process.env.HOME || '/tmp', '.ant-v3');
const DB_PATH = join(DATA_DIR, 'ant.db');

// Detect runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- globalThis.Bun is not in TS lib; runtime check only
const isBun = typeof (globalThis as any).Bun !== 'undefined';

// Use globalThis to ensure tsx (server.ts) and SvelteKit build share the SAME
// DB instance. Without this, each module context creates its own connection and
// the build's copy may not have run migrations.
const G = globalThis as any;
const DB_KEY = '__ant_db__';
let _db: any = G[DB_KEY] ?? null;

function getDb(): any {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });

  if (isBun) {
    const { Database } = _require('bun:sqlite');
    _db = new Database(DB_PATH);
  } else {
    const Database = _require('better-sqlite3');
    _db = new Database(DB_PATH);
  }
  G[DB_KEY] = _db;

  // Performance PRAGMAs for M4 Pro with 64GB RAM
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA synchronous = NORMAL");
  _db.exec("PRAGMA busy_timeout = 5000");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA cache_size = -64000");
  _db.exec("PRAGMA mmap_size = 268435456");
  _db.exec("PRAGMA temp_store = MEMORY");

  // Schema
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('terminal','chat','agent')),
    workspace_id TEXT,
    root_dir TEXT,
    status TEXT DEFAULT 'idle',
    archived INTEGER DEFAULT 0,
    ttl TEXT DEFAULT '15m',
    deleted_at TEXT,
    last_activity TEXT,
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  // Migrations for existing DBs
  const cols = G[DB_KEY].prepare(`PRAGMA table_info(sessions)`).all().map((c: any) => c.name);
  if (!cols.includes('ttl'))           G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN ttl TEXT DEFAULT '15m'`);
  if (!cols.includes('deleted_at'))    G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN deleted_at TEXT`);
  if (!cols.includes('last_activity')) G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN last_activity TEXT`);
  if (!cols.includes('handle'))        G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN handle TEXT`);
  if (!cols.includes('display_name'))  G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN display_name TEXT`);
  if (!cols.includes('cli_flag'))      G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN cli_flag TEXT`);
  if (!cols.includes('alias'))         G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN alias TEXT`);

  // Chat room membership — tracks who participates vs who just posts
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS chat_room_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    role TEXT DEFAULT 'participant',
    cli_flag TEXT,
    joined_at TEXT DEFAULT (datetime('now')),
    UNIQUE(room_id, session_id)
  )`);

  // Migration: add alias column to chat_room_members for per-room identity
  const crmCols = G[DB_KEY].prepare(`PRAGMA table_info(chat_room_members)`).all().map((c: any) => c.name);
  if (!crmCols.includes('alias')) G[DB_KEY].exec(`ALTER TABLE chat_room_members ADD COLUMN alias TEXT`);

  // Channel registry — maps @handles to MCP channel server ports
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS channel_registry (
    handle TEXT PRIMARY KEY,
    port INTEGER NOT NULL,
    session_id TEXT,
    registered_at TEXT DEFAULT (datetime('now'))
  )`);

  // Delivery log — tracks message delivery for replay on reconnect
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS delivery_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    adapter TEXT NOT NULL,
    delivered INTEGER DEFAULT 0,
    error TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_delivery_log_session ON delivery_log(session_id, created_at)`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    format TEXT DEFAULT 'text',
    status TEXT DEFAULT 'complete',
    sender_id TEXT,
    target TEXT,
    msg_type TEXT DEFAULT 'message',
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Migrations for messages table
  const msgCols = G[DB_KEY].prepare(`PRAGMA table_info(messages)`).all().map((c: any) => c.name);
  if (!msgCols.includes('sender_id')) G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN sender_id TEXT`);
  if (!msgCols.includes('target'))    G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN target TEXT`);
  if (!msgCols.includes('msg_type'))  G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN msg_type TEXT DEFAULT 'message'`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);

  G[DB_KEY].exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content, tokenize='trigram'
  )`);

  G[DB_KEY].exec(`CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END`);

  G[DB_KEY].exec(`CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
    UPDATE messages_fts SET content = new.content WHERE rowid = new.rowid;
  END`);

  G[DB_KEY].exec(`CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
  END`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS terminal_transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    raw_data BLOB NOT NULL,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_session ON terminal_transcripts(session_id)`);

  // Migrations for terminal_transcripts — per-row millisecond precision + cumulative
  // byte offset per session, both needed by the history read paths and the idle-tick
  // script. Added in the same commit that introduces the history API.
  const trCols = G[DB_KEY].prepare(`PRAGMA table_info(terminal_transcripts)`).all().map((c: any) => c.name);
  if (!trCols.includes('ts_ms'))       G[DB_KEY].exec(`ALTER TABLE terminal_transcripts ADD COLUMN ts_ms INTEGER`);
  if (!trCols.includes('byte_offset')) G[DB_KEY].exec(`ALTER TABLE terminal_transcripts ADD COLUMN byte_offset INTEGER`);

  // Dedupe any (session_id, chunk_index) collisions that accumulated before the
  // restart bug was fixed — keep the row with the highest id for each pair, then
  // add a UNIQUE index so we can never collide again.
  try {
    G[DB_KEY].exec(`
      DELETE FROM terminal_transcripts
      WHERE id NOT IN (
        SELECT MAX(id) FROM terminal_transcripts GROUP BY session_id, chunk_index
      )
    `);
  } catch { /* non-fatal */ }
  G[DB_KEY].exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transcripts_session_chunk
            ON terminal_transcripts(session_id, chunk_index)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_session_ts
            ON terminal_transcripts(session_id, ts_ms)`);

  // FTS5 mirror of transcript text with ANSI stripped. rowid matches
  // terminal_transcripts.id so joins are cheap. Populated from TS (see
  // appendTranscriptWithText below) rather than a SQL trigger, because SQLite
  // can't strip ANSI without a user-defined function.
  G[DB_KEY].exec(`CREATE VIRTUAL TABLE IF NOT EXISTS terminal_text_fts USING fts5(
    text, tokenize='trigram'
  )`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    created_by TEXT,
    assigned_to TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'proposed',
    file_refs TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS file_refs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    flagged_by TEXT,
    file_path TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_file_refs_session ON file_refs(session_id)`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_dir TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS server_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    session_id TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`);

  G[DB_KEY].exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    key, value, tokenize='trigram'
  )`);

  G[DB_KEY].exec(`CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
  END`);

  G[DB_KEY].exec(`CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF key, value ON memories BEGIN
    UPDATE memories_fts SET key = new.key, value = new.value WHERE rowid = new.rowid;
  END`);

  G[DB_KEY].exec(`CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    DELETE FROM memories_fts WHERE rowid = old.rowid;
  END`);

  // Structured tmux control mode events — persistent timeline of what
  // happened inside a terminal session beyond the byte stream. Populated by
  // pty-daemon parsing `%window-*`, `%session-*`, `%layout-change`, `%exit`
  // and related control mode notifications. See docs/mempalace-schema.md
  // for how agents use these (idle-tick read, librarian digest input).
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS terminal_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_ms INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data TEXT DEFAULT '{}'
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_term_events_session_ts ON terminal_events(session_id, ts_ms)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_term_events_kind ON terminal_events(kind)`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS command_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    cwd TEXT,
    exit_code INTEGER,
    started_at TEXT,
    ended_at TEXT,
    duration_ms INTEGER,
    output_snippet TEXT,
    meta TEXT DEFAULT '{}'
  )`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_cmd_session ON command_events(session_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_cmd_started ON command_events(started_at)`);

  G[DB_KEY].exec(`CREATE VIRTUAL TABLE IF NOT EXISTS command_events_fts USING fts5(
    command, output_snippet, cwd, tokenize='trigram'
  )`);

  G[DB_KEY].exec(`CREATE TRIGGER IF NOT EXISTS cmd_ai AFTER INSERT ON command_events BEGIN
    INSERT INTO command_events_fts(rowid, command, output_snippet, cwd)
    VALUES (new.rowid, new.command, new.output_snippet, new.cwd);
  END`);

  // Migrations for sessions table — tmux + AON columns
  if (!cols.includes('tmux_id'))        G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN tmux_id TEXT`);
  if (!cols.includes('kill_timer'))     G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN kill_timer TEXT`);
  if (!cols.includes('is_aon'))         G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN is_aon INTEGER DEFAULT 0`);
  if (!cols.includes('linked_chat_id')) G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN linked_chat_id TEXT`);
  // If on, user-role messages posted to a chat are written to each linked
  // terminal's PTY as raw keystrokes (so you can answer (y)/n prompts from
  // the chat input). If off, they arrive as the existing notification block.
  // Default on. Flip off per-session for multi-agent broadcast rooms.
  if (!cols.includes('auto_forward_chat')) G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN auto_forward_chat INTEGER NOT NULL DEFAULT 1`);

  // Record startup
  G[DB_KEY].prepare(`INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)`).run('last_heartbeat', new Date().toISOString());
  G[DB_KEY].exec(`INSERT OR REPLACE INTO server_state(key, value) VALUES ('last_started', datetime('now'))`);

  console.log(`[db] Initialized ${isBun ? 'bun:sqlite' : 'better-sqlite3'} at ${DB_PATH}`);
  return _db;
}

// Lazy query helpers — prepared statements created on first use
const stmtCache = new Map<string, any>();

function prepare(sql: string): any {
  if (!stmtCache.has(sql)) {
    stmtCache.set(sql, getDb().prepare(sql));
  }
  return stmtCache.get(sql);
}

const TTL_MS: Record<string, number> = {
  '15m':    15 * 60 * 1000,
  '45m':    45 * 60 * 1000,
  '3h':   3 * 60 * 60 * 1000,
  'forever': Infinity,
};

export function ttlMs(ttl: string): number {
  return TTL_MS[ttl] ?? TTL_MS['15m'];
}

export const queries = {
  // Sessions — active (not soft-deleted, not archived)
  listSessions: () => prepare(`SELECT * FROM sessions WHERE archived = 0 AND deleted_at IS NULL ORDER BY updated_at DESC`).all(),
  // Soft-deleted sessions still within their TTL window (recoverable)
  listRecoverable: () => prepare(`SELECT * FROM sessions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`).all(),
  // All terminal sessions for rehydration on startup
  listTerminalSessions: () => prepare(`SELECT * FROM sessions WHERE type = 'terminal' AND archived = 0`).all(),
  getSession: (id: string) => prepare(`SELECT * FROM sessions WHERE id = ?`).get(id),
  createSession: (id: string, name: string, type: string, ttl: string, workspaceId: string | null, rootDir: string | null, meta: string) =>
    prepare(`INSERT INTO sessions (id, name, type, ttl, workspace_id, root_dir, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, name, type, ttl, workspaceId, rootDir, meta),
  updateSession: (name: string | null, status: string | null, archived: number | null, meta: string | null, id: string) =>
    prepare(`UPDATE sessions SET name = COALESCE(?, name), status = COALESCE(?, status), archived = COALESCE(?, archived), meta = COALESCE(?, meta), updated_at = datetime('now') WHERE id = ?`).run(name, status, archived, meta, id),
  updateTtl: (ttl: string, id: string) =>
    prepare(`UPDATE sessions SET ttl = ?, updated_at = datetime('now') WHERE id = ?`).run(ttl, id),
  touchActivity: (id: string) =>
    prepare(`UPDATE sessions SET last_activity = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id),
  softDeleteSession: (id: string) =>
    prepare(`UPDATE sessions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id),
  restoreSession: (id: string) =>
    prepare(`UPDATE sessions SET deleted_at = NULL, archived = 0, updated_at = datetime('now') WHERE id = ?`).run(id),
  hardDeleteSession: (id: string) => prepare(`DELETE FROM sessions WHERE id = ?`).run(id),
  archiveSession: (id: string) => prepare(`UPDATE sessions SET archived = 1, updated_at = datetime('now') WHERE id = ?`).run(id),

  // Sessions — linked chat
  setLinkedChat: (sessionId: string, chatId: string) =>
    prepare(`UPDATE sessions SET linked_chat_id = ?, updated_at = datetime('now') WHERE id = ?`).run(chatId, sessionId),

  // Sessions — handle/identity
  setHandle: (id: string, handle: string | null, displayName: string | null) =>
    prepare(`UPDATE sessions SET handle = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?`).run(handle, displayName, id),
  getSessionByHandle: (handle: string) => prepare(`SELECT * FROM sessions WHERE handle = ? AND archived = 0 AND deleted_at IS NULL`).get(handle),

  // CLI flag + alias
  setCliFlag: (id: string, cliFlag: string | null) =>
    prepare(`UPDATE sessions SET cli_flag = ?, updated_at = datetime('now') WHERE id = ?`).run(cliFlag, id),
  setAlias: (id: string, alias: string) =>
    prepare(`UPDATE sessions SET alias = ?, handle = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?`).run(alias, `@${alias}`, alias, id),

  // Chat room members
  addRoomMember: (roomId: string, sessionId: string, role: string, cliFlag: string | null, alias?: string | null) =>
    prepare(`INSERT OR IGNORE INTO chat_room_members (room_id, session_id, role, cli_flag, alias) VALUES (?, ?, ?, ?, ?)`).run(roomId, sessionId, role, cliFlag, alias ?? null),
  removeRoomMember: (roomId: string, sessionId: string) =>
    prepare(`DELETE FROM chat_room_members WHERE room_id = ? AND session_id = ?`).run(roomId, sessionId),
  updateMemberAlias: (roomId: string, sessionId: string, alias: string | null) =>
    prepare(`UPDATE chat_room_members SET alias = ? WHERE room_id = ? AND session_id = ?`).run(alias, roomId, sessionId),
  getMemberByAlias: (roomId: string, alias: string) =>
    prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id WHERE crm.room_id = ? AND crm.alias = ?`).get(roomId, alias),
  listRoomMembers: (roomId: string) =>
    prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type, s.status as session_status FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id WHERE crm.room_id = ?`).all(roomId),
  getRoutableMembers: (roomId: string) =>
    prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id WHERE crm.room_id = ? AND crm.role = 'participant'`).all(roomId),

  // Channel registry
  registerChannel: (handle: string, port: number, sessionId: string | null) =>
    prepare(`INSERT OR REPLACE INTO channel_registry (handle, port, session_id) VALUES (?, ?, ?)`).run(handle, port, sessionId),
  deregisterChannel: (handle: string) =>
    prepare(`DELETE FROM channel_registry WHERE handle = ?`).run(handle),
  getChannelPort: (handle: string) =>
    prepare(`SELECT port FROM channel_registry WHERE handle = ?`).get(handle) as { port: number } | undefined,
  listChannels: () =>
    prepare(`SELECT * FROM channel_registry`).all(),

  // Delivery log
  logDelivery: (messageId: string, sessionId: string, adapter: string, delivered: number, error: string | null) =>
    prepare(`INSERT INTO delivery_log (message_id, session_id, adapter, delivered, error) VALUES (?, ?, ?, ?, ?)`).run(messageId, sessionId, adapter, delivered, error),
  pruneDeliveryLog: (olderThanSecs: number) =>
    prepare(`DELETE FROM delivery_log WHERE created_at < (unixepoch() - ?)`).run(olderThanSecs),
  getTerminalsByLinkedChat: (chatId: string) =>
    prepare(`SELECT * FROM sessions WHERE linked_chat_id = ? AND type = 'terminal' AND archived = 0 AND deleted_at IS NULL`).all(chatId),
  // All live terminal sessions that have a linked chat — kept for reference.
  getLinkedTerminalSessions: () =>
    prepare(`SELECT id, linked_chat_id FROM sessions WHERE type = 'terminal' AND archived = 0 AND deleted_at IS NULL AND linked_chat_id IS NOT NULL`).all(),

  // All live terminal sessions WITHOUT a linked chat — used by the pane_title
  // polling loop. Sessions with a linked chat get terminal output via the
  // terminal_line path, so title polling is redundant noise for them.
  getUnlinkedTerminalSessions: () =>
    prepare(`SELECT id, linked_chat_id FROM sessions WHERE type = 'terminal' AND archived = 0 AND deleted_at IS NULL AND linked_chat_id IS NULL`).all(),

  // Most recent title/prompt message in a chat — used to seed the title poller
  // cooldown map on server restart so we don't spam duplicate titles.
  getMostRecentTitleMessage: (chatId: string) =>
    prepare(`SELECT created_at FROM messages WHERE session_id = ? AND msg_type IN ('title','prompt') ORDER BY created_at DESC LIMIT 1`).get(chatId),

  // Messages
  listMessages: (sessionId: string) => prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId),

  // Participants — unique senders in a session, enriched with session name/handle
  listParticipants: (sessionId: string) =>
    prepare(`
      SELECT DISTINCT
        m.sender_id as id,
        COALESCE(s.display_name, s.name, m.sender_id) as name,
        s.handle,
        s.type as session_type,
        MIN(m.created_at) as first_seen,
        MAX(m.created_at) as last_seen,
        COUNT(*) as message_count
      FROM messages m
      LEFT JOIN sessions s ON s.id = m.sender_id
      WHERE m.session_id = ? AND m.sender_id IS NOT NULL
      GROUP BY m.sender_id
      ORDER BY first_seen ASC
    `).all(sessionId),

  getMessagesSince: (sessionId: string, since: string, limit: number) =>
    prepare(`SELECT * FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?`).all(sessionId, since, limit),
  getMessagesBefore: (sessionId: string, before: string, limit: number) =>
    prepare(`SELECT * FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`).all(sessionId, before, limit),
  createMessage: (id: string, sessionId: string, role: string, content: string, format: string, status: string, senderId: string | null, target: string | null, msgType: string, meta: string) =>
    prepare(`INSERT INTO messages (id, session_id, role, content, format, status, sender_id, target, msg_type, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sessionId, role, content, format, status, senderId, target, msgType, meta),
  deleteMessage: (id: string) => prepare(`DELETE FROM messages WHERE id = ?`).run(id),
  updateMessageMeta: (id: string, meta: string) =>
    prepare(`UPDATE messages SET meta = ? WHERE id = ?`).run(meta, id),

  // Tasks
  listTasks: (sessionId: string) => prepare(`SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId),
  getTask: (id: string) => prepare(`SELECT * FROM tasks WHERE id = ?`).get(id),
  createTask: (id: string, sessionId: string, createdBy: string | null, title: string, description: string | null) =>
    prepare(`INSERT INTO tasks (id, session_id, created_by, title, description) VALUES (?, ?, ?, ?, ?)`).run(id, sessionId, createdBy, title, description),
  updateTask: (id: string, status: string | null, assignedTo: string | null, description: string | null, fileRefs: string | null) =>
    prepare(`UPDATE tasks SET status = COALESCE(?, status), assigned_to = COALESCE(?, assigned_to), description = COALESCE(?, description), file_refs = COALESCE(?, file_refs), updated_at = datetime('now') WHERE id = ?`).run(status, assignedTo, description, fileRefs, id),
  deleteTask: (id: string) => prepare(`UPDATE tasks SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`).run(id),

  // File refs
  listFileRefs: (sessionId: string) => prepare(`SELECT * FROM file_refs WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId),
  createFileRef: (id: string, sessionId: string, flaggedBy: string | null, filePath: string, note: string | null) =>
    prepare(`INSERT INTO file_refs (id, session_id, flagged_by, file_path, note) VALUES (?, ?, ?, ?, ?)`).run(id, sessionId, flaggedBy, filePath, note),
  deleteFileRef: (id: string) => prepare(`DELETE FROM file_refs WHERE id = ?`).run(id),

  // Search
  searchMessages: (query: string, limit: number) => prepare(`
    SELECT m.id, m.session_id, m.role, m.content, m.created_at,
           snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) as snippet
    FROM messages_fts
    JOIN messages m ON messages_fts.rowid = m.rowid
    WHERE messages_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit),
  searchSessionMessages: (sessionId: string, query: string, limit: number) => prepare(`
    SELECT m.id, m.session_id, m.role, m.content, m.created_at, m.sender_id, m.target, m.msg_type,
           snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) as snippet
    FROM messages_fts
    JOIN messages m ON messages_fts.rowid = m.rowid
    WHERE m.session_id = ? AND messages_fts MATCH ?
    ORDER BY rank, m.created_at DESC
    LIMIT ?
  `).all(sessionId, query, limit),

  // Terminal transcripts — legacy writer kept for callers that don't yet supply
  // stripped text or ts_ms. New code should use appendTranscriptWithText.
  appendTranscript: (sessionId: string, chunkIndex: number, rawData: string) =>
    prepare(`INSERT INTO terminal_transcripts (session_id, chunk_index, raw_data, ts_ms) VALUES (?, ?, ?, ?)`).run(sessionId, chunkIndex, rawData, Date.now()),
  listTranscriptChunks: (sessionId: string) =>
    prepare(`SELECT chunk_index, raw_data, timestamp, ts_ms, byte_offset FROM terminal_transcripts WHERE session_id = ? ORDER BY chunk_index ASC`).all(sessionId),
  getTranscripts: (sessionId: string) =>
    prepare(`SELECT * FROM terminal_transcripts WHERE session_id = ? ORDER BY chunk_index ASC`).all(sessionId),

  // Per-session stats used to seed the in-memory chunk/byte counters on first
  // flush after a server restart. Returns 0/0 for sessions with no rows yet.
  getTranscriptStats: (sessionId: string) => prepare(`
    SELECT
      COALESCE(MAX(chunk_index), 0) AS max_chunk,
      COALESCE(SUM(LENGTH(raw_data)), 0) AS total_bytes
    FROM terminal_transcripts
    WHERE session_id = ?
  `).get(sessionId) as { max_chunk: number; total_bytes: number } | undefined,

  // Append a transcript row and its ANSI-stripped mirror in one transaction.
  // rowid of terminal_text_fts is tied to terminal_transcripts.id so the history
  // route can JOIN on rowid when running FTS searches.
  appendTranscriptWithText: (
    sessionId: string, chunkIndex: number, rawData: string,
    textStripped: string, tsMs: number, byteOffset: number
  ) => {
    const db = getDb();
    const insertMain = prepare(`INSERT INTO terminal_transcripts
      (session_id, chunk_index, raw_data, ts_ms, byte_offset) VALUES (?, ?, ?, ?, ?)`);
    const insertFts = prepare(`INSERT INTO terminal_text_fts(rowid, text) VALUES (?, ?)`);
    const tx = db.transaction(() => {
      const result = insertMain.run(sessionId, chunkIndex, rawData, tsMs, byteOffset);
      insertFts.run(result.lastInsertRowid, textStripped);
    });
    tx();
  },

  // Time-window query for the history route and the command_events backfill.
  // Returns newest-first so the `limit` parameter bounds recent history cheaply.
  getTranscriptsSince: (sessionId: string, sinceMs: number, limit: number) => prepare(`
    SELECT id, chunk_index, ts_ms, byte_offset, LENGTH(raw_data) AS size, raw_data
    FROM terminal_transcripts
    WHERE session_id = ? AND ts_ms >= ?
    ORDER BY ts_ms DESC
    LIMIT ?
  `).all(sessionId, sinceMs, limit),

  // Non-FTS time-window query, used when we need stripped text for a command
  // output snippet but don't have a search term.
  getTranscriptRangeStripped: (sessionId: string, startMs: number, endMs: number) => prepare(`
    SELECT t.id, f.text
    FROM terminal_transcripts t
    JOIN terminal_text_fts f ON f.rowid = t.id
    WHERE t.session_id = ? AND t.ts_ms BETWEEN ? AND ?
    ORDER BY t.ts_ms ASC
  `).all(sessionId, startMs, endMs),

  // FTS search across transcripts for one session. Joins via rowid to recover
  // ordering metadata. Uses ranked results and returns an FTS snippet for
  // highlighting.
  searchTranscripts: (sessionId: string, query: string, limit: number) => prepare(`
    SELECT t.id, t.chunk_index, t.ts_ms, t.byte_offset, LENGTH(t.raw_data) AS size,
           snippet(terminal_text_fts, 0, '<mark>', '</mark>', '…', 32) AS snippet
    FROM terminal_text_fts
    JOIN terminal_transcripts t ON t.id = terminal_text_fts.rowid
    WHERE terminal_text_fts MATCH ? AND t.session_id = ?
    ORDER BY rank
    LIMIT ?
  `).all(query, sessionId, limit),

  // Backfill output snippets onto command_events rows whose time window has
  // fully closed (end time older than the transcript flush horizon). Runs
  // opportunistically from capture-ingest's poll loop — see capture-ingest.ts.
  listCommandsNeedingSnippet: (olderThanIso: string, limit: number) => prepare(`
    SELECT id, session_id, started_at, ended_at
    FROM command_events
    WHERE output_snippet IS NULL
      AND ended_at IS NOT NULL
      AND ended_at < ?
    ORDER BY ended_at ASC
    LIMIT ?
  `).all(olderThanIso, limit),

  setCommandSnippet: (id: number, snippet: string) =>
    prepare(`UPDATE command_events SET output_snippet = ? WHERE id = ?`).run(snippet, id),

  // Workspaces
  listWorkspaces: () => prepare(`SELECT * FROM workspaces ORDER BY name ASC`).all(),
  createWorkspace: (id: string, name: string, rootDir: string | null) =>
    prepare(`INSERT INTO workspaces (id, name, root_dir) VALUES (?, ?, ?)`).run(id, name, rootDir),

  // Server state
  getState: (key: string) => prepare(`SELECT value FROM server_state WHERE key = ?`).get(key),
  getServerState: (key: string) => (prepare(`SELECT value FROM server_state WHERE key = ?`).get(key) as any)?.value as string | undefined,
  setState: (key: string, value: string) =>
    prepare(`INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)`).run(key, value),

  // Memories
  listMemories: (limit: number) => prepare(`SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?`).all(limit),
  getMemory: (id: string) => prepare(`SELECT * FROM memories WHERE id = ?`).get(id),
  upsertMemory: (id: string, key: string, value: string, tags: string, sessionId: string | null, createdBy: string | null) =>
    prepare(`INSERT INTO memories (id, key, value, tags, session_id, created_by) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET key = excluded.key, value = excluded.value, tags = excluded.tags, updated_at = datetime('now')`).run(id, key, value, tags, sessionId, createdBy),

  // Key-addressed memory access — the mempalace schema relies on stable keys
  // so agents can read/write `tasks/t-42` deterministically. Identity is
  // derived from the key itself (`mem:${key}`) so two writes to the same key
  // upsert rather than duplicate.
  getMemoryByKey: (key: string) =>
    prepare(`SELECT * FROM memories WHERE key = ? ORDER BY updated_at DESC LIMIT 1`).get(key),

  upsertMemoryByKey: (key: string, value: string, tags: string, sessionId: string | null, createdBy: string | null) => {
    const id = 'mem:' + key;
    return prepare(`INSERT INTO memories (id, key, value, tags, session_id, created_by) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET key = excluded.key, value = excluded.value, tags = excluded.tags, session_id = excluded.session_id, created_by = excluded.created_by, updated_at = datetime('now')`).run(id, key, value, tags, sessionId, createdBy);
  },

  deleteMemoryByKey: (key: string) => prepare(`DELETE FROM memories WHERE key = ?`).run(key),

  // Prefix scan — used for `tasks/`, `agents/`, `goals/` listings. Sorted by
  // updated_at so the newest version of each key appears first.
  listMemoriesByPrefix: (prefix: string, limit: number) => prepare(`
    SELECT * FROM memories
    WHERE key LIKE ? ESCAPE '\\'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(prefix.replace(/[%_\\]/g, c => '\\' + c) + '%', limit),
  deleteMemory: (id: string) => prepare(`DELETE FROM memories WHERE id = ?`).run(id),
  searchMemories: (query: string, limit: number) => prepare(`
    SELECT m.id, m.key, m.value, m.tags, m.session_id, m.created_by, m.created_at,
           snippet(memories_fts, 1, '<mark>', '</mark>', '...', 24) as snippet
    FROM memories_fts
    JOIN memories m ON memories_fts.rowid = m.rowid
    WHERE memories_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit),

  // Terminal events (tmux control mode structured events)
  appendTerminalEvent: (sessionId: string, tsMs: number, kind: string, data: string) =>
    prepare(`INSERT INTO terminal_events (session_id, ts_ms, kind, data) VALUES (?, ?, ?, ?)`).run(sessionId, tsMs, kind, data),

  getTerminalEvents: (sessionId: string, sinceMs: number, kind: string | null, limit: number) => {
    if (kind) {
      return prepare(`
        SELECT id, ts_ms, kind, data FROM terminal_events
        WHERE session_id = ? AND ts_ms >= ? AND kind = ?
        ORDER BY ts_ms DESC LIMIT ?
      `).all(sessionId, sinceMs, kind, limit);
    }
    return prepare(`
      SELECT id, ts_ms, kind, data FROM terminal_events
      WHERE session_id = ? AND ts_ms >= ?
      ORDER BY ts_ms DESC LIMIT ?
    `).all(sessionId, sinceMs, limit);
  },

  // Command events
  getCommands: (sessionId: string, limit: number) =>
    prepare(`SELECT * FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT ?`).all(sessionId, limit),
  insertCommand: (sessionId: string, command: string, cwd: string | null, exitCode: number | null, startedAt: string | null, endedAt: string | null, durationMs: number | null, outputSnippet: string | null) =>
    prepare(`INSERT INTO command_events(session_id, command, cwd, exit_code, started_at, ended_at, duration_ms, output_snippet) VALUES (?,?,?,?,?,?,?,?)`).run(sessionId, command, cwd, exitCode, startedAt, endedAt, durationMs, outputSnippet),
};

export default getDb;
