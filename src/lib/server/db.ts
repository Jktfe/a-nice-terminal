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

let _db: any = null;

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

  // Performance PRAGMAs for M4 Pro with 64GB RAM
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA synchronous = NORMAL");
  _db.exec("PRAGMA busy_timeout = 5000");
  _db.exec("PRAGMA foreign_keys = ON");
  _db.exec("PRAGMA cache_size = -64000");
  _db.exec("PRAGMA mmap_size = 268435456");
  _db.exec("PRAGMA temp_store = MEMORY");

  // Schema
  _db.exec(`CREATE TABLE IF NOT EXISTS sessions (
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
  const cols = _db.prepare(`PRAGMA table_info(sessions)`).all().map((c: any) => c.name);
  if (!cols.includes('ttl'))           _db.exec(`ALTER TABLE sessions ADD COLUMN ttl TEXT DEFAULT '15m'`);
  if (!cols.includes('deleted_at'))    _db.exec(`ALTER TABLE sessions ADD COLUMN deleted_at TEXT`);
  if (!cols.includes('last_activity')) _db.exec(`ALTER TABLE sessions ADD COLUMN last_activity TEXT`);
  if (!cols.includes('handle'))        _db.exec(`ALTER TABLE sessions ADD COLUMN handle TEXT`);
  if (!cols.includes('display_name'))  _db.exec(`ALTER TABLE sessions ADD COLUMN display_name TEXT`);

  _db.exec(`CREATE TABLE IF NOT EXISTS messages (
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
  const msgCols = _db.prepare(`PRAGMA table_info(messages)`).all().map((c: any) => c.name);
  if (!msgCols.includes('sender_id')) _db.exec(`ALTER TABLE messages ADD COLUMN sender_id TEXT`);
  if (!msgCols.includes('target'))    _db.exec(`ALTER TABLE messages ADD COLUMN target TEXT`);
  if (!msgCols.includes('msg_type'))  _db.exec(`ALTER TABLE messages ADD COLUMN msg_type TEXT DEFAULT 'message'`);

  _db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id)`);
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);

  _db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content, tokenize='trigram'
  )`);

  _db.exec(`CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
  END`);

  _db.exec(`CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
    UPDATE messages_fts SET content = new.content WHERE rowid = new.rowid;
  END`);

  _db.exec(`CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    DELETE FROM messages_fts WHERE rowid = old.rowid;
  END`);

  _db.exec(`CREATE TABLE IF NOT EXISTS terminal_transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    raw_data BLOB NOT NULL,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);

  _db.exec(`CREATE INDEX IF NOT EXISTS idx_transcripts_session ON terminal_transcripts(session_id)`);

  _db.exec(`CREATE TABLE IF NOT EXISTS tasks (
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

  _db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`);

  _db.exec(`CREATE TABLE IF NOT EXISTS file_refs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    flagged_by TEXT,
    file_path TEXT NOT NULL,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.exec(`CREATE INDEX IF NOT EXISTS idx_file_refs_session ON file_refs(session_id)`);

  _db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root_dir TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.exec(`CREATE TABLE IF NOT EXISTS server_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  _db.exec(`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    session_id TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_key ON memories(key)`);
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`);

  _db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    key, value, tokenize='trigram'
  )`);

  _db.exec(`CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
    INSERT INTO memories_fts(rowid, key, value) VALUES (new.rowid, new.key, new.value);
  END`);

  _db.exec(`CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE OF key, value ON memories BEGIN
    UPDATE memories_fts SET key = new.key, value = new.value WHERE rowid = new.rowid;
  END`);

  _db.exec(`CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
    DELETE FROM memories_fts WHERE rowid = old.rowid;
  END`);

  _db.exec(`CREATE TABLE IF NOT EXISTS command_events (
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

  _db.exec(`CREATE INDEX IF NOT EXISTS idx_cmd_session ON command_events(session_id)`);
  _db.exec(`CREATE INDEX IF NOT EXISTS idx_cmd_started ON command_events(started_at)`);

  _db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS command_events_fts USING fts5(
    command, output_snippet, cwd, tokenize='trigram'
  )`);

  _db.exec(`CREATE TRIGGER IF NOT EXISTS cmd_ai AFTER INSERT ON command_events BEGIN
    INSERT INTO command_events_fts(rowid, command, output_snippet, cwd)
    VALUES (new.rowid, new.command, new.output_snippet, new.cwd);
  END`);

  // Migrations for sessions table — tmux + AON columns
  if (!cols.includes('tmux_id'))        _db.exec(`ALTER TABLE sessions ADD COLUMN tmux_id TEXT`);
  if (!cols.includes('kill_timer'))     _db.exec(`ALTER TABLE sessions ADD COLUMN kill_timer TEXT`);
  if (!cols.includes('is_aon'))         _db.exec(`ALTER TABLE sessions ADD COLUMN is_aon INTEGER DEFAULT 0`);
  if (!cols.includes('linked_chat_id')) _db.exec(`ALTER TABLE sessions ADD COLUMN linked_chat_id TEXT`);

  // Record startup
  _db.prepare(`INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)`).run('last_heartbeat', new Date().toISOString());
  _db.exec(`INSERT OR REPLACE INTO server_state(key, value) VALUES ('last_started', datetime('now'))`);

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
  getTerminalsByLinkedChat: (chatId: string) =>
    prepare(`SELECT * FROM sessions WHERE linked_chat_id = ? AND type = 'terminal' AND archived = 0 AND deleted_at IS NULL`).all(chatId),

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

  // Terminal transcripts
  appendTranscript: (sessionId: string, chunkIndex: number, rawData: string) =>
    prepare(`INSERT INTO terminal_transcripts (session_id, chunk_index, raw_data) VALUES (?, ?, ?)`).run(sessionId, chunkIndex, rawData),
  listTranscriptChunks: (sessionId: string) =>
    prepare(`SELECT chunk_index, raw_data, timestamp FROM terminal_transcripts WHERE session_id = ? ORDER BY chunk_index ASC`).all(sessionId),
  getTranscripts: (sessionId: string) =>
    prepare(`SELECT * FROM terminal_transcripts WHERE session_id = ? ORDER BY chunk_index ASC`).all(sessionId),

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

  // Command events
  getCommands: (sessionId: string, limit: number) =>
    prepare(`SELECT * FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT ?`).all(sessionId, limit),
  insertCommand: (sessionId: string, command: string, cwd: string | null, exitCode: number | null, startedAt: string | null, endedAt: string | null, durationMs: number | null, outputSnippet: string | null) =>
    prepare(`INSERT INTO command_events(session_id, command, cwd, exit_code, started_at, ended_at, duration_ms, output_snippet) VALUES (?,?,?,?,?,?,?,?)`).run(sessionId, command, cwd, exitCode, startedAt, endedAt, durationMs, outputSnippet),
};

export default getDb;
