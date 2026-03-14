import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.VITEST ? ":memory:" : path.join(__dirname, "..", "ant.db");

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('terminal', 'conversation')),
    shell TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('human', 'agent', 'system')),
    content TEXT NOT NULL DEFAULT '',
    format TEXT NOT NULL DEFAULT 'markdown',
    status TEXT NOT NULL DEFAULT 'complete' CHECK(status IN ('pending', 'streaming', 'complete')),
    metadata TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS resume_commands (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    cli TEXT NOT NULL,
    command TEXT NOT NULL,
    description TEXT,
    root_path TEXT,
    captured_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_commands_session_command
    ON resume_commands (session_id, command);

  CREATE INDEX IF NOT EXISTS idx_resume_commands_session_id
    ON resume_commands (session_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS terminal_output_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_terminal_output_events_session_chunk
    ON terminal_output_events (session_id, chunk_index);

  CREATE INDEX IF NOT EXISTS idx_terminal_output_events_session_cursor
    ON terminal_output_events (session_id, chunk_index);

  CREATE INDEX IF NOT EXISTS idx_terminal_output_events_session_created_at
    ON terminal_output_events (session_id, created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS server_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migration: add cwd column to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN cwd TEXT DEFAULT NULL`);
} catch {
  // Column already exists — ignore
}

// Migration: add metadata column to messages
try {
  db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT DEFAULT NULL`);
} catch {
  // Column already exists — ignore
}

// Workspaces table
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migration: add workspace_id FK to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN workspace_id TEXT DEFAULT NULL REFERENCES workspaces(id) ON DELETE SET NULL`);
} catch {
  // Column already exists — ignore
}

// Migration: add archived column to sessions
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists — ignore
}

// Migration: add ttl_minutes column to sessions (NULL = global default, 0 = always on)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN ttl_minutes INTEGER DEFAULT NULL`);
} catch {
  // Column already exists — ignore
}

export default db;
export { DB_PATH };
