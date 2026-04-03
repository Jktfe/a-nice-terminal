import Database from "better-sqlite3";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.VITEST ? ":memory:" : (process.env.ANT_DB_PATH ?? path.join(os.homedir(), ".ant", "ant.db"));

if (DB_PATH !== ":memory:") {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('terminal', 'conversation', 'unified')),
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

// Migration: expand sessions.type CHECK to include 'unified'
// SQLite doesn't support ALTER CHECK, so we recreate the table if needed.
{
  try {
    // Test if 'unified' is allowed by attempting a temp insert
    db.exec(`INSERT INTO sessions (id, name, type) VALUES ('__type_check__', '__test__', 'unified')`);
    db.exec(`DELETE FROM sessions WHERE id = '__type_check__'`);
  } catch {
    // 'unified' not allowed — recreate table with expanded CHECK
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('terminal', 'conversation', 'unified')),
        shell TEXT DEFAULT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO sessions_new SELECT id, name, type, shell, created_at, updated_at FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
    `);
  }
}

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

// Migration: add sender identity columns to messages
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_type TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_name TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_cwd TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_persona TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN thread_id TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN annotations TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE messages ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`); } catch {}

// Migration: add sender_terminal_id for identity binding + spoofing prevention
try { db.exec(`ALTER TABLE messages ADD COLUMN sender_terminal_id TEXT DEFAULT NULL`); } catch {}

// Terminal display names table — allows users to set custom names for their terminals
db.exec(`
  CREATE TABLE IF NOT EXISTS terminal_display_names (
    terminal_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Backfill sender_type from role for existing messages
db.exec(`UPDATE messages SET sender_type = 'human' WHERE sender_type IS NULL AND role = 'human'`);
db.exec(`UPDATE messages SET sender_type = 'unknown' WHERE sender_type IS NULL AND role = 'agent'`);
db.exec(`UPDATE messages SET sender_type = 'system' WHERE sender_type IS NULL AND role = 'system'`);

// Indices for thread and starred queries
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_starred ON messages(starred) WHERE starred = 1`);

// FTS5 for full-text search over messages (used for @mention lookups and global search)
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, sender_name,
      content=messages, content_rowid=rowid
    );
  `);
} catch {
  // FTS5 table may already exist
}

// Command events table — tracks command lifecycle for agent API
db.exec(`
  CREATE TABLE IF NOT EXISTS command_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    command TEXT NOT NULL,
    exit_code INTEGER,
    output TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    duration_ms INTEGER,
    cwd TEXT,
    detection_method TEXT NOT NULL DEFAULT 'quiet',
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_command_events_session
    ON command_events (session_id, started_at);
`);

// Bridge mappings — links external platform channels (Telegram, etc.) to ANT sessions
db.exec(`
  CREATE TABLE IF NOT EXISTS bridge_mappings (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    external_channel_id TEXT NOT NULL,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    external_channel_name TEXT,
    direction TEXT NOT NULL DEFAULT 'bidirectional',
    config TEXT,
    bot_type TEXT NOT NULL DEFAULT 'relay',
    agent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, external_channel_id)
  );
`);

// Migration: add bot_type and agent_id columns if missing (safe for existing DBs)
{
  const cols = db.pragma("table_info(bridge_mappings)") as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has("bot_type")) {
    db.prepare("ALTER TABLE bridge_mappings ADD COLUMN bot_type TEXT NOT NULL DEFAULT 'relay'").run();
  }
  if (!colNames.has("agent_id")) {
    db.prepare("ALTER TABLE bridge_mappings ADD COLUMN agent_id TEXT").run();
  }
}

// Migration: add message_type column to messages
try {
  db.exec(`ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'`);
} catch {
  // Column already exists
}

// V2: Session-terminal links — a unified session can have multiple terminal PTYs
db.exec(`
  CREATE TABLE IF NOT EXISTS session_terminals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    terminal_session_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'detached', 'dead')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (terminal_session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_session_terminals_session
    ON session_terminals (session_id);
  CREATE INDEX IF NOT EXISTS idx_session_terminals_terminal
    ON session_terminals (terminal_session_id);
`);

