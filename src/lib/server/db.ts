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
const OPERATIONAL_MEMORY_WHERE = `
    key NOT LIKE 'session:%'
    AND key NOT LIKE 'archive/%'
    AND COALESCE(tags, '') NOT LIKE '%"archive"%'
    AND COALESCE(tags, '') NOT LIKE '%archive-only%'
  `;
const RUN_EVENT_SOURCE_VALUES = "'acp','hook','json','rpc','terminal','status','tmux'";

// Detect runtime
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- globalThis.Bun is not in TS lib; runtime check only
const isBun = typeof (globalThis as any).Bun !== 'undefined';

// Use globalThis to ensure tsx (server.ts) and SvelteKit build share the SAME
// DB instance. Without this, each module context creates its own connection and
// the build's copy may not have run migrations.
const G = globalThis as any;
const DB_KEY = '__ant_db__';
let _db: any = G[DB_KEY] ?? null;

function runEventsTableSql(tableName = 'run_events', ifNotExists = true): string {
  return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${tableName} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    ts_ms INTEGER NOT NULL,
    source TEXT NOT NULL CHECK(source IN (${RUN_EVENT_SOURCE_VALUES})),
    trust TEXT NOT NULL CHECK(trust IN ('high','medium','raw')),
    kind TEXT NOT NULL,
    text TEXT DEFAULT '',
    payload TEXT DEFAULT '{}',
    raw_ref TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`;
}

function migrateRunEventsSourceCheck(db: any): void {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'run_events'
  `).get() as { sql?: string } | undefined;
  if (!row?.sql || row.sql.includes("'acp'")) return;

  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec(runEventsTableSql('run_events_source_migration', false));
    db.exec(`
      INSERT INTO run_events_source_migration
        (id, session_id, ts_ms, source, trust, kind, text, payload, raw_ref, created_at)
      SELECT id, session_id, ts_ms, source, trust, kind, text, payload, raw_ref, created_at
      FROM run_events
    `);
    db.exec('DROP TABLE run_events');
    db.exec('ALTER TABLE run_events_source_migration RENAME TO run_events');
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

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
    // Settings table for runtime configuration (TS-007)
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  )`);

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
    sort_index INTEGER,
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
  if (!cols.includes('sort_index'))    G[DB_KEY].exec(`ALTER TABLE sessions ADD COLUMN sort_index INTEGER`);

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
  if (!crmCols.includes('attention_state')) G[DB_KEY].exec(`ALTER TABLE chat_room_members ADD COLUMN attention_state TEXT DEFAULT 'available'`);
  if (!crmCols.includes('attention_reason')) G[DB_KEY].exec(`ALTER TABLE chat_room_members ADD COLUMN attention_reason TEXT`);
  if (!crmCols.includes('attention_set_by')) G[DB_KEY].exec(`ALTER TABLE chat_room_members ADD COLUMN attention_set_by TEXT`);
  if (!crmCols.includes('attention_expires_at')) G[DB_KEY].exec(`ALTER TABLE chat_room_members ADD COLUMN attention_expires_at INTEGER`);
  if (!crmCols.includes('attention_updated_at')) G[DB_KEY].exec(`ALTER TABLE chat_room_members ADD COLUMN attention_updated_at INTEGER`);

  // Room links — typed relationships between chat sessions (discussions, elevations, etc.)
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS room_links (
    id TEXT PRIMARY KEY,
    source_room_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    target_room_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    relationship TEXT NOT NULL,
    title TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_room_links_source ON room_links(source_room_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_room_links_target ON room_links(target_room_id)`);
  G[DB_KEY].exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_room_links_unique ON room_links(source_room_id, target_room_id, relationship)`);

  // Migration: add settings column to room_links for propagation/visibility config
  const rlCols = G[DB_KEY].prepare(`PRAGMA table_info(room_links)`).all().map((c: any) => c.name);
  if (!rlCols.includes('settings')) G[DB_KEY].exec(`ALTER TABLE room_links ADD COLUMN settings TEXT DEFAULT '{}'`);

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

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS chat_focus_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    sender_id TEXT,
    sender_name TEXT,
    target TEXT,
    content TEXT NOT NULL,
    kind TEXT DEFAULT 'message',
    created_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(room_id, session_id, message_id)
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_chat_focus_queue_member ON chat_focus_queue(room_id, session_id, created_at)`);

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    format TEXT DEFAULT 'text',
    status TEXT DEFAULT 'complete',
    sender_id TEXT,
    target TEXT,
    reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL,
    msg_type TEXT DEFAULT 'message',
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  // Migrations for messages table
  const msgCols = G[DB_KEY].prepare(`PRAGMA table_info(messages)`).all().map((c: any) => c.name);
  if (!msgCols.includes('sender_id')) G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN sender_id TEXT`);
  if (!msgCols.includes('target'))    G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN target TEXT`);
  if (!msgCols.includes('reply_to'))  G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN reply_to TEXT REFERENCES messages(id) ON DELETE SET NULL`);
  if (!msgCols.includes('msg_type'))  G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN msg_type TEXT DEFAULT 'message'`);
  if (!msgCols.includes('pinned'))    G[DB_KEY].exec(`ALTER TABLE messages ADD COLUMN pinned INTEGER DEFAULT 0`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_sessions_sort_index ON sessions(sort_index)`);

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

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    uploader_handle TEXT NOT NULL,
    original_name TEXT,
    mime_type TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    public_url TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);

  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_uploads_session ON uploads(session_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_uploads_handle_created ON uploads(uploader_handle, created_at)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_uploads_hash ON uploads(content_hash)`);

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

  // Unified append-only timeline for the ANT Terminal view. This is the
  // interpreted, trust-labelled stream that sits between linked chat and raw
  // terminal: hooks/JSON where available, parsed terminal diffs otherwise,
  // with optional pointers back to raw transcript chunks for audit.
  G[DB_KEY].exec(runEventsTableSql());
  migrateRunEventsSourceCheck(G[DB_KEY]);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_run_events_session_ts ON run_events(session_id, ts_ms)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_run_events_source ON run_events(source)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_run_events_kind ON run_events(kind)`);

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

  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS terminal_identity_roots (
    id TEXT PRIMARY KEY,
    root_pid INTEGER NOT NULL,
    pid_start TEXT,
    handle TEXT,
    session_id TEXT,
    source TEXT DEFAULT 'manual',
    registered_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER,
    meta TEXT DEFAULT '{}'
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_terminal_identity_root_pid ON terminal_identity_roots(root_pid, registered_at DESC)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_terminal_identity_expiry ON terminal_identity_roots(expires_at)`);

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

  // Read receipts — tracks who has seen each message
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS message_reads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    read_at TEXT DEFAULT (datetime('now')),
    UNIQUE(message_id, session_id)
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_message_reads_msg ON message_reads(message_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_message_reads_session ON message_reads(session_id)`);

  // Room invites — per-room shareable invitations gated by user-set password.
  // One invite can be used by multiple devices/transports (cli/mcp/web). Revoke
  // on the invite kills all derived tokens; revoke on a single token kicks one device.
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS room_invites (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    kinds TEXT NOT NULL DEFAULT 'cli,mcp,web',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    revoked_at TEXT
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites(room_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_room_invites_active ON room_invites(room_id, revoked_at)`);

  // Migration: failure tracking for auto-revoke after N bad passwords
  const inviteCols = G[DB_KEY].prepare(`PRAGMA table_info(room_invites)`).all().map((c: any) => c.name);
  if (!inviteCols.includes('failed_attempts')) G[DB_KEY].exec(`ALTER TABLE room_invites ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`);
  if (!inviteCols.includes('last_failed_at')) G[DB_KEY].exec(`ALTER TABLE room_invites ADD COLUMN last_failed_at TEXT`);

  // Room tokens — bearer tokens issued via password exchange. token_hash is
  // sha-256 of the plaintext bearer; the bearer itself is never stored.
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS room_tokens (
    id TEXT PRIMARY KEY,
    invite_id TEXT NOT NULL REFERENCES room_invites(id) ON DELETE CASCADE,
    room_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    handle TEXT,
    meta TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT,
    revoked_at TEXT
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_room_tokens_invite ON room_tokens(invite_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_room_tokens_room ON room_tokens(room_id)`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_room_tokens_active ON room_tokens(invite_id, revoked_at)`);

  // Open-Slide decks — local deck workspaces registered against one or more
  // ANT rooms. Room invite tokens gate read/write access in /api/decks/*.
  G[DB_KEY].exec(`CREATE TABLE IF NOT EXISTS decks (
    slug TEXT PRIMARY KEY,
    owner_session_id TEXT NOT NULL REFERENCES sessions(id),
    allowed_room_ids TEXT NOT NULL,
    deck_dir TEXT NOT NULL,
    dev_port INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  G[DB_KEY].exec(`CREATE INDEX IF NOT EXISTS idx_decks_owner ON decks(owner_session_id)`);

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
  getSetting: (key: string) => {
    const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? row.value : null;
  },

  setSetting: (key: string, value: string) => {
    return getDb().prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").run(key, value);
  },

  getAllSettings: () => {
    return getDb().prepare("SELECT * FROM settings").all();
  },
  // Sessions — active (not soft-deleted, not archived)
  listSessions: () => prepare(`
    WITH active_focus AS (
      SELECT
        crm.*,
        r.name AS focus_room_name,
        ROW_NUMBER() OVER (
          PARTITION BY crm.session_id
          ORDER BY COALESCE(crm.attention_expires_at, 2147483647) DESC, crm.attention_updated_at DESC
        ) AS rn
      FROM chat_room_members crm
      JOIN sessions r ON r.id = crm.room_id
      WHERE crm.role = 'participant'
        AND crm.attention_state = 'focus'
        AND (crm.attention_expires_at IS NULL OR crm.attention_expires_at > unixepoch())
    )
    SELECT
      s.*,
      af.attention_state AS attention_state,
      af.attention_reason AS attention_reason,
      af.attention_set_by AS attention_set_by,
      af.attention_expires_at AS attention_expires_at,
      af.room_id AS focus_room_id,
      af.focus_room_name AS focus_room_name,
      CASE
        WHEN af.session_id IS NULL THEN NULL
        ELSE (
          SELECT COUNT(*) FROM chat_focus_queue cfq
          WHERE cfq.room_id = af.room_id AND cfq.session_id = s.id
        )
      END AS focus_queue_count
    FROM sessions s
    LEFT JOIN active_focus af ON af.session_id = s.id AND af.rn = 1
    WHERE s.archived = 0 AND s.deleted_at IS NULL
    ORDER BY
      CASE WHEN s.sort_index IS NULL THEN 1 ELSE 0 END,
      s.sort_index ASC,
      s.updated_at DESC
  `).all(),
  // Sessions hidden from the main dashboard: archived-only rows and soft-deleted
  // rows that are still inside their restore window.
  listRecoverable: () => prepare(`
    SELECT * FROM sessions
    WHERE deleted_at IS NOT NULL OR archived = 1
    ORDER BY COALESCE(deleted_at, updated_at) DESC
  `).all(),
  // All terminal sessions for rehydration on startup
  listTerminalSessions: () => prepare(`SELECT * FROM sessions WHERE type = 'terminal' AND archived = 0`).all(),
  getSession: (id: string) => prepare(`SELECT * FROM sessions WHERE id = ?`).get(id),
  createSession: (id: string, name: string, type: string, ttl: string, workspaceId: string | null, rootDir: string | null, meta: string) =>
    prepare(`INSERT INTO sessions (id, name, type, ttl, workspace_id, root_dir, meta) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, name, type, ttl, workspaceId, rootDir, meta),
  updateSession: (name: string | null, status: string | null, archived: number | null, meta: string | null, id: string) =>
    prepare(`UPDATE sessions SET name = COALESCE(?, name), status = COALESCE(?, status), archived = COALESCE(?, archived), meta = COALESCE(?, meta), updated_at = datetime('now') WHERE id = ?`).run(name, status, archived, meta, id),
  updateTtl: (ttl: string, id: string) =>
    prepare(`UPDATE sessions SET ttl = ?, updated_at = datetime('now') WHERE id = ?`).run(ttl, id),
  updateRootDir: (rootDir: string | null, id: string) =>
    prepare(`UPDATE sessions SET root_dir = ?, updated_at = datetime('now') WHERE id = ?`).run(rootDir, id),
  touchActivity: (id: string) =>
    prepare(`UPDATE sessions SET last_activity = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id),
  softDeleteSession: (id: string) =>
    prepare(`UPDATE sessions SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id),
  restoreSession: (id: string) =>
    prepare(`UPDATE sessions SET deleted_at = NULL, archived = 0, updated_at = datetime('now') WHERE id = ?`).run(id),
  hardDeleteSession: (id: string) => prepare(`DELETE FROM sessions WHERE id = ?`).run(id),
  archiveSession: (id: string) => prepare(`UPDATE sessions SET archived = 1, updated_at = datetime('now') WHERE id = ?`).run(id),
  reorderSessions: (ids: string[]) => {
    const db = getDb();
    const tx = db.transaction((orderedIds: string[]) => {
      db.prepare(`UPDATE sessions SET sort_index = NULL WHERE archived = 0 AND deleted_at IS NULL`).run();
      const stmt = db.prepare(`UPDATE sessions SET sort_index = ? WHERE id = ? AND archived = 0 AND deleted_at IS NULL`);
      orderedIds.forEach((id, index) => stmt.run(index, id));
    });
    return tx(ids);
  },
  resetSessionOrder: () =>
    prepare(`UPDATE sessions SET sort_index = NULL WHERE archived = 0 AND deleted_at IS NULL`).run(),

  // Sessions — linked chat
  setLinkedChat: (sessionId: string, chatId: string) =>
    prepare(`UPDATE sessions SET linked_chat_id = ?, updated_at = datetime('now') WHERE id = ?`).run(chatId, sessionId),

  // Sessions — handle/identity
  setHandle: (id: string, handle: string | null, displayName: string | null) =>
    prepare(`UPDATE sessions SET handle = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?`).run(handle, displayName, id),
  getSessionByHandle: (handle: string) => prepare(`SELECT * FROM sessions WHERE handle = ? AND archived = 0 AND deleted_at IS NULL`).get(handle),

  // Terminal identity registry — maps a long-lived shell/process-tree root to
  // a handle/session without mutating shared CLI config.
  registerTerminalIdentity: (id: string, rootPid: number, pidStart: string | null, handle: string | null, sessionId: string | null, source: string, expiresAt: number | null, meta: string) =>
    prepare(`INSERT INTO terminal_identity_roots (id, root_pid, pid_start, handle, session_id, source, expires_at, meta)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, rootPid, pidStart, handle, sessionId, source, expiresAt, meta),
  resolveTerminalIdentity: (pids: { pid: number; pid_start?: string | null }[], now: number) => {
    const clean = pids
      .filter((entry) => Number.isInteger(entry.pid) && entry.pid > 1)
      .slice(0, 64);
    if (clean.length === 0) return null;
    const placeholders = clean.map(() => '?').join(',');
    const rows = prepare(`
      SELECT tir.*, s.handle AS session_handle, s.display_name, s.name, s.type
      FROM terminal_identity_roots tir
      LEFT JOIN sessions s ON s.id = tir.session_id
      WHERE tir.root_pid IN (${placeholders})
        AND (tir.expires_at IS NULL OR tir.expires_at > ?)
      ORDER BY tir.registered_at DESC, tir.rowid DESC
    `).all(...clean.map((entry) => entry.pid), now);
    const starts = new Map(clean.map((entry) => [entry.pid, entry.pid_start || null]));
    return rows.find((row: any) => {
      const currentStart = starts.get(row.root_pid) || null;
      return !row.pid_start || !currentStart || row.pid_start === currentStart;
    }) ?? null;
  },
  pruneTerminalIdentities: (now: number) =>
    prepare(`DELETE FROM terminal_identity_roots WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(now),

  // CLI flag + alias
  setCliFlag: (id: string, cliFlag: string | null) =>
    prepare(`UPDATE sessions SET cli_flag = ?, updated_at = datetime('now') WHERE id = ?`).run(cliFlag, id),
  setAlias: (id: string, alias: string) =>
    prepare(`UPDATE sessions SET alias = ?, handle = ?, display_name = ?, updated_at = datetime('now') WHERE id = ?`).run(alias, `@${alias}`, alias, id),

  // Chat room members
  addRoomMember: (roomId: string, sessionId: string, role: string, cliFlag: string | null, alias?: string | null) =>
    prepare(`INSERT INTO chat_room_members (room_id, session_id, role, cli_flag, alias, joined_at)
             VALUES (?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(room_id, session_id) DO UPDATE SET
               role = excluded.role,
               cli_flag = excluded.cli_flag,
               alias = excluded.alias,
               joined_at = datetime('now')`).run(roomId, sessionId, role, cliFlag, alias ?? null),
  removeRoomMember: (roomId: string, sessionId: string) =>
    prepare(`UPDATE chat_room_members SET role = 'left' WHERE room_id = ? AND session_id = ? AND role != 'left'`).run(roomId, sessionId),
  updateMemberAlias: (roomId: string, sessionId: string, alias: string | null) =>
    prepare(`UPDATE chat_room_members SET alias = ? WHERE room_id = ? AND session_id = ?`).run(alias, roomId, sessionId),
  getRoomMember: (roomId: string, sessionId: string) =>
    prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type, s.status as session_status
             FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id
             WHERE crm.room_id = ? AND crm.session_id = ?`).get(roomId, sessionId),
  getMemberByAlias: (roomId: string, alias: string) =>
    prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id WHERE crm.room_id = ? AND crm.alias = ?`).get(roomId, alias),
  listRoomMembers: (roomId: string) =>
    prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type, s.status as session_status FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id WHERE crm.room_id = ?`).all(roomId),
  getRoutableMembers: (roomId: string) =>
    prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id WHERE crm.room_id = ? AND crm.role = 'participant'`).all(roomId),
  getActiveFocusForSession: (sessionId: string) =>
    prepare(`SELECT
               crm.*,
               r.name AS room_name,
               (SELECT COUNT(*) FROM chat_focus_queue cfq WHERE cfq.room_id = crm.room_id AND cfq.session_id = crm.session_id) AS focus_queue_count
             FROM chat_room_members crm
             JOIN sessions r ON r.id = crm.room_id
             WHERE crm.session_id = ?
               AND crm.role = 'participant'
               AND crm.attention_state = 'focus'
               AND (crm.attention_expires_at IS NULL OR crm.attention_expires_at > unixepoch())
             ORDER BY COALESCE(crm.attention_expires_at, 2147483647) DESC, crm.attention_updated_at DESC
             LIMIT 1`).get(sessionId),
  setMemberAttention: (roomId: string, sessionId: string, state: string, reason: string | null, setBy: string | null, expiresAt: number | null) =>
    prepare(`UPDATE chat_room_members
             SET attention_state = ?, attention_reason = ?, attention_set_by = ?, attention_expires_at = ?, attention_updated_at = unixepoch()
             WHERE room_id = ? AND session_id = ?`).run(state, reason, setBy, expiresAt, roomId, sessionId),
  listExpiredFocusedMembers: (roomId: string | null, now: number) => {
    if (roomId) {
      return prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type
                      FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id
                      WHERE crm.room_id = ? AND crm.role = 'participant'
                        AND crm.attention_state = 'focus'
                        AND crm.attention_expires_at IS NOT NULL
                        AND crm.attention_expires_at <= ?`).all(roomId, now);
    }
    return prepare(`SELECT crm.*, s.name, s.handle, s.display_name, s.type
                    FROM chat_room_members crm LEFT JOIN sessions s ON s.id = crm.session_id
                    WHERE crm.role = 'participant'
                      AND crm.attention_state = 'focus'
                      AND crm.attention_expires_at IS NOT NULL
                      AND crm.attention_expires_at <= ?`).all(now);
  },

  // Channel registry
  registerChannel: (handle: string, port: number, sessionId: string | null) =>
    prepare(`INSERT OR REPLACE INTO channel_registry (handle, port, session_id) VALUES (?, ?, ?)`).run(handle, port, sessionId),
  deregisterChannel: (handle: string) =>
    prepare(`DELETE FROM channel_registry WHERE handle = ?`).run(handle),
  getChannelPort: (handle: string) =>
    prepare(`SELECT port FROM channel_registry WHERE handle = ?`).get(handle) as { port: number } | undefined,
  listChannels: () =>
    prepare(`SELECT * FROM channel_registry`).all(),

  // Room links
  createRoomLink: (id: string, sourceRoomId: string, targetRoomId: string, relationship: string, title: string | null, createdBy: string | null, settings: string = '{}') =>
    prepare(`INSERT INTO room_links (id, source_room_id, target_room_id, relationship, title, created_by, settings) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, sourceRoomId, targetRoomId, relationship, title, createdBy, settings),
  updateRoomLinkSettings: (id: string, settings: string) =>
    prepare(`UPDATE room_links SET settings = ? WHERE id = ?`).run(settings, id),
  getRoomLinks: (roomId: string) =>
    prepare(`SELECT rl.*, s.name as target_name, s.type as target_type FROM room_links rl JOIN sessions s ON s.id = rl.target_room_id WHERE rl.source_room_id = ? ORDER BY rl.created_at`).all(roomId),
  getRoomBacklinks: (roomId: string) =>
    prepare(`SELECT rl.*, s.name as source_name, s.type as source_type FROM room_links rl JOIN sessions s ON s.id = rl.source_room_id WHERE rl.target_room_id = ? ORDER BY rl.created_at`).all(roomId),
  deleteRoomLinkForRoom: (id: string, roomId: string) =>
    prepare(`DELETE FROM room_links WHERE id = ? AND source_room_id = ?`).run(id, roomId),
  deleteRoomLink: (id: string) =>
    prepare(`DELETE FROM room_links WHERE id = ?`).run(id),

  // Delivery log
  logDelivery: (messageId: string, sessionId: string, adapter: string, delivered: number, error: string | null) =>
    prepare(`INSERT INTO delivery_log (message_id, session_id, adapter, delivered, error) VALUES (?, ?, ?, ?, ?)`).run(messageId, sessionId, adapter, delivered, error),
  pruneDeliveryLog: (olderThanSecs: number) =>
    prepare(`DELETE FROM delivery_log WHERE created_at < (unixepoch() - ?)`).run(olderThanSecs),
  queueFocusMessage: (roomId: string, sessionId: string, messageId: string, senderId: string | null, senderName: string | null, target: string | null, content: string, kind: string) =>
    prepare(`INSERT OR IGNORE INTO chat_focus_queue (room_id, session_id, message_id, sender_id, sender_name, target, content, kind)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(roomId, sessionId, messageId, senderId, senderName, target, content, kind),
  listFocusQueue: (roomId: string, sessionId: string, limit: number) =>
    prepare(`SELECT * FROM chat_focus_queue WHERE room_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT ?`).all(roomId, sessionId, limit),
  countFocusQueue: (roomId: string, sessionId: string) =>
    (prepare(`SELECT COUNT(*) as count FROM chat_focus_queue WHERE room_id = ? AND session_id = ?`).get(roomId, sessionId) as any)?.count ?? 0,
  clearFocusQueue: (roomId: string, sessionId: string) =>
    prepare(`DELETE FROM chat_focus_queue WHERE room_id = ? AND session_id = ?`).run(roomId, sessionId),
  countRecentFocusBypasses: (roomId: string, senderId: string | null, sinceIso: string) => {
    if (senderId) {
      return (prepare(`SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND sender_id = ? AND msg_type = 'focus_bypass' AND created_at >= ?`).get(roomId, senderId, sinceIso) as any)?.count ?? 0;
    }
    return (prepare(`SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND sender_id IS NULL AND msg_type = 'focus_bypass' AND created_at >= ?`).get(roomId, sinceIso) as any)?.count ?? 0;
  },
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
  getMessage: (id: string) => prepare(`SELECT * FROM messages WHERE id = ?`).get(id),

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
  createMessage: (id: string, sessionId: string, role: string, content: string, format: string, status: string, senderId: string | null, target: string | null, replyTo: string | null, msgType: string, meta: string) =>
    prepare(`INSERT INTO messages (id, session_id, role, content, format, status, sender_id, target, reply_to, msg_type, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, sessionId, role, content, format, status, senderId, target, replyTo, msgType, meta),
  deleteMessage: (id: string) => prepare(`DELETE FROM messages WHERE id = ?`).run(id),
  updateMessageMeta: (id: string, meta: string) =>
    prepare(`UPDATE messages SET meta = ? WHERE id = ?`).run(meta, id),
  togglePinMessage: (id: string, pinned: boolean) =>
    prepare(`UPDATE messages SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, id),

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

  // Upload audit trail
  recordUpload: (
    id: string,
    sessionId: string,
    uploaderHandle: string,
    originalName: string | null,
    mimeType: string,
    contentHash: string,
    sizeBytes: number,
    storagePath: string,
    publicUrl: string,
  ) =>
    prepare(`INSERT INTO uploads
      (id, session_id, uploader_handle, original_name, mime_type, content_hash, size_bytes, storage_path, public_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, sessionId, uploaderHandle, originalName, mimeType, contentHash, sizeBytes, storagePath, publicUrl),
  countUploadsForHandleSince: (handle: string, windowSeconds: number) =>
    (prepare(`SELECT COUNT(*) as count FROM uploads
      WHERE uploader_handle = ? AND unixepoch(created_at) >= unixepoch('now') - ?`)
      .get(handle, windowSeconds) as any)?.count ?? 0,
  sumUploadBytesForHandleSince: (handle: string, windowSeconds: number) =>
    (prepare(`SELECT COALESCE(SUM(size_bytes), 0) as bytes FROM uploads
      WHERE uploader_handle = ? AND unixepoch(created_at) >= unixepoch('now') - ?`)
      .get(handle, windowSeconds) as any)?.bytes ?? 0,
  listUploadsForSession: (sessionId: string) =>
    prepare(`SELECT * FROM uploads WHERE session_id = ? ORDER BY created_at DESC`).all(sessionId),
  getUploadByHash: (contentHash: string) =>
    prepare(`SELECT * FROM uploads WHERE content_hash = ? ORDER BY created_at DESC LIMIT 1`).get(contentHash),

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
  listOperationalMemories: (limit: number) => prepare(`
    SELECT * FROM memories
    WHERE ${OPERATIONAL_MEMORY_WHERE}
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit),
  listArchiveMemories: (limit: number) => prepare(`
    SELECT * FROM memories
    WHERE key LIKE 'session:%'
       OR key LIKE 'archive/%'
       OR COALESCE(tags, '') LIKE '%"archive"%'
       OR COALESCE(tags, '') LIKE '%archive-only%'
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit),
  listMemoryAuditRows: () => prepare(`
    SELECT id, key, tags, session_id, created_by, created_at, updated_at,
           LENGTH(value) AS value_size,
           SUBSTR(value, 1, 5000) AS preview,
           CASE WHEN INSTR(value, '## Full transcript') > 0 THEN 1 ELSE 0 END AS has_full_transcript
    FROM memories
    ORDER BY updated_at DESC
  `).all(),
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
  searchOperationalMemories: (query: string, limit: number) => prepare(`
    SELECT m.id, m.key, m.value, m.tags, m.session_id, m.created_by, m.created_at,
           snippet(memories_fts, 1, '<mark>', '</mark>', '...', 24) as snippet
    FROM memories_fts
    JOIN memories m ON memories_fts.rowid = m.rowid
    WHERE memories_fts MATCH ?
      AND m.key NOT LIKE 'session:%'
      AND m.key NOT LIKE 'archive/%'
      AND COALESCE(m.tags, '') NOT LIKE '%"archive"%'
      AND COALESCE(m.tags, '') NOT LIKE '%archive-only%'
    ORDER BY rank
    LIMIT ?
  `).all(query, limit),
  searchArchiveMemories: (query: string, limit: number) => prepare(`
    SELECT m.id, m.key, m.value, m.tags, m.session_id, m.created_by, m.created_at,
           snippet(memories_fts, 1, '<mark>', '</mark>', '...', 24) as snippet
    FROM memories_fts
    JOIN memories m ON memories_fts.rowid = m.rowid
    WHERE memories_fts MATCH ?
      AND (
        m.key LIKE 'session:%'
        OR m.key LIKE 'archive/%'
        OR COALESCE(m.tags, '') LIKE '%"archive"%'
        OR COALESCE(m.tags, '') LIKE '%archive-only%'
      )
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

  appendRunEvent: (
    sessionId: string,
    tsMs: number,
    source: string,
    trust: string,
    kind: string,
    text: string,
    payload: string,
    rawRef: string | null = null,
  ) => {
    const result = prepare(`
      INSERT INTO run_events (session_id, ts_ms, source, trust, kind, text, payload, raw_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sessionId, tsMs, source, trust, kind, text, payload, rawRef);
    return prepare(`
      SELECT id, session_id, ts_ms, source, trust, kind, text, payload, raw_ref, created_at
      FROM run_events WHERE id = ?
    `).get(result.lastInsertRowid);
  },

  getRunEvents: (
    sessionId: string,
    sinceMs: number,
    source: string | null,
    kind: string | null,
    q: string | null,
    limit: number,
  ) => {
    const clauses = ['session_id = ?', 'ts_ms >= ?'];
    const args: unknown[] = [sessionId, sinceMs];
    if (source) {
      clauses.push('source = ?');
      args.push(source);
    }
    if (kind) {
      clauses.push('kind = ?');
      args.push(kind);
    }
    if (q) {
      clauses.push('text LIKE ?');
      args.push(`%${q}%`);
    }
    args.push(limit);
    return prepare(`
      SELECT id, session_id, ts_ms, source, trust, kind, text, payload, raw_ref, created_at
      FROM run_events
      WHERE ${clauses.join(' AND ')}
      ORDER BY ts_ms DESC, id DESC
      LIMIT ?
    `).all(...args);
  },



  // Plan events — M3.5 projector read helper (no schema change, JSON_EXTRACT on payload)
  getPlanEvents: (sessionId: string, planId: string, kinds: string[], limit: number = 1000) => {
    // Observation A: callers must pass PLAN_EVENT_KINDS or a trusted constant
    // subset. Values are parameterized, but this helper is not a general
    // user-supplied kind search surface.
    const placeholders = kinds.map(() => '?').join(',');
    const sql = [
      'SELECT id, session_id, ts_ms, source, trust, kind, text, payload, raw_ref, created_at',
      'FROM run_events',
      'WHERE session_id = ?',
      'AND kind IN (' + placeholders + ')',
      'AND JSON_VALID(payload)',
      "AND JSON_EXTRACT(payload, '$.plan_id') = ?",
      'ORDER BY ts_ms ASC, id ASC',
      'LIMIT ?',
    ].join(' ');
    return prepare(sql).all(sessionId, ...kinds, planId, limit);
  },

  listPlanRefs: (kinds: string[], limit: number = 50) => {
    // Trusted-kind helper for the Plan View source selector. Keeps discovery on
    // plan_* run_events only and ignores malformed JSON payloads.
    const placeholders = kinds.map(() => '?').join(',');
    const sql = [
      "SELECT session_id, JSON_EXTRACT(payload, '$.plan_id') AS plan_id,",
      'COUNT(*) AS event_count, MAX(ts_ms) AS updated_ts_ms',
      'FROM run_events',
      'WHERE kind IN (' + placeholders + ')',
      'AND JSON_VALID(payload)',
      "AND JSON_TYPE(payload, '$.plan_id') = 'text'",
      'GROUP BY session_id, plan_id',
      'ORDER BY updated_ts_ms DESC',
      'LIMIT ?',
    ].join(' ');
    return prepare(sql).all(...kinds, limit);
  },
  // Command events
  getCommands: (sessionId: string, limit: number) =>
    prepare(`SELECT * FROM command_events WHERE session_id = ? ORDER BY started_at DESC LIMIT ?`).all(sessionId, limit),
  insertCommand: (sessionId: string, command: string, cwd: string | null, exitCode: number | null, startedAt: string | null, endedAt: string | null, durationMs: number | null, outputSnippet: string | null) =>
    prepare(`INSERT INTO command_events(session_id, command, cwd, exit_code, started_at, ended_at, duration_ms, output_snippet) VALUES (?,?,?,?,?,?,?,?)`).run(sessionId, command, cwd, exitCode, startedAt, endedAt, durationMs, outputSnippet),

  // Read receipts
  markRead: (messageId: string, sessionId: string) =>
    prepare(`INSERT OR IGNORE INTO message_reads (message_id, session_id) VALUES (?, ?)`).run(messageId, sessionId),
  getReadsForMessage: (messageId: string) =>
    prepare(`SELECT mr.session_id, mr.read_at, COALESCE(s.display_name, s.name, mr.session_id) as reader_name, s.handle as reader_handle
             FROM message_reads mr LEFT JOIN sessions s ON s.id = mr.session_id
             WHERE mr.message_id = ? ORDER BY mr.read_at ASC`).all(messageId),
  getReadsForSession: (chatSessionId: string) =>
    prepare(`SELECT mr.message_id, mr.session_id, mr.read_at, COALESCE(s.display_name, s.name, mr.session_id) as reader_name, s.handle as reader_handle
             FROM message_reads mr
             LEFT JOIN sessions s ON s.id = mr.session_id
             JOIN messages m ON m.id = mr.message_id
             WHERE m.session_id = ?
             ORDER BY mr.read_at ASC`).all(chatSessionId),

  // Room invites
  createRoomInvite: (row: {
    id: string;
    room_id: string;
    label: string;
    password_hash: string;
    kinds: string;
    created_by: string | null;
  }) =>
    prepare(`INSERT INTO room_invites (id, room_id, label, password_hash, kinds, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`).run(
      row.id, row.room_id, row.label, row.password_hash, row.kinds, row.created_by,
    ),
  getRoomInvite: (id: string) =>
    prepare(`SELECT * FROM room_invites WHERE id = ?`).get(id),
  listRoomInvites: (roomId: string) =>
    prepare(`SELECT * FROM room_invites WHERE room_id = ? ORDER BY created_at DESC`).all(roomId),
  revokeRoomInvite: (id: string) =>
    prepare(`UPDATE room_invites SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(id),
  incrementInviteFailures: (id: string) =>
    prepare(`UPDATE room_invites SET failed_attempts = failed_attempts + 1, last_failed_at = datetime('now') WHERE id = ?`).run(id),
  resetInviteFailures: (id: string) =>
    prepare(`UPDATE room_invites SET failed_attempts = 0, last_failed_at = NULL WHERE id = ?`).run(id),

  // Room tokens
  createRoomToken: (row: {
    id: string;
    invite_id: string;
    room_id: string;
    token_hash: string;
    kind: string;
    handle: string | null;
    meta: string;
  }) =>
    prepare(`INSERT INTO room_tokens (id, invite_id, room_id, token_hash, kind, handle, meta)
             VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      row.id, row.invite_id, row.room_id, row.token_hash, row.kind, row.handle, row.meta,
    ),
  getRoomTokenByHash: (hash: string) =>
    prepare(`SELECT * FROM room_tokens WHERE token_hash = ?`).get(hash),
  getRoomToken: (id: string) =>
    prepare(`SELECT * FROM room_tokens WHERE id = ?`).get(id),
  touchRoomToken: (id: string) =>
    prepare(`UPDATE room_tokens SET last_seen_at = datetime('now') WHERE id = ?`).run(id),
  revokeRoomToken: (id: string) =>
    prepare(`UPDATE room_tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`).run(id),
  listRoomTokens: (inviteId: string) =>
    prepare(`SELECT * FROM room_tokens WHERE invite_id = ? ORDER BY created_at DESC`).all(inviteId),

  // Deck registry
  upsertDeck: (row: {
    slug: string;
    owner_session_id: string;
    allowed_room_ids: string;
    deck_dir: string;
    dev_port: number | null;
    now_ms?: number;
  }) =>
    prepare(`INSERT INTO decks (slug, owner_session_id, allowed_room_ids, deck_dir, dev_port, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(slug) DO UPDATE SET
               owner_session_id = excluded.owner_session_id,
               allowed_room_ids = excluded.allowed_room_ids,
               deck_dir = excluded.deck_dir,
               dev_port = excluded.dev_port,
               updated_at = excluded.updated_at`).run(
      row.slug,
      row.owner_session_id,
      row.allowed_room_ids,
      row.deck_dir,
      row.dev_port,
      row.now_ms ?? Date.now(),
      row.now_ms ?? Date.now(),
    ),
  getDeck: (slug: string) =>
    prepare(`SELECT * FROM decks WHERE slug = ?`).get(slug),
  listDecks: () =>
    prepare(`SELECT * FROM decks ORDER BY updated_at DESC`).all(),
  deleteDeck: (slug: string) =>
    prepare(`DELETE FROM decks WHERE slug = ?`).run(slug),
};

export default getDb;
