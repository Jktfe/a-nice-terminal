// ANT v3 — Database layer
// Uses bun:sqlite when running under Bun, better-sqlite3 under Node
// Lazy initialization: DB is created on first access, not at import time
// This prevents build-time errors (SvelteKit build runs under Node)

import { join } from 'path';
import { mkdirSync } from 'fs';

const DATA_DIR = process.env.ANT_DATA_DIR || join(process.env.HOME || '/tmp', '.ant-v3');
const DB_PATH = join(DATA_DIR, 'ant.db');

// Detect runtime
const isBun = typeof globalThis.Bun !== 'undefined';

let _db: any = null;

function getDb(): any {
  if (_db) return _db;

  mkdirSync(DATA_DIR, { recursive: true });

  if (isBun) {
    // bun:sqlite — fastest option, native to Bun
    const { Database } = require('bun:sqlite');
    _db = new Database(DB_PATH);
  } else {
    // better-sqlite3 — Node.js compatible
    const Database = require('better-sqlite3');
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
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

  _db.exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    format TEXT DEFAULT 'text',
    status TEXT DEFAULT 'complete',
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

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

  // Record startup
  _db.prepare(`INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)`).run('last_heartbeat', new Date().toISOString());

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

export const queries = {
  // Sessions
  listSessions: () => prepare(`SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC`).all(),
  getSession: (id: string) => prepare(`SELECT * FROM sessions WHERE id = ?`).get(id),
  createSession: (id: string, name: string, type: string, workspaceId: string | null, rootDir: string | null, meta: string) =>
    prepare(`INSERT INTO sessions (id, name, type, workspace_id, root_dir, meta) VALUES (?, ?, ?, ?, ?, ?)`).run(id, name, type, workspaceId, rootDir, meta),
  updateSession: (name: string | null, status: string | null, archived: number | null, meta: string | null, id: string) =>
    prepare(`UPDATE sessions SET name = COALESCE(?, name), status = COALESCE(?, status), archived = COALESCE(?, archived), meta = COALESCE(?, meta), updated_at = datetime('now') WHERE id = ?`).run(name, status, archived, meta, id),
  deleteSession: (id: string) => prepare(`DELETE FROM sessions WHERE id = ?`).run(id),
  archiveSession: (id: string) => prepare(`UPDATE sessions SET archived = 1, updated_at = datetime('now') WHERE id = ?`).run(id),

  // Messages
  listMessages: (sessionId: string) => prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`).all(sessionId),
  getMessagesSince: (sessionId: string, since: string, limit: number) =>
    prepare(`SELECT * FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?`).all(sessionId, since, limit),
  createMessage: (id: string, sessionId: string, role: string, content: string, format: string, status: string, meta: string) =>
    prepare(`INSERT INTO messages (id, session_id, role, content, format, status, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, sessionId, role, content, format, status, meta),
  deleteMessage: (id: string) => prepare(`DELETE FROM messages WHERE id = ?`).run(id),

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
  appendTranscript: (sessionId: string, chunkIndex: number, rawData: Buffer) =>
    prepare(`INSERT INTO terminal_transcripts (session_id, chunk_index, raw_data) VALUES (?, ?, ?)`).run(sessionId, chunkIndex, rawData),
  getTranscripts: (sessionId: string) =>
    prepare(`SELECT * FROM terminal_transcripts WHERE session_id = ? ORDER BY chunk_index ASC`).all(sessionId),

  // Workspaces
  listWorkspaces: () => prepare(`SELECT * FROM workspaces ORDER BY name ASC`).all(),
  createWorkspace: (id: string, name: string, rootDir: string | null) =>
    prepare(`INSERT INTO workspaces (id, name, root_dir) VALUES (?, ?, ?)`).run(id, name, rootDir),

  // Server state
  getState: (key: string) => prepare(`SELECT value FROM server_state WHERE key = ?`).get(key),
  setState: (key: string, value: string) =>
    prepare(`INSERT OR REPLACE INTO server_state (key, value) VALUES (?, ?)`).run(key, value),
};

export default getDb;