// Migration: add tier column to sessions (sprint/session/persistent)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN tier TEXT NOT NULL DEFAULT 'session' CHECK(tier IN ('sprint', 'session', 'persistent'))`);
} catch {
  // Column already exists
}

// Migration: add retain_history column to sessions (opt-in full scrollback replay)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN retain_history INTEGER NOT NULL DEFAULT 0`);
} catch {
  // Column already exists
}

// ---------------------------------------------------------------------------
// V2: Dangerous Commands — patterns that trigger warnings before execution
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS dangerous_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning' CHECK(severity IN ('warning', 'critical')),
    message TEXT NOT NULL
  );
`);

// Seed dangerous commands if table is empty
{
  const count = db.prepare("SELECT COUNT(*) as c FROM dangerous_commands").get() as { c: number };
  if (count.c === 0) {
    const seed = db.prepare("INSERT INTO dangerous_commands (pattern, severity, message) VALUES (?, ?, ?)");
    const patterns: [string, string, string][] = [
      ["rm -rf /", "critical", "This will recursively delete everything from root"],
      ["rm -rf ~", "critical", "This will recursively delete your entire home directory"],
      ["rm -rf .", "warning", "This will recursively delete the current directory"],
      ["rm -rf *", "warning", "This will recursively delete all files in the current directory"],
      ["DROP TABLE", "critical", "This will permanently delete a database table"],
      ["DROP DATABASE", "critical", "This will permanently delete an entire database"],
      ["TRUNCATE TABLE", "warning", "This will delete all rows from a database table"],
      ["chmod 777", "warning", "This sets world-readable/writable/executable permissions — security risk"],
      ["chmod -R 777", "critical", "This recursively sets dangerous permissions on all files"],
      ["kill -9", "warning", "Force-kills a process without graceful shutdown"],
      ["killall", "warning", "Kills all processes matching the name"],
      ["mkfs", "critical", "This will format a filesystem — all data will be lost"],
      ["dd if=", "critical", "Raw disk write — can overwrite partitions and destroy data"],
      ["> /dev/sda", "critical", "Direct write to disk device — will destroy the filesystem"],
      ["git push --force", "warning", "Force-push will overwrite remote history — others may lose work"],
      ["git reset --hard", "warning", "This discards all uncommitted changes permanently"],
      ["git clean -fd", "warning", "This deletes all untracked files and directories"],
      ["npm publish", "warning", "This publishes a package to the public npm registry"],
      ["sudo rm", "critical", "Elevated-privilege deletion — extra caution required"],
      [":(){ :|:& };:", "critical", "Fork bomb — will crash the system"],
    ];
    for (const [pattern, severity, message] of patterns) {
      seed.run(pattern, severity, message);
    }
  }
}

// ---------------------------------------------------------------------------
// V2: Agent Registry — tracks registered AI models and their capabilities
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_registry (
    id TEXT PRIMARY KEY,
    handle TEXT UNIQUE,
    model_family TEXT NOT NULL,
    display_name TEXT NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '[]',
    preferred_formats TEXT NOT NULL DEFAULT '["raw"]',
    context_window INTEGER,
    transport TEXT NOT NULL DEFAULT 'rest',
    status TEXT NOT NULL DEFAULT 'offline',
    last_seen TEXT,
    config TEXT,
    gateway TEXT,
    underlying_model TEXT,
    api_base TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

`);

// Migration: add handle column to agent_registry (must run before index creation)
// Note: SQLite does not support UNIQUE constraint in ALTER TABLE ADD COLUMN — the unique
// index is created separately below.
try { db.exec(`ALTER TABLE agent_registry ADD COLUMN handle TEXT`); } catch {}

