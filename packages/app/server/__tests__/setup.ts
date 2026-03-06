import { vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

const testDb = new Database(":memory:");
testDb.pragma("journal_mode = WAL");
testDb.pragma("foreign_keys = ON");

testDb.exec(`
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`);

vi.mock("../db.js", () => ({
  default: testDb,
  DB_PATH: ":memory:",
}));

beforeEach(() => {
  testDb.exec("DELETE FROM messages");
  testDb.exec("DELETE FROM sessions");
});

export { testDb };