// Indexes for agent handle/display_name lookups (after migration ensures column exists)
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_handle ON agent_registry(handle);
  CREATE INDEX IF NOT EXISTS idx_agent_handle_nocase ON agent_registry(handle COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_agent_display_name_nocase ON agent_registry(display_name COLLATE NOCASE);
`);

// ---------------------------------------------------------------------------
// V2: Conversation Members — tracks which agents have joined which chats
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS conversation_members (
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    handle TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'participant',
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (session_id, agent_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agent_registry(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conv_members_agent ON conversation_members(agent_id);
  CREATE INDEX IF NOT EXISTS idx_conv_members_session_handle ON conversation_members(session_id, handle COLLATE NOCASE);
`);

// ---------------------------------------------------------------------------
// V2: Terminal Locks — mutex for exclusive terminal access per agent
// ---------------------------------------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS terminal_locks (
    session_id TEXT PRIMARY KEY,
    holder_agent TEXT NOT NULL,
    acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

// ---------------------------------------------------------------------------
// V2: Knowledge System — facts, error patterns, and cross-references
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_facts (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.5,
    source_session_id TEXT,
    source_agent TEXT,
    evidence TEXT DEFAULT '[]',
    supersedes TEXT,
    confirmed_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_facts_scope ON knowledge_facts(scope);
  CREATE INDEX IF NOT EXISTS idx_facts_category ON knowledge_facts(category);
  CREATE INDEX IF NOT EXISTS idx_facts_key ON knowledge_facts(key);
`);

// FTS5 for full-text search over knowledge facts
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_facts_fts USING fts5(
      key, value, category, content=knowledge_facts, content_rowid=rowid
    );
  `);
} catch {
  // FTS5 table may already exist
}

db.exec(`
  CREATE TABLE IF NOT EXISTS error_patterns (
    id TEXT PRIMARY KEY,
    error_signature TEXT NOT NULL,
    error_regex TEXT,
    context_scope TEXT DEFAULT 'global',
    fix_command TEXT,
    fix_description TEXT,
    fix_session_id TEXT,
    fix_agent TEXT,
    success_count INTEGER NOT NULL DEFAULT 1,
    failure_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (fix_session_id) REFERENCES sessions(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_error_patterns_sig ON error_patterns(error_signature);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_links (
    id TEXT PRIMARY KEY,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_links_from ON knowledge_links(from_type, from_id);
  CREATE INDEX IF NOT EXISTS idx_links_to ON knowledge_links(to_type, to_id);
`);

// ---------------------------------------------------------------------------
// Session Digests — LLM-extracted summaries of archived sessions before deletion
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS session_digests (
    id TEXT PRIMARY KEY,
    session_name TEXT NOT NULL,
    session_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    key_learnings TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    session_created_at TEXT NOT NULL,
    session_archived_at TEXT,
    parsed_at TEXT NOT NULL DEFAULT (datetime('now')),
    parsed_by TEXT,
    source_message_count INTEGER DEFAULT 0,
    source_output_chunks INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_session_digests_parsed_at
    ON session_digests(parsed_at);
`);

// FTS5 for full-text search over session digests
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_digests_fts USING fts5(
      session_name, summary, key_learnings, tags,
      content=session_digests, content_rowid=rowid
    );
  `);
} catch {
  // FTS5 table may already exist
}

// Migration: add intent column to command_events
try { db.exec(`ALTER TABLE command_events ADD COLUMN intent TEXT DEFAULT NULL`); } catch {}

// V2: Session Permissions — per-agent access control
db.exec(`
  CREATE TABLE IF NOT EXISTS session_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    can_read INTEGER NOT NULL DEFAULT 1,
    can_write INTEGER NOT NULL DEFAULT 1,
    can_exec INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, agent_id)
  );
`);

// ---------------------------------------------------------------------------
// V2: Recipes — reusable multi-step workflows
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS recipes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT NOT NULL DEFAULT 'global',
    category TEXT,
    steps TEXT NOT NULL DEFAULT '[]',
    source_session_id TEXT,
    source_agent TEXT,
    approved_by TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    success_rate REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (source_session_id) REFERENCES sessions(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_recipes_scope ON recipes(scope);
  CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS recipe_params (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    default_value TEXT,
    required INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_recipe_params_recipe ON recipe_params(recipe_id);
`);

// Seed recipes from seed-recipes.json if table is empty and file exists
// Copy seed-recipes.example.json to seed-recipes.json and customise for your setup
{
  const count = db.prepare("SELECT COUNT(*) as c FROM recipes").get() as { c: number };
  if (count.c === 0) {
    try {
      const seedPath = path.join(__dirname, "..", "seed-recipes.json");
      if (existsSync(seedPath)) {
        const seedData = JSON.parse(readFileSync(seedPath, "utf-8")) as {
          recipes: Array<{
            id: string; name: string; description?: string; category?: string;
            steps: Array<{ command: string; description: string; interactive?: boolean }>;
            params?: Array<{ name: string; description?: string; default_value?: string; required?: boolean }>;
          }>;
        };

        const insertRecipe = db.prepare("INSERT INTO recipes (id, name, description, scope, category, steps, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const insertParam = db.prepare("INSERT INTO recipe_params (id, recipe_id, name, description, default_value, required) VALUES (?, ?, ?, ?, ?, ?)");

        for (const recipe of seedData.recipes) {
          insertRecipe.run(recipe.id, recipe.name, recipe.description || null, "global", recipe.category || null, JSON.stringify(recipe.steps), "system");
          if (recipe.params) {
            for (const p of recipe.params) {
              insertParam.run(`${recipe.id}-${p.name}`, recipe.id, p.name, p.description || null, p.default_value || null, p.required ? 1 : 0);
            }
          }
        }
        console.log(`[db] Seeded ${seedData.recipes.length} recipe(s) from seed-recipes.json`);
      }
    } catch (err) {
      console.warn("[db] Failed to load seed recipes:", err instanceof Error ? err.message : err);
    }
  }
}

// ---------------------------------------------------------------------------
// V2: Coordination Events — cross-agent task delegation
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS coordination_events (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    event_type TEXT NOT NULL,
    agent_id TEXT,
    target_agent_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'claimed', 'completed', 'expired')),
    required_capabilities TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coord_events_status ON coordination_events(status);
  CREATE INDEX IF NOT EXISTS idx_coord_events_target ON coordination_events(target_agent_id);
  CREATE INDEX IF NOT EXISTS idx_coord_events_session ON coordination_events(session_id);
`);

// Migration: add source tracking to coordination_events for mention-based tasks
try { db.exec(`ALTER TABLE coordination_events ADD COLUMN source TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE coordination_events ADD COLUMN source_message_id TEXT DEFAULT NULL`); } catch {}
try { db.exec(`ALTER TABLE coordination_events ADD COLUMN source_session_id TEXT DEFAULT NULL`); } catch {}

// V2: Device tracking for multi-device awareness
db.exec(`
  CREATE TABLE IF NOT EXISTS connected_devices (
    device_id TEXT PRIMARY KEY,
    device_type TEXT NOT NULL DEFAULT 'desktop',
    device_name TEXT,
    socket_id TEXT,
    connected_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// V2: User Preferences — learned from behaviour + explicit statements
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS user_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT 'default',
    domain TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    strength REAL NOT NULL DEFAULT 0.5,
    source TEXT NOT NULL DEFAULT 'observed',
    evidence_count INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, domain, key)
  );
`);

// Migration: add git_commit_hash column to command_events
try { db.exec(`ALTER TABLE command_events ADD COLUMN git_commit_hash TEXT DEFAULT NULL`); } catch {}

// ---------------------------------------------------------------------------
// Common Calls — quick-copy command snippets
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS common_calls (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Tasks — shared task board visible in the right-hand panel
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done', 'blocked')),
    assigned_to TEXT DEFAULT NULL,
    assigned_name TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);
`);

// ---------------------------------------------------------------------------
// ANTchat: Persisted chat rooms (replaces in-memory ChatRoomRegistry)
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS antchat_rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    conversation_session_id TEXT NOT NULL,
    purpose TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    archived_at TEXT DEFAULT NULL,
    FOREIGN KEY (conversation_session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_antchat_rooms_name_active
    ON antchat_rooms(name) WHERE status = 'active';
  CREATE INDEX IF NOT EXISTS idx_antchat_rooms_session
    ON antchat_rooms(conversation_session_id);
  CREATE INDEX IF NOT EXISTS idx_antchat_rooms_status
    ON antchat_rooms(status);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS antchat_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    terminal_session_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    model TEXT DEFAULT NULL,
    terminal_name TEXT DEFAULT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES antchat_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (terminal_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(room_id, terminal_session_id)
  );

  CREATE INDEX IF NOT EXISTS idx_antchat_participants_room
    ON antchat_participants(room_id);
  CREATE INDEX IF NOT EXISTS idx_antchat_participants_terminal
    ON antchat_participants(terminal_session_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS antchat_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    terminal_session_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES antchat_rooms(id) ON DELETE CASCADE,
    UNIQUE(room_id, terminal_session_id, tag)
  );

  CREATE INDEX IF NOT EXISTS idx_antchat_tags_room
    ON antchat_tags(room_id);
  CREATE INDEX IF NOT EXISTS idx_antchat_tags_room_terminal
    ON antchat_tags(room_id, terminal_session_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS antchat_tasks (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    contents TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
      'pending', 'assigned', 'in-progress', 'review',
      'being-reviewed', 'reviewed-agent-signed-off',
      'reviewed-needs-work', 'user-signed-off'
    )),
    assigned_to TEXT DEFAULT NULL,
    assigned_name TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES antchat_rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_antchat_tasks_room
    ON antchat_tasks(room_id);
  CREATE INDEX IF NOT EXISTS idx_antchat_tasks_status
    ON antchat_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_antchat_tasks_room_status
    ON antchat_tasks(room_id, status);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS antchat_context_files (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_type TEXT DEFAULT NULL,
    short_name TEXT DEFAULT NULL,
    description TEXT DEFAULT NULL,
    added_by TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (room_id) REFERENCES antchat_rooms(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_antchat_cf_room
    ON antchat_context_files(room_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_antchat_cf_room_path
    ON antchat_context_files(room_id, file_path);
`);

// Migration: link messages to ANTchat rooms
try { db.exec(`ALTER TABLE messages ADD COLUMN antchat_room_id TEXT DEFAULT NULL REFERENCES antchat_rooms(id) ON DELETE SET NULL`); } catch {}
db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_antchat_room ON messages(antchat_room_id)`);

// Junction: terminal sessions tagged/mentioned in a message
db.exec(`
  CREATE TABLE IF NOT EXISTS message_terminal_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    terminal_session_id TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (terminal_session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    UNIQUE(message_id, terminal_session_id)
  );

  CREATE INDEX IF NOT EXISTS idx_msg_tags_message
    ON message_terminal_tags(message_id);
  CREATE INDEX IF NOT EXISTS idx_msg_tags_terminal
    ON message_terminal_tags(terminal_session_id);
`);

// Junction: context files referenced in a message
db.exec(`
  CREATE TABLE IF NOT EXISTS message_context_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT NOT NULL,
    context_file_id TEXT NOT NULL,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (context_file_id) REFERENCES antchat_context_files(id) ON DELETE CASCADE,
    UNIQUE(message_id, context_file_id)
  );

  CREATE INDEX IF NOT EXISTS idx_msg_cf_message
    ON message_context_files(message_id);
  CREATE INDEX IF NOT EXISTS idx_msg_cf_file
    ON message_context_files(context_file_id);
`);

// Capture system — cursor tracking for incremental log/event ingest
db.exec(`
  CREATE TABLE IF NOT EXISTS capture_cursors (
    session_id TEXT PRIMARY KEY,
    log_offset INTEGER NOT NULL DEFAULT 0,
    events_offset INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

export default db;
export { DB_PATH };
