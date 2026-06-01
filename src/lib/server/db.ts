/**
 * fresh-ANT runtime DB — better-sqlite3 against ~/.ant/fresh-ant.db.
 *
 * Why better-sqlite3 not bun:sqlite: the launchd com.ant.fresh service runs
 * `bun run start` which executes `node build/index.js`. The SvelteKit server
 * handler runs under Node v20.19.4 (verified via lsof on live process). Node
 * v20.19.4 has no `node:sqlite` (that ships in Node 22.5+) and cannot import
 * `bun:sqlite` (Bun-only built-in). better-sqlite3 is the only Node-runtime
 * compatible synchronous SQLite for this stack.
 *
 * ABI hazard (binding, per feedback_better_sqlite3_abi_mismatch):
 * If the launchd Node version changes (nvm upgrade, system Node bump, etc.),
 * better-sqlite3's native binding may break with a silent crash after the
 * server logs "running at PORT". Recovery:
 *   /Users/jamesking/.nvm/versions/node/v20.19.4/bin/npm rebuild better-sqlite3
 *   launchctl kickstart -k gui/501/com.ant.fresh
 * Or use the bundled script:  bun run rebuild:sqlite  (added to package.json).
 *
 * Persistence scope (per PTY-INJECT-0 v2 design contract, B4b; extended per
 * room-mode design contract 2026-05-13 and responders design contract
 * 2026-05-13):
 * This DB holds the identity-layer tables (terminals, room_memberships), the
 * room-mode tables (chat_room_modes, chat_room_mode_history), and the
 * responders table (chat_room_responders). Chat rooms, messages, invites, and
 * asks remain in their in-memory stores until the broader persistence-doc
 * decision lands. Room-mode + responders live here so set-once-survives-
 * kickstart works before the full rooms-persistence slice.
 *
 * Singleton via globalThis (per feedback_globalthis_pattern) so dev-hot-reload
 * + tests + production all share the one Database instance.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { sweepAutoCreatedRoomPlansInDb } from './autoRoomPlanCleanup';

type DatabaseInstance = ReturnType<typeof Database>;

const DB_GLOBAL_KEY = '__antFreshIdentityDb';

const SCHEMA_DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS terminals (
    id              TEXT PRIMARY KEY,
    pid             INTEGER NOT NULL,
    pid_start       TEXT,
    name            TEXT NOT NULL UNIQUE,
    tmux_target_pane TEXT,
    agent_kind      TEXT,
    pane_status     TEXT NOT NULL DEFAULT 'unknown',
    pane_stale_since INTEGER,
    source          TEXT NOT NULL DEFAULT 'manual',
    expires_at      INTEGER,
    meta            TEXT NOT NULL DEFAULT '{}',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_terminals_pid_pidstart ON terminals (pid, pid_start)`,
  `CREATE INDEX IF NOT EXISTS idx_terminals_expiry ON terminals (expires_at)`,
  `CREATE TABLE IF NOT EXISTS room_memberships (
    id          TEXT PRIMARY KEY,
    room_id     TEXT NOT NULL,
    handle      TEXT NOT NULL,
    terminal_id TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    UNIQUE(room_id, handle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_room ON room_memberships (room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_terminal ON room_memberships (terminal_id)`,
  `CREATE TABLE IF NOT EXISTS chat_room_modes (
    room_id TEXT PRIMARY KEY,
    mode    TEXT NOT NULL CHECK (mode IN ('brainstorm', 'heads-down', 'closed')),
    set_by  TEXT,
    set_at  INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS chat_room_mode_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id       TEXT NOT NULL,
    mode          TEXT NOT NULL CHECK (mode IN ('brainstorm', 'heads-down', 'closed')),
    previous_mode TEXT,
    set_by        TEXT,
    set_at        INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mode_history_room_set_at ON chat_room_mode_history (room_id, set_at DESC)`,
  `CREATE TABLE IF NOT EXISTS chat_room_responders (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id      TEXT NOT NULL,
    terminal_id  TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    order_index  INTEGER NOT NULL,
    set_by       TEXT,
    set_at       INTEGER NOT NULL,
    UNIQUE(room_id, terminal_id),
    UNIQUE(room_id, order_index)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_responders_room_order ON chat_room_responders (room_id, order_index ASC)`,
  `CREATE TABLE IF NOT EXISTS chat_remote_admissions (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT NOT NULL,
    code_hash          TEXT NOT NULL,
    lifetime_preset    TEXT NOT NULL CHECK (lifetime_preset IN ('today','48h','7d','indefinite')),
    expires_at_ms      INTEGER,
    created_by_handle  TEXT,
    created_at_ms      INTEGER NOT NULL,
    accepted_at_ms     INTEGER,
    expires_acceptance_at_ms INTEGER NOT NULL,
    mapping_id_after_accept  TEXT,
    revoked_at_ms      INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_admissions_room_created ON chat_remote_admissions (room_id, created_at_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS chat_remote_mappings (
    id                     TEXT PRIMARY KEY,
    room_id                TEXT NOT NULL,
    remote_instance_label  TEXT NOT NULL,
    bridge_token_hash      TEXT NOT NULL,
    lifetime_preset        TEXT NOT NULL,
    expires_at_ms          INTEGER,
    revoked_at_ms          INTEGER,
    created_at_ms          INTEGER NOT NULL,
    last_seen_at_ms        INTEGER,
    admission_id           TEXT NOT NULL REFERENCES chat_remote_admissions(id),
    direction              TEXT NOT NULL DEFAULT 'both' CHECK (direction IN ('in','out','both'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mappings_room_revoked ON chat_remote_mappings (room_id, revoked_at_ms)`,
  `CREATE TABLE IF NOT EXISTS chat_remote_events (
    id                 TEXT PRIMARY KEY,
    mapping_id         TEXT NOT NULL REFERENCES chat_remote_mappings(id),
    direction          TEXT NOT NULL CHECK (direction IN ('in','out')),
    kind               TEXT NOT NULL,
    payload_json       TEXT NOT NULL,
    status             TEXT NOT NULL CHECK (status IN ('accepted','quarantined')),
    status_reason      TEXT,
    created_at_ms      INTEGER NOT NULL,
    ack_at_ms          INTEGER,
    delivery_state     TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN ('pending','delivered','failed')),
    replay_signature   TEXT NOT NULL,
    UNIQUE (mapping_id, replay_signature)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_mapping_created ON chat_remote_events (mapping_id, created_at_ms DESC)`,
  // Idempotent migration for B2: room_memberships gains revoked_at_ms so
  // remote-mapping revokes mark the synthetic membership inactive rather
  // than DELETE (preserves audit + matches contract). Wrapped in a
  // duplicate-column-tolerant runner below; ALTER TABLE is the only way
  // to add a column to an existing table in SQLite.
  `ALTER TABLE room_memberships ADD COLUMN revoked_at_ms INTEGER`,
  // M3.4a-v2 Rich Agent Status (design contract 2026-05-14): 7 new terminals
  // columns + 1 events table. agent_status carries the current 4-state value;
  // agent_status_source records which input decided it; last_fingerprint_*
  // + last_message_sent_at_ms + last_pty_byte_at_ms are the input signals
  // for the priority cascade fingerprint→hooks→ANT-activity→PID.
  `ALTER TABLE terminals ADD COLUMN agent_status TEXT NOT NULL DEFAULT 'idle' CHECK (agent_status IN ('idle','thinking','working','response-required'))`,
  `ALTER TABLE terminals ADD COLUMN agent_status_source TEXT NOT NULL DEFAULT 'default' CHECK (agent_status_source IN ('fingerprint','hook','ant-activity','pid-cpu','default'))`,
  `ALTER TABLE terminals ADD COLUMN agent_status_at_ms INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE terminals ADD COLUMN last_fingerprint_hash TEXT`,
  `ALTER TABLE terminals ADD COLUMN last_fingerprint_at_ms INTEGER`,
  `ALTER TABLE terminals ADD COLUMN last_message_sent_at_ms INTEGER`,
  `ALTER TABLE terminals ADD COLUMN last_pty_byte_at_ms INTEGER`,
  // Context-fill from per-CLI fingerprint probe (JWPK msg_vz19pvkajk 2026-05-19).
  // 0..1 float. NULL when never probed. Source tracks who wrote it
  // ('claude-statusline' / 'gemini-cli' / 'pi-mode-rpc' / 'codex-jsonrpc' /
  // 'manual' / etc.) so we can prefer authoritative inputs as more CLI
  // surfaces wire up. _at_ms is the wall-clock when last written; stale
  // values (>5min) should be treated as "unknown" by readers, but the
  // column itself never lies — the reader applies freshness policy.
  `ALTER TABLE terminals ADD COLUMN agent_context_fill REAL`,
  `ALTER TABLE terminals ADD COLUMN agent_context_fill_source TEXT`,
  `ALTER TABLE terminals ADD COLUMN agent_context_fill_at_ms INTEGER`,
  // Per-terminal model flag (JWPK msg_fespxsi2lu + msg_05lh00n3wg antV4
  // 2026-05-28). Free-form string so settings can manage its own list
  // (mirrors agentKinds localStorage pattern). NULL = unspecified; UI
  // collects "unspecified" into its own subheading per CLI group. The
  // string is the user's tag, not a canonical model id — purely aesthetic
  // grouping ("Kimi running in codex" vs "codex running in codex").
  `ALTER TABLE terminals ADD COLUMN model TEXT`,
  // Terminal lifecycle status (JWPK A Team msg_w7sfmc4hpp + msg_8m9xsw8d62
  // 2026-05-29). Source of truth for "is this terminal usable for routing
  // right now". Distinct from pane_status (verified/stale/unknown — last
  // tmux-pane verification result) and from agent_status (idle/thinking/
  // working — agent activity). Lifecycle answers "is this terminal a
  // candidate for room_memberships binding": live = yes; archived = PID
  // gone, handle free for re-bind; deleted = explicit operator removal,
  // do not re-bind.
  //
  // The invites pane reads status='archived' as "free, recoverable"
  // handles — recovered shells take the binding back via `ant register
  // --handle @x` without the manual add-membership dance. agentStatusPoller
  // auto-flips status from 'live' to 'archived' when (local) tmux pane is
  // gone OR (remote) last_heartbeat_at_ms is past the staleness threshold.
  `ALTER TABLE terminals ADD COLUMN status TEXT NOT NULL DEFAULT 'live' CHECK (status IN ('live','archived','deleted'))`,
  // Last working directory the shell was in. Updated by a PROMPT_COMMAND
  // hook that POSTs to /api/terminals/:id/path on PWD change; allows a
  // recovered shell to `cd $last_path` automatically when the same
  // handle is re-bound. NULL until the first hook fire.
  `ALTER TABLE terminals ADD COLUMN last_path TEXT`,
  `CREATE TABLE IF NOT EXISTS chat_agent_status_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id     TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    prev_status     TEXT,
    new_status      TEXT NOT NULL,
    source          TEXT NOT NULL,
    changed_at_ms   INTEGER NOT NULL,
    evidence_json   TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_status_events_terminal ON chat_agent_status_events (terminal_id, changed_at_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS chat_discussions (
    id                TEXT PRIMARY KEY,
    room_id           TEXT NOT NULL,
    parent_message_id TEXT NOT NULL,
    title             TEXT,
    status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_by         TEXT NOT NULL,
    opened_at         INTEGER NOT NULL,
    closed_by         TEXT,
    closed_at         INTEGER,
    summary           TEXT,
    UNIQUE(room_id, parent_message_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discussions_room_status ON chat_discussions (room_id, status)`,
  `CREATE TABLE IF NOT EXISTS browser_sessions (
    id              TEXT PRIMARY KEY,
    secret_hash     TEXT NOT NULL UNIQUE,
    room_id         TEXT NOT NULL,
    terminal_id     TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    handle          TEXT NOT NULL,
    synthetic_handle TEXT NOT NULL,
    created_at_ms   INTEGER NOT NULL,
    expires_at_ms   INTEGER NOT NULL,
    revoked_at_ms   INTEGER,
    last_seen_at_ms INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_browser_sessions_room_handle ON browser_sessions (room_id, handle, revoked_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_browser_sessions_terminal ON browser_sessions (terminal_id)`,
  `CREATE TABLE IF NOT EXISTS linked_chat_permissions (
    id              TEXT PRIMARY KEY,
    terminal_id     TEXT NOT NULL REFERENCES terminals(id) ON DELETE CASCADE,
    subject_handle  TEXT NOT NULL,
    state           TEXT NOT NULL CHECK (state IN ('allow','deny')),
    set_by          TEXT NOT NULL,
    set_at_ms       INTEGER NOT NULL,
    reason          TEXT,
    UNIQUE(terminal_id, subject_handle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_linked_chat_permissions_terminal ON linked_chat_permissions (terminal_id)`,
  `CREATE TABLE IF NOT EXISTS chat_rooms (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    summary             TEXT NOT NULL DEFAULT '',
    attention_state     TEXT NOT NULL DEFAULT 'ready',
    last_update         TEXT NOT NULL,
    when_it_was_created TEXT NOT NULL,
    who_created_it      TEXT NOT NULL,
    creation_order      INTEGER NOT NULL UNIQUE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_rooms_creation_order ON chat_rooms (creation_order DESC)`,
  // Per JWPK 2026-05-22 (msg_a1cnonmsij): rooms list should sort by the
  // time of the last MESSAGE — not by membership churn / agent status.
  // post_order is the monotonic global counter on chat_messages, so the
  // max post_order per room == "most recently active room". We store it
  // here for fast ORDER BY (no per-row subquery in the hot list path)
  // AND keep a COALESCE fallback on listChatRooms in case the column
  // hasn't been backfilled yet for a row. NULL = no messages in the
  // room yet; falls back to creation_order as a stable tiebreaker.
  `ALTER TABLE chat_rooms ADD COLUMN last_post_order INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_chat_rooms_last_post_order ON chat_rooms (last_post_order DESC)`,
  `CREATE TABLE IF NOT EXISTS chat_room_members (
    id            TEXT PRIMARY KEY,
    room_id       TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    handle        TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    joined_at     TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('human','agent')),
    UNIQUE(room_id, handle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_members_room ON chat_room_members (room_id)`,
  // parent_message_id is intentionally NOT a foreign key per Phase 5.0 Q5
  // permissive-store-layer lock: existing M30 slice 1 test surface expects
  // the store to accept unknown parent IDs without rejection. Validation +
  // 404 enforcement live at the /messages route (validateAndResolveParent-
  // MessageId in +server.ts), NOT the store. ON DELETE behaviour for parent
  // tombstoning is moot today (messages aren't individually deleted; only
  // CASCADE-deleted via room removal). If individual delete ever ships,
  // revisit this column with an explicit ON DELETE SET NULL FK.
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id                  TEXT PRIMARY KEY,
    room_id             TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    author_handle       TEXT NOT NULL,
    author_display_name TEXT NOT NULL,
    kind                TEXT NOT NULL CHECK (kind IN ('human','agent','system','system-break')),
    body                TEXT NOT NULL,
    posted_at           TEXT NOT NULL,
    post_order          INTEGER NOT NULL UNIQUE,
    parent_message_id   TEXT,
    discussion_id       TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_room_post_order ON chat_messages (room_id, post_order ASC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON chat_messages (parent_message_id)`,
  `CREATE TABLE IF NOT EXISTS message_read_receipts (
    message_id     TEXT NOT NULL,
    reader_handle  TEXT NOT NULL,
    read_at        TEXT NOT NULL,
    read_at_ms     INTEGER NOT NULL,
    PRIMARY KEY (message_id, reader_handle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message_time
     ON message_read_receipts (message_id, read_at_ms ASC, reader_handle ASC)`,
  `CREATE TABLE IF NOT EXISTS chat_room_attachments (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT NOT NULL,
    filename           TEXT NOT NULL,
    mime_type          TEXT NOT NULL,
    byte_size          INTEGER NOT NULL,
    contents_base64    TEXT NOT NULL,
    uploaded_by_handle TEXT NOT NULL,
    uploaded_at        TEXT NOT NULL,
    uploaded_at_ms     INTEGER NOT NULL,
    upload_order       INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_attachments_room_order
     ON chat_room_attachments (room_id, upload_order DESC)`,
  // Room-scoped participant presentation. Canonical handle remains the
  // routing key; these fields are per-room visual overrides only.
  `ALTER TABLE chat_room_members ADD COLUMN display_color TEXT`,
  `ALTER TABLE chat_room_members ADD COLUMN display_icon TEXT`,
  `ALTER TABLE chat_room_members ADD COLUMN display_background_style TEXT`,
  // M4.4 chair handoff (canonical PASS 2026-05-14 delta-5):
  // chat_rooms.current_chair_handle as an additive ALTER column (idempotent
  // on re-runs per applySchemaMigrations duplicate-column-name tolerance).
  `ALTER TABLE chat_rooms ADD COLUMN current_chair_handle TEXT`,
  `CREATE TABLE IF NOT EXISTS chat_room_chair_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id      TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    from_handle  TEXT,
    to_handle    TEXT NOT NULL,
    set_by       TEXT NOT NULL,
    set_at_ms    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chair_history_room_set_at ON chat_room_chair_history (room_id, set_at_ms DESC)`,
  // M4.5 interview start/end (canonical PASS 2026-05-14 delta-2):
  // current_interview_id is APP-LEVEL pointer (no FK per SQLite ALTER
  // TABLE constraint; cleanup edge is chat_room_interviews.room_id CASCADE).
  `ALTER TABLE chat_rooms ADD COLUMN current_interview_id TEXT`,
  // Contract binding (2026-05-23): which governance contract this room follows.
  `ALTER TABLE chat_rooms ADD COLUMN contract_id TEXT`,
  // Context-break enforcement (2026-05-23): hard mode makes the latest
  // system-break a server-side context boundary. off/advisory keep history
  // available for deliberate recall paths while UI/agents can still warn.
  `ALTER TABLE chat_rooms ADD COLUMN context_break_enforcement TEXT NOT NULL DEFAULT 'hard'
    CHECK (context_break_enforcement IN ('off','advisory','hard'))`,
  `CREATE TABLE IF NOT EXISTS chat_room_interviews (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    interviewer     TEXT NOT NULL,
    subject_handle  TEXT NOT NULL,
    started_at_ms   INTEGER NOT NULL,
    ended_at_ms     INTEGER,
    end_reason      TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_interviews_room_started ON chat_room_interviews (room_id, started_at_ms DESC)`,
  // M-SHARED-SCREENSHOTS T1 (canonical RQO delta-1 reframe PASS-pending):
  // opt-in flag + per-room SQLite index per JWPK 3-constraints lock.
  `ALTER TABLE chat_rooms ADD COLUMN shared_folder_enabled INTEGER DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS screenshots (
    sha            TEXT NOT NULL,
    room_id        TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    taken_by       TEXT NOT NULL,
    taken_at_ms    INTEGER NOT NULL,
    bytes          INTEGER NOT NULL DEFAULT 0,
    topic          TEXT,
    dimensions     TEXT,
    parent_sha     TEXT,
    ttl_until_ms   INTEGER,
    deck_slug      TEXT,
    PRIMARY KEY (sha, room_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_screenshots_room_taken ON screenshots (room_id, taken_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_screenshots_ttl ON screenshots (ttl_until_ms) WHERE ttl_until_ms IS NOT NULL`,
  // M-SHARED-SCREENSHOTS T3a delta-2: soft-delete column for manual prune flow.
  // ttl_until_ms above is legacy (JWPK Q-B SURFACE-SIZE-ONLY drops TTL enforcement).
  `ALTER TABLE screenshots ADD COLUMN deleted_at_ms INTEGER`,
  // M-SHARED-SCREENSHOTS T3b: room-level soft-delete column. No production
  // DELETE-room API today; future API will set this so screenshots FK CASCADE
  // never fires and files + index rows survive (JWPK Q-E preservation).
  `ALTER TABLE chat_rooms ADD COLUMN deleted_at_ms INTEGER`,
  // DASH-ARCHIVE (2026-05-15): hide-from-default-list flag. Mirrors
  // deleted_at_ms semantics but is non-destructive — archived rooms are
  // recoverable via POST /api/chat-rooms/:id/archive (DELETE verb).
  // listChatRooms / loadRoomById / doesChatRoomExist exclude archived rows
  // so the default UI surfaces never see them.
  `ALTER TABLE chat_rooms ADD COLUMN archived_at_ms INTEGER`,
  // Room description (JWPK 2026-05-24 yz4clwzvbm msg_jj50zw48fr): "optional
  // description that can be set by a user or agent like changing the room
  // name". Distinct from `summary` (which is auto-derived from the latest
  // message); description is user/agent-authored context that survives
  // chat activity. NULL when unset → UI falls back to the auto-summary.
  `ALTER TABLE chat_rooms ADD COLUMN description TEXT`,
  // TERMINALS-T2a (2026-05-14, JWPK terminals-redesign): "ANT-view retained
  // forever" scrollback per linkedchat-backend-v3-audit. Lift of v3 run_events
  // shape (db.ts L66-79). FK omitted — terminal_id can be a v3-daemon
  // sessionId (`t_xxx`) or a future fresh-ANT terminals.id.
  `CREATE TABLE IF NOT EXISTS terminal_run_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    terminal_id   TEXT NOT NULL,
    ts_ms         INTEGER NOT NULL,
    source        TEXT NOT NULL DEFAULT 'pty',
    trust         TEXT NOT NULL DEFAULT 'raw' CHECK (trust IN ('high','medium','raw')),
    kind          TEXT NOT NULL,
    text          TEXT DEFAULT '',
    payload       TEXT DEFAULT '{}',
    raw_ref       TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_term_run_events_terminal_ts ON terminal_run_events (terminal_id, ts_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_term_run_events_ts ON terminal_run_events (ts_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_term_run_events_kind ON terminal_run_events (kind)`,
  // V4-BLOCKER-B (2026-05-15): transcript-tail watchers re-read JSONL from
  // byte 0 on restart (in-memory offset map). Native per-line stable id
  // (claude uuid / codex id / qwen uuid / gemini id / copilot id / pi id)
  // gives idempotency independent of byte-offset/restart/file-rotation.
  // Partial UNIQUE index ignores legacy/pty rows that have NULL id.
  `ALTER TABLE terminal_run_events ADD COLUMN transcript_event_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_term_run_events_transcript_id
     ON terminal_run_events (terminal_id, transcript_event_id)
     WHERE transcript_event_id IS NOT NULL`,
  // V4-BLOCKER-C (2026-05-15): SURFACE-SIZE-ONLY soft-delete column. The
  // one-shot historical dedup sweep marks pre-idempotency duplicate
  // transcript rows deleted instead of hard-removing them (per JWPK
  // soft-delete + manual-prune pattern — no auto-purge cron). List
  // queries filter deleted_at_ms IS NULL.
  `ALTER TABLE terminal_run_events ADD COLUMN deleted_at_ms INTEGER`,
  // TERMINALS-T2d (2026-05-14, JWPK terminals-redesign): JWPK-visible terminal
  // entity record (separate from existing M3.x pid-bound `terminals` table).
  // Per JWPK Q1 lock: auto_forward_room_id is single-target nullable. Per v3
  // linked-chat-adapter: auto_forward_chat 1=raw-keystroke, 0=ANSI block.
  `CREATE TABLE IF NOT EXISTS terminal_records (
    session_id            TEXT PRIMARY KEY,
    name                  TEXT NOT NULL UNIQUE,
    auto_forward_room_id  TEXT,
    auto_forward_chat     INTEGER NOT NULL DEFAULT 1,
    created_at_ms         INTEGER NOT NULL,
    updated_at_ms         INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_terminal_records_room ON terminal_records (auto_forward_room_id)`,
  // TERMINALS-T2b agent_kind-autodetect wiring (2026-05-14): JWPK-visible
  // terminal entity now stores agent_kind so daemon-spawned sessions can
  // also drive Layer A interactive-event detection. Frontend supplies via
  // POST/PATCH, future slice may auto-populate via fingerprintDetector.
  `ALTER TABLE terminal_records ADD COLUMN agent_kind TEXT`,
  // T2-LINKED-CHAT-T1a (2026-05-14, PATH A flowspec lift): terminal_records
  // becomes the canonical terminalsStore for fresh-ANT — handle/pane/agent_
  // kind colocated. tmux_target_pane is `<sessionId>:0.0` for daemon-spawned
  // sessions (`tmux new-session -A -s <sessionId>` default window/pane).
  `ALTER TABLE terminal_records ADD COLUMN tmux_target_pane TEXT`,
  // T2-LINKED-CHAT-T1b (2026-05-14): each terminal_record gets a 1:1 linked
  // chat room. Per JWPK semantic correction "Chat IS the linked chat room"
  // (not a kind=message filter). POST /api/terminals auto-creates this room
  // and writes its id back here. Nullable for back-compat with pre-T1b rows.
  `ALTER TABLE terminal_records ADD COLUMN linked_chat_room_id TEXT`,
  // T2-IDENTITY-REGISTER-S1 (2026-05-14): JWPK ant newterminal + ant attach
  // shapes. created_by binds the claim to a handle (server-validated). allowlist
  // is a JSON array of additional handles allowed to invite/mention/launch
  // against this terminal — null = creator + operator only.
  `ALTER TABLE terminal_records ADD COLUMN created_by TEXT`,
  `ALTER TABLE terminal_records ADD COLUMN allowlist TEXT`,
  // T2-IDENTITY-REGISTER-S7 (2026-05-14): JWPK allowed-posters picker
  // requires handle as a first-class column. Nullable v1 for back-compat;
  // no UNIQUE constraint v1 (collisions surface as picker UX). Eventually
  // identity-register flow auto-populates from `ant register --handle @x`.
  `ALTER TABLE terminal_records ADD COLUMN handle TEXT`,
  // Pane-binding supersession (JWPK msg_wlvguvfvqu / msg_8390722mjh 2026-05-27).
  // When a new terminal_record claims a tmux_target_pane that was already
  // owned by a different terminal_record, the prior record's
  // superseded_at_ms is set. Fanout / picker / inbox / fleet readers all
  // filter on `superseded_at_ms IS NULL` so a recycled tmux pane does
  // not deliver the prior agent's room subscriptions to whoever spawns
  // next. Cleanup readers (linkedRoomAgentGuffPurge) still see
  // superseded rows so orphan cleanup paths keep working. Audit-style
  // listTerminalRecords stays unfiltered to preserve history. See
  // docs/research/pane-binding-supersession-scope-2026-05-27.md.
  `ALTER TABLE terminal_records ADD COLUMN superseded_at_ms INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_terminal_records_superseded ON terminal_records (superseded_at_ms)`,
  // Lifecycle Phase A1 handle_aliases (JWPK A Team msg_w7sfmc4hpp +
  // msg_7uvr35x0xr 2026-05-29). JSON array of previous handles the
  // same terminal_record has been registered under. Preserves history
  // when a shell morphs its handle mid-session (e.g. @claudev4 ->
  // @claudev5). NULL when no aliases yet. Written by Phase B's
  // `ant register` handle-change path via appendHandleAlias();
  // Phase A1 ships the column + helpers only.
  `ALTER TABLE terminal_records ADD COLUMN handle_aliases TEXT`,
  // Fix #2 of sec-iter1 (2026-05-30 enterprise security pass). Root-cause
  // structural fix for the privilege-escalation surface that Fix #1
  // closes at the approver gate: terminal_records.handle must be UNIQUE
  // across active rows so an attacker can never register a second terminal
  // claiming the victim's handle. Partial index excludes NULL/empty
  // handles (some terminals don't pick a handle until later) and
  // superseded rows (pane-recycled rows that no longer authoritatively
  // own their handle). Pre-existing duplicate handles must be cleaned up
  // with `scripts/migrate-dedup-handles.mjs` before the index is
  // created — without that, this statement throws SQLITE_CONSTRAINT and
  // server boot aborts. Operators with potential duplicates must run
  // the migration once before the schema migration runs.
  `CREATE UNIQUE INDEX IF NOT EXISTS terminal_records_handle_unique
     ON terminal_records(handle)
     WHERE handle IS NOT NULL AND handle != '' AND superseded_at_ms IS NULL`,
  // Lane-D PLANS S1 (2026-05-15, canonical RQO32-gated decision-doc
  // docs/lane-d-plans-design-2026-05-15.md). First-class PERSISTED task
  // entity. JWPK Q1: tasks are INDEPENDENT of plans — plan_id is an
  // OPTIONAL link, NULL = standalone task; a task is NEVER a child of a
  // plan. blocks/blocked_by are JSON id-arrays deliberately matching the
  // claude `~/.claude/tasks/<sid>/*.json` shape so FINGERPRINT-MANIFEST
  // harvest + B2-7 share ONE dependency graph. evidence reuses the
  // planModeStore EvidenceRef shape (JSON array). Existing in-memory
  // plan-event projection (planModeStore) is intentionally UNTOUCHED.
  `CREATE TABLE IF NOT EXISTS tasks (
    id              TEXT PRIMARY KEY,
    subject         TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_progress','blocked','completed','deleted')),
    priority        INTEGER,
    plan_id         TEXT,
    assigned_agent  TEXT,
    blocks          TEXT NOT NULL DEFAULT '[]',
    blocked_by      TEXT NOT NULL DEFAULT '[]',
    evidence        TEXT NOT NULL DEFAULT '[]',
    notes           TEXT,
    started_at_ms   INTEGER,
    ended_at_ms     INTEGER,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks (plan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status)`,
  // plan_rooms — many-to-many link between plans (implicit, identified
  // by plan_id text) and chat_rooms (real entity). No FK on plan_id
  // because plans aren't first-class entities yet (JWPK Q1, Lane-D).
  // Composite PK gives free uniqueness + plan-direction index; the
  // explicit room-direction index makes "plans-for-room" cheap too.
  // ON DELETE CASCADE on room: deleting a room evaporates its attachments.
  `CREATE TABLE IF NOT EXISTS plan_rooms (
    plan_id        TEXT NOT NULL,
    room_id        TEXT NOT NULL,
    attached_at_ms INTEGER NOT NULL,
    attached_by    TEXT,
    PRIMARY KEY (plan_id, room_id),
    FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_rooms_room ON plan_rooms (room_id)`,
  // plans entity (JWPK Q1 evolution: optional explicit entity over the
  // implicit-plan-id model). A task's plan_id can reference a row here
  // but no FK is enforced — implicit plans remain valid.
  `CREATE TABLE IF NOT EXISTS plans (
    id              TEXT PRIMARY KEY,
    title           TEXT,
    description     TEXT,
    created_by      TEXT,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,
    archived_at_ms  INTEGER,
    deleted_at_ms   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plans_archived ON plans (archived_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_plans_deleted ON plans (deleted_at_ms)`,
  // QUICK-SHORTCUTS (2026-05-15): global, user-editable list of terminal
  // shortcut chips. JWPK-locked: global scope (one shared list across all
  // terminals), server-persisted in fresh-ant.db so a tab-reload or fresh
  // session sees the same shortcuts. Hard-delete only (these are user prefs
  // — easy to recreate; no soft-delete plumbing needed). order_index is the
  // sort key (smaller first); reorder bulk-updates via a transaction.
  `CREATE TABLE IF NOT EXISTS quick_shortcuts (
    id            TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    text          TEXT NOT NULL,
    auto_enter    INTEGER NOT NULL DEFAULT 1,
    order_index   INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quick_shortcuts_order ON quick_shortcuts (order_index ASC)`,
  // cwd_bookmarks: server-side persistence for the cwd pills surfaced under
  // the breadcrumb in TerminalFolderPicker. Mirrors quick_shortcuts pattern
  // per JWPK 2026-05-15 lock (GLOBAL scope, fresh-ant.db) so bookmarks sync
  // across Tailscale devices (mac / macbook-server / ipad / iPhone). UNIQUE
  // path prevents duplicate entries; order_index drives display order.
  `CREATE TABLE IF NOT EXISTS cwd_bookmarks (
    id            TEXT PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    order_index   INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cwd_bookmarks_order ON cwd_bookmarks (order_index ASC)`,
  // ANTSCRIPT v1 — plan_triggers: event → action mappings.
  // plan_id = NULL is a wildcard ("apply to every plan"). event is one of
  // plan.completed / plan.archived / plan.deleted / plan.restored. action is
  // one of room.message / console.log. action_config is JSON: room.message
  // = {messageTemplate, authorHandle?}; console.log = {message}. fire_count
  // + last_fired_at_ms are best-effort observability for dispatch tracing.
  `CREATE TABLE IF NOT EXISTS plan_triggers (
    id               TEXT PRIMARY KEY,
    plan_id          TEXT,
    event            TEXT NOT NULL,
    action           TEXT NOT NULL,
    action_config    TEXT NOT NULL DEFAULT '{}',
    enabled_at_ms    INTEGER NOT NULL,
    last_fired_at_ms INTEGER,
    fire_count       INTEGER NOT NULL DEFAULT 0,
    created_by       TEXT,
    created_at_ms    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_triggers_plan ON plan_triggers (plan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_triggers_event ON plan_triggers (event)`,
  // Scheduled jobs v1 — named cron-like jobs that can be started,
  // paused, stopped, or deleted. The scheduler runner is intentionally
  // separate from plan_triggers: plan_triggers are event-driven, while
  // scheduled_jobs are time-driven.
  `CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    status            TEXT NOT NULL,
    every_minutes     INTEGER NOT NULL,
    action            TEXT NOT NULL,
    action_config     TEXT NOT NULL DEFAULT '{}',
    next_run_at_ms    INTEGER,
    last_run_at_ms    INTEGER,
    run_count         INTEGER NOT NULL DEFAULT 0,
    created_by        TEXT,
    created_at_ms     INTEGER NOT NULL,
    updated_at_ms     INTEGER NOT NULL,
    deleted_at_ms     INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status_next
     ON scheduled_jobs (status, next_run_at_ms)`,
  // CLI-HOOK-BRIDGE Phase 1A (2026-05-15, JWPK Slice B follow-up): ANT
  // receives structured agent-lifecycle events from CLI hooks (Claude Code
  // today; codex/pi/gemini in later phases). source_cli partitions by
  // origin so the table can host all four protocols; payload TEXT is the
  // full JSON blob for fields not promoted to columns. Promoted columns
  // are the ones we actually query for badges/timelines (session_id, hook
  // event name, tool_name, received_at_ms). transcript_path, cwd,
  // permission_mode, effort_level are denormalised because they're
  // present on EVERY claude hook payload and useful for filtering.
  `CREATE TABLE IF NOT EXISTS cli_hook_events (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    source_cli        TEXT NOT NULL DEFAULT 'claude-code',
    session_id        TEXT NOT NULL,
    hook_event_name   TEXT NOT NULL,
    received_at_ms    INTEGER NOT NULL,
    transcript_path   TEXT,
    cwd               TEXT,
    permission_mode   TEXT,
    effort_level      TEXT,
    tool_name         TEXT,
    tool_use_id       TEXT,
    payload           TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_session_ts
     ON cli_hook_events (session_id, received_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_event_ts
     ON cli_hook_events (hook_event_name, received_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_source_ts
     ON cli_hook_events (source_cli, received_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_cli_hook_events_received_at ON cli_hook_events (received_at_ms)`,
  // SHORTCUTS (2026-05-16, JWPK settings addterminalshortcut /
  // addchatroomshortcut). Scope-aware; scope_target is the terminalId or
  // roomId, NULL for global. order_index drives QuickShortcutsBar order.
  `CREATE TABLE IF NOT EXISTS shortcuts (
    id            TEXT PRIMARY KEY,
    scope         TEXT NOT NULL CHECK (scope IN ('terminal','chatroom','global')),
    scope_target  TEXT,
    label         TEXT NOT NULL,
    command       TEXT NOT NULL,
    order_index   INTEGER NOT NULL DEFAULT 0,
    created_at_ms INTEGER NOT NULL,
    created_by    TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_shortcuts_scope_target
     ON shortcuts (scope, scope_target, order_index ASC)`,
  // JWPK TASKS-SUBSYSTEM (2026-05-16): extend existing tasks table with
  // JWPK-spec columns for terminal/room binding + ordering. Existing
  // Lane-D columns preserved; new columns nullable.
  `ALTER TABLE tasks ADD COLUMN title TEXT`,
  `ALTER TABLE tasks ADD COLUMN assigned_to TEXT`,
  `ALTER TABLE tasks ADD COLUMN assigned_terminal_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN room_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`,
  `ALTER TABLE tasks ADD COLUMN completed_at_ms INTEGER`,
  `ALTER TABLE tasks ADD COLUMN created_by TEXT`,
  `ALTER TABLE tasks ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks (assigned_to, status)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_assigned_terminal ON tasks (assigned_terminal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_room ON tasks (room_id)`,
  // MEMORY-CRUD (2026-05-16, JWPK): key/value memories with audit trail.
  // Sits under read-only /api/memory-recall; this layer is the
  // get/put/list/delete surface v3 had at /api/memories.
  `CREATE TABLE IF NOT EXISTS memories (
    id             TEXT PRIMARY KEY,
    key            TEXT NOT NULL UNIQUE,
    value          TEXT NOT NULL,
    scope          TEXT,
    scope_target   TEXT,
    created_at_ms  INTEGER NOT NULL,
    updated_at_ms  INTEGER NOT NULL,
    created_by     TEXT,
    last_updated_by TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memories_key_prefix ON memories (key)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories (scope, scope_target)`,
  `CREATE TABLE IF NOT EXISTS memory_audit (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_key     TEXT NOT NULL,
    action         TEXT NOT NULL CHECK (action IN ('put','delete','update')),
    prev_value     TEXT,
    new_value      TEXT,
    by_handle      TEXT,
    at_ms          INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_audit_key ON memory_audit (memory_key, at_ms DESC)`,
  // FILE-REFS / FLAG (2026-05-16, JWPK): tag files as relevant to a
  // terminal/chatroom/global. scope_target = terminalId or roomId; NULL
  // for global. No FK — file-refs can outlive entity deletes.
  `CREATE TABLE IF NOT EXISTS file_refs (
    id             TEXT PRIMARY KEY,
    file_path      TEXT NOT NULL,
    scope          TEXT NOT NULL CHECK (scope IN ('terminal','chatroom','global')),
    scope_target   TEXT,
    label          TEXT,
    description    TEXT,
    flagged_by     TEXT,
    flagged_at_ms  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_file_refs_scope_target ON file_refs (scope, scope_target)`,
  `CREATE INDEX IF NOT EXISTS idx_file_refs_path ON file_refs (file_path)`,
  // LANE-A CONSENT-GRANTS (2026-05-16): v4 general safety gate, distinct
  // from MCP adapter grants. Room-scoped by default: topic says what is
  // allowed, source_set constrains files/URLs/identifiers, max_answers caps
  // repeated use, and audit rows make create/consume/revoke visible.
  `CREATE TABLE IF NOT EXISTS consent_grants (
    id             TEXT PRIMARY KEY,
    room_id        TEXT NOT NULL,
    granted_to     TEXT NOT NULL,
    topic          TEXT NOT NULL,
    source_set     TEXT NOT NULL DEFAULT '[]',
    duration       TEXT NOT NULL DEFAULT '1h',
    answer_count   INTEGER NOT NULL DEFAULT 0,
    max_answers    INTEGER,
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','revoked','expired','exhausted')),
    granted_at_ms  INTEGER NOT NULL,
    expires_at_ms  INTEGER,
    created_by     TEXT,
    revoked_at_ms  INTEGER,
    revoked_by     TEXT,
    updated_at_ms  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_consent_grants_room_status ON consent_grants (room_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_consent_grants_grantee ON consent_grants (granted_to, status)`,
  `CREATE INDEX IF NOT EXISTS idx_consent_grants_topic ON consent_grants (topic, status)`,
  `CREATE TABLE IF NOT EXISTS consent_grant_audit (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    grant_id      TEXT NOT NULL REFERENCES consent_grants(id) ON DELETE RESTRICT,
    action        TEXT NOT NULL CHECK (action IN ('created','consumed','revoked','expired','exhausted')),
    actor_handle  TEXT,
    at_ms         INTEGER NOT NULL,
    note          TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_consent_grant_audit_grant ON consent_grant_audit (grant_id, at_ms ASC)`,
  // Task #49 v3-parity: room-to-room links. Lets a room surface its
  // sibling discussion / spawned-from / follow-up rooms so JWPK can
  // navigate between linked rooms without pasting URLs. UNIQUE on
  // (source, target, relationship) prevents duplicate edges.
  `CREATE TABLE IF NOT EXISTS chat_room_links (
    id               TEXT PRIMARY KEY,
    source_room_id   TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    target_room_id   TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    relationship     TEXT NOT NULL CHECK (relationship IN ('discussion_of','promoted_summary_for','spawned_from','follows_up')),
    title            TEXT,
    created_by       TEXT,
    created_at_ms    INTEGER NOT NULL,
    UNIQUE(source_room_id, target_room_id, relationship)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_links_source ON chat_room_links (source_room_id, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_links_target ON chat_room_links (target_room_id, created_at_ms DESC)`,
  // Task #91/#98 v3-parity: per-room artefacts panel (HTML / decks /
  // spreadsheets / docs / mockups / other). Kind is enforced at the
  // schema level; the UI groups by kind. ref_url is the location the
  // UI links/embeds — file/http/etc. — but we don't proxy or store the
  // bytes here (attachments table owns binary storage).
  `CREATE TABLE IF NOT EXISTS chat_room_artefacts (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    kind            TEXT NOT NULL CHECK (kind IN ('html','deck','stage','spreadsheet','doc','mockup','other')),
    title           TEXT NOT NULL,
    ref_url         TEXT,
    summary         TEXT,
    created_by      TEXT,
    created_at_ms   INTEGER NOT NULL,
    deleted_at_ms   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_artefacts_room_kind ON chat_room_artefacts (room_id, kind, created_at_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS chat_room_artefact_content (
    id                TEXT PRIMARY KEY,
    artefact_id       TEXT NOT NULL REFERENCES chat_room_artefacts(id) ON DELETE CASCADE,
    room_id           TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('deck','doc')),
    content_format    TEXT NOT NULL CHECK (content_format IN ('markdown','univer-json')),
    content_body      TEXT NOT NULL,
    updated_at_ms     INTEGER NOT NULL,
    updated_by_handle TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_artefact_content_artefact ON chat_room_artefact_content (artefact_id)`,
  // #155/#427: starred rooms are an operator preference, not a
  // browser-local accident. One row per owner/room, ordered by the
  // drag order used on the dashboard.
  `CREATE TABLE IF NOT EXISTS room_bookmarks (
    owner_handle  TEXT NOT NULL,
    room_id       TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    order_index   INTEGER NOT NULL,
    created_at_ms INTEGER NOT NULL,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (owner_handle, room_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_room_bookmarks_owner_order ON room_bookmarks (owner_handle, order_index ASC)`,
  // TUNNELS (2026-05-17, JWPK): local-dev site sharing via ANT.
  // Each tunnel exposes a public URL (e.g. Cloudflare Tunnel) scoped
  // to one or more rooms. owner_room_id is the creating room.
  `CREATE TABLE IF NOT EXISTS tunnels (
    slug              TEXT PRIMARY KEY,
    title             TEXT,
    public_url        TEXT NOT NULL,
    local_url         TEXT,
    owner_room_id     TEXT NOT NULL,
    allowed_room_ids  TEXT NOT NULL DEFAULT '[]',
    access_required   INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'linked'
                        CHECK (status IN ('linked','offline','error')),
    created_at_ms     INTEGER NOT NULL,
    updated_at_ms     INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tunnels_owner ON tunnels (owner_room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tunnels_status ON tunnels (status)`,
  // PAIRING TOKENS (2026-05-17, JWPK): QR-based device onboarding.
  // Short-lived, single-use tokens that encode server URL + room + key.
  // consumed_at_ms marks use; expires_at_ms enables TTL cleanup.
  `CREATE TABLE IF NOT EXISTS pairing_tokens (
    token             TEXT PRIMARY KEY,
    room_id           TEXT NOT NULL,
    server_url        TEXT NOT NULL,
    api_key           TEXT NOT NULL,
    device_name       TEXT,
    created_by        TEXT,
    created_at_ms     INTEGER NOT NULL,
    expires_at_ms     INTEGER,
    consumed_at_ms    INTEGER,
    consumed_by_device TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pairing_tokens_room ON pairing_tokens (room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pairing_tokens_expires ON pairing_tokens (expires_at_ms)`,
  // SHARE LINKS (2026-05-17, JWPK): read-only public URLs for sharing
  // room/session state externally. Short token, optional expiry, revocable.
  `CREATE TABLE IF NOT EXISTS share_links (
    token             TEXT PRIMARY KEY,
    room_id           TEXT NOT NULL,
    title             TEXT,
    scope             TEXT NOT NULL DEFAULT 'room'
                        CHECK (scope IN ('room','messages','tasks','plan')),
    created_by        TEXT,
    created_at_ms     INTEGER NOT NULL,
    expires_at_ms     INTEGER,
    revoked_at_ms     INTEGER,
    access_count      INTEGER NOT NULL DEFAULT 0,
    last_accessed_ms  INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_share_links_room ON share_links (room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_share_links_expires ON share_links (expires_at_ms)`,
  // Task #111 v3-parity: file-refs registry — flag a file path inside
  // a room with an optional note. Narrower than artefacts: just path
  // + note, no kind enum, no ref URL. Soft-delete column matches the
  // rest of v4's store conventions.
  `CREATE TABLE IF NOT EXISTS chat_room_file_refs (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    file_path       TEXT NOT NULL,
    note            TEXT,
    flagged_by      TEXT,
    created_at_ms   INTEGER NOT NULL,
    deleted_at_ms   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_file_refs_room ON chat_room_file_refs (room_id, created_at_ms DESC)`,
  // Task #114 v3-parity: prompt-bridge minimum viable. Records the
  // moment a terminal/agent surfaced a prompt that needs a human (or
  // peer-agent) response. Status moves from 'pending' to 'responded'
  // once the room thread answers it. Narrow shape; the v3 broker layer
  // (multiple delivery targets + pattern config) lands in a follow-up.
  `CREATE TABLE IF NOT EXISTS terminal_prompt_events (
    id              TEXT PRIMARY KEY,
    terminal_id     TEXT REFERENCES terminals(id) ON DELETE CASCADE,
    room_id         TEXT REFERENCES chat_rooms(id) ON DELETE CASCADE,
    raw_text        TEXT NOT NULL,
    detector        TEXT,
    detected_at_ms  INTEGER NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('pending','responded','dismissed')) DEFAULT 'pending',
    responded_at_ms INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_terminal_prompt_events_room_status ON terminal_prompt_events (room_id, status, detected_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_terminal_prompt_events_terminal ON terminal_prompt_events (terminal_id, detected_at_ms DESC)`,
  // Task #124 v3-parity: room-scoped markdown docs. Content is stored
  // inline (not ref_url) so the docs are searchable and editable.
  `CREATE TABLE IF NOT EXISTS chat_room_docs (
    id             TEXT PRIMARY KEY,
    room_id        TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    content        TEXT NOT NULL DEFAULT '',
    created_by     TEXT,
    created_at_ms  INTEGER NOT NULL,
    updated_at_ms  INTEGER,
    access_password TEXT,
    deleted_at_ms  INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_docs_room ON chat_room_docs (room_id, updated_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_docs_search ON chat_room_docs (room_id, title)`,
  // Task #126 v3-parity: room-scoped decks (slide presentations).
  // Content stored as JSON slide array so decks are editable and renderable.
  `CREATE TABLE IF NOT EXISTS chat_room_decks (
    id             TEXT PRIMARY KEY,
    room_id        TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    title          TEXT NOT NULL,
    slides_json    TEXT NOT NULL DEFAULT '[]',
    theme          TEXT,
    created_by     TEXT,
    created_at_ms  INTEGER NOT NULL,
    updated_at_ms  INTEGER,
    access_password TEXT,
    deleted_at_ms  INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_decks_room ON chat_room_decks (room_id, updated_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_room_decks_search ON chat_room_decks (room_id, title)`,
  // Task #159: deck access control — add password column to existing tables.
  `ALTER TABLE chat_room_decks ADD COLUMN access_password TEXT`,
  `ALTER TABLE chat_room_decks ADD COLUMN parent_deck_id TEXT`,
  // Task #130 v3-parity: persist asks to SQLite (was in-memory Maps).
  `CREATE TABLE IF NOT EXISTS asks (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL,
    opened_by_handle TEXT NOT NULL,
    opened_by_display_name TEXT,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('open','answered','dismissed','merged','deferred')) DEFAULT 'open',
    opened_at_ms    INTEGER NOT NULL,
    answer          TEXT,
    answered_by_handle TEXT,
    answered_by_display_name TEXT,
    answered_at_ms  INTEGER,
    dismissed_by_handle TEXT,
    dismissed_by_display_name TEXT,
    dismissed_at_ms INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_asks_room_status ON asks (room_id, status, opened_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_asks_id ON asks (id)`,
  // Asks-as-pill model JWPK 2026-05-22: target_handle is the human askee.
  // Adding nullable for back-compat with existing rows; new rows require it.
  `ALTER TABLE asks ADD COLUMN target_handle TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_asks_target_status ON asks (target_handle, status)`,
  // Task #162: candidate asks inferred from chat signals before premium
  // Chair filtering. These are distinct from explicit asks until promoted.
  `CREATE TABLE IF NOT EXISTS ask_candidates (
    id                    TEXT PRIMARY KEY,
    room_id               TEXT NOT NULL,
    source_message_id      TEXT NOT NULL,
    source_type            TEXT NOT NULL CHECK (source_type IN ('mention','emoji-message','reaction')),
    source_actor_handle    TEXT NOT NULL,
    source_emoji           TEXT NOT NULL DEFAULT '',
    title                 TEXT NOT NULL,
    body                  TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN ('candidate','promoted','dismissed')) DEFAULT 'candidate',
    created_at_ms          INTEGER NOT NULL,
    promoted_ask_id        TEXT,
    promoted_by_handle     TEXT,
    promoted_at_ms         INTEGER,
    dismissed_by_handle    TEXT,
    dismissed_at_ms        INTEGER,
    UNIQUE(source_message_id, source_type, source_actor_handle, source_emoji)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ask_candidates_status ON ask_candidates (status, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ask_candidates_room_status ON ask_candidates (room_id, status, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ask_candidates_source ON ask_candidates (source_message_id)`,
  // Phase A.5 v4 marquee: verification policies catalogue + append-only
  // audit trail. Policies are global (any handle can list public ones);
  // owner_handle is provenance, edit/delete is owner-gated at the API
  // layer. audit table never has UPDATE/DELETE — append-only.
  `CREATE TABLE IF NOT EXISTS verification_policies (
    id              TEXT PRIMARY KEY,
    slug            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    description     TEXT,
    owner_handle    TEXT NOT NULL,
    policy_json     TEXT NOT NULL,
    visibility      TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','unlisted','private')),
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER,
    deleted_at_ms   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_verification_policies_owner ON verification_policies (owner_handle, updated_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_policies_visibility ON verification_policies (visibility, updated_at_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS verification_policy_audit (
    id              TEXT PRIMARY KEY,
    policy_id       TEXT NOT NULL REFERENCES verification_policies(id) ON DELETE CASCADE,
    actor_handle    TEXT NOT NULL,
    actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('human','agent')),
    action          TEXT NOT NULL CHECK (action IN ('create','update','soft_delete','restore','clone_source','clone_target','visibility_change')),
    before_json     TEXT,
    after_json      TEXT,
    reason          TEXT,
    created_at_ms   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_verification_policy_audit_policy ON verification_policy_audit (policy_id, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_policy_audit_actor ON verification_policy_audit (actor_handle, created_at_ms DESC)`,
  // #74 delete-own-message + #76 edit-own-last-message: tombstones +
  // edit indicator on chat_messages. Both are nullable additive columns
  // — backfill not required. deleted_by_handle is captured so the UI
  // can render "Deleted by @x at <time>" tombstones authoritatively.
  `ALTER TABLE chat_messages ADD COLUMN deleted_at_ms INTEGER`,
  `ALTER TABLE chat_messages ADD COLUMN deleted_by_handle TEXT`,
  `ALTER TABLE chat_messages ADD COLUMN edited_at_ms INTEGER`,
  // plan_consent_gate_2026_05_20 T6: record the consuming human_consent_grant
  // on the message row for audit. Nullable — self-posts and agent-as-agent
  // writes leave it NULL; only an agent posting AS a human consumes a grant.
  // FK keeps the row pointing to the live grant audit trail.
  `ALTER TABLE chat_messages ADD COLUMN consumed_grant_id TEXT REFERENCES human_consent_grants(id)`,
  // plan_events SQLite projection (JWPK msg_71divtsj8r ratified ask_r0v3b4t...:
  // plan events should persist across launchd kickstart). Schema mirrors the
  // existing planModeStore.PlanEvent shape exactly — JSON columns for the
  // evidence + provenance refs since they have variable arity. `order_index`
  // because `order` is a SQL reserved word; column is renamed at the store
  // boundary so the in-process shape stays { order: number }.
  `CREATE TABLE IF NOT EXISTS plan_events (
    id              TEXT PRIMARY KEY,
    plan_id         TEXT NOT NULL,
    parent_id       TEXT,
    kind            TEXT NOT NULL CHECK (kind IN ('plan_section','plan_decision','plan_milestone','plan_acceptance','plan_test')),
    title           TEXT NOT NULL,
    body            TEXT,
    status          TEXT CHECK (status IN ('planned','active','blocked','passing','failing','done','archived')),
    owner           TEXT,
    milestone_id    TEXT,
    acceptance_id   TEXT,
    order_index     INTEGER NOT NULL,
    author_handle   TEXT NOT NULL,
    author_kind     TEXT NOT NULL CHECK (author_kind IN ('agent','human','system')),
    ts_millis       INTEGER NOT NULL,
    evidence_json   TEXT NOT NULL DEFAULT '[]',
    provenance_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_events_plan ON plan_events (plan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_events_plan_ts ON plan_events (plan_id, ts_millis DESC)`,
  // message_reactions SQLite projection (JWPK msg_71divtsj8r ratified
  // ask_r0v3b4t — reactions persist across kickstart; codex's lane was
  // blocked by sandbox so svelte picked it up).
  // Same canonical-5 emoji allowlist enforced at the store boundary;
  // (message_id, reactor_handle, emoji) triple is UNIQUE, first-react
  // wins (no overwrite of reacted_at on duplicate add).
  `CREATE TABLE IF NOT EXISTS message_reactions (
    message_id     TEXT NOT NULL,
    reactor_handle TEXT NOT NULL,
    emoji          TEXT NOT NULL,
    reacted_at     TEXT NOT NULL,
    PRIMARY KEY (message_id, reactor_handle, emoji)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions (message_id)`,
  // Drop the legacy chat_message_reactions table. Investigation 2026-05-24:
  // - 0 references in src/, scripts/, or anywhere in current code
  // - No DDL anywhere in this codebase that creates it (legacy v3-era artefact)
  // - Existing rows in the dev DB are 100% orphans (message_id values that
  //   don't exist in chat_messages — verified via LEFT JOIN)
  // - All live reactions go through message_reactions (the only table the
  //   codebase reads/writes)
  // Drop is idempotent via IF EXISTS; safe on fresh DBs that never had it.
  `DROP TABLE IF EXISTS chat_message_reactions`,
  // chat_invites + chat_invite_tokens SQLite projection (JWPK msg_71divtsj8r
  // ratified ask_r0v3b4t — invites must persist; was the launch-blocking
  // one because operator-minted invites disappeared on every kickstart).
  // Schema mirrors the chatInviteStore.StoredChatInvite + StoredChatToken
  // shapes; kinds + allowed_handles persisted as JSON text columns since
  // SQLite has no array type and the read pattern is full-record (no
  // value-level indexing needed).
  `CREATE TABLE IF NOT EXISTS chat_invites (
    id              TEXT PRIMARY KEY,
    room_id         TEXT NOT NULL,
    label           TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    kinds_json      TEXT NOT NULL,
    created_by      TEXT,
    created_at      TEXT NOT NULL,
    revoked_at      TEXT,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    last_failed_at  TEXT,
    hidden          INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    allowed_handles_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_invites_room_active ON chat_invites (room_id, revoked_at)`,
  `CREATE TABLE IF NOT EXISTS chat_invite_tokens (
    id            TEXT PRIMARY KEY,
    invite_id     TEXT NOT NULL,
    room_id       TEXT NOT NULL,
    token_hash    TEXT NOT NULL UNIQUE,
    kind          TEXT NOT NULL CHECK (kind IN ('cli','mcp','web')),
    handle        TEXT,
    created_at    TEXT NOT NULL,
    last_seen_at  TEXT,
    revoked_at    TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_invite_tokens_invite ON chat_invite_tokens (invite_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_invite_tokens_hash ON chat_invite_tokens (token_hash)`,
  // antchat_auth_tokens — O1 SQLite projection for the Mac antchat
  // app's bearer-token sessions. Previously in-memory only
  // (globalThis.__antchatTokenMap), so every launchd kickstart 401'd
  // every signed-in client and forced re-login (JWPK msg_n1oi9ps2hj
  // 'relogin pain'). Mirrors the plan_events / message_reactions /
  // chat_invite_tokens projection pattern: PK on the random token,
  // ms-epoch timestamps, expired rows lazy-pruned at resolve time.
  `CREATE TABLE IF NOT EXISTS antchat_auth_tokens (
    token          TEXT PRIMARY KEY,
    email          TEXT NOT NULL,
    issued_at_ms   INTEGER NOT NULL,
    expires_at_ms  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_antchat_auth_tokens_expires ON antchat_auth_tokens (expires_at_ms)`,
  // entity_claims — 5-way convergent spec from ask_hj2ubjbum8dmpce8dc1.
  // First-write-wins ledger backing the 🖐️ looking / 🤝 working / 👐 pass
  // primitive. UNIQUE constraint enforces one active claim per
  // (entity_kind, entity_id, claim_kind, claimed_by_handle) — so a single
  // agent has at most one active row per (target, action), but two
  // different agents can both be looking + many can pass independently.
  `CREATE TABLE IF NOT EXISTS entity_claims (
    id                TEXT PRIMARY KEY,
    entity_kind       TEXT NOT NULL CHECK (entity_kind IN ('message','task')),
    entity_id         TEXT NOT NULL,
    claim_kind        TEXT NOT NULL CHECK (claim_kind IN ('looking','working','pass')),
    claimed_by_handle TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('active','done','released','expired')),
    ttl_ms            INTEGER,
    expires_at_ms     INTEGER,
    claimed_at_ms     INTEGER NOT NULL,
    released_at_ms    INTEGER,
    override_reason   TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_claims_active_unique
    ON entity_claims (entity_kind, entity_id, claim_kind, claimed_by_handle)
    WHERE status = 'active'`,
  `CREATE INDEX IF NOT EXISTS idx_entity_claims_entity
    ON entity_claims (entity_kind, entity_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_claims_expiry
    ON entity_claims (status, expires_at_ms)`,
  // caller_grants — JWPK msg_hf8ziydn4r + msg_zmqhwh5tpx (2026-05-19):
  // explicit grant model for the @you / @evolveant* handle spoofing class.
  // pidChain that doesn't natively resolve still posts as claimed handle
  // IFF there's an active grant row for (pid, pid_start). Two kinds:
  //   - 'human' — JWPK runs `ant granthuman --pid X --for 15m`, time-bounded
  //   - 'agent' — JWPK runs `ant grantagent --pid X --handle @evolveantfoo`,
  //     no expiry; auto-revoked when PID exits (kill -0 sweeper)
  // pid_start prevents PID-rollover false-grants.
  `CREATE TABLE IF NOT EXISTS caller_grants (
    id                       TEXT PRIMARY KEY,
    kind                     TEXT NOT NULL CHECK (kind IN ('human','agent')),
    pid                      INTEGER NOT NULL,
    pid_start                TEXT NOT NULL,
    handle                   TEXT NOT NULL,
    granted_at_ms            INTEGER NOT NULL,
    expires_at_ms            INTEGER,
    granted_by_handle        TEXT NOT NULL,
    password_verified_at_ms  INTEGER,
    tmux_session_id          TEXT,
    status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_caller_grants_active_unique
    ON caller_grants (pid, pid_start, handle)
    WHERE status = 'active'`,
  `CREATE INDEX IF NOT EXISTS idx_caller_grants_pid
    ON caller_grants (pid, pid_start, status)`,
  `CREATE INDEX IF NOT EXISTS idx_caller_grants_expiry
    ON caller_grants (status, expires_at_ms)`,
  // Cron-jobs primitive (JWPK msg_hjv6ac64zo 2026-05-19): operator-defined
  // recurring jobs with named lifecycle (start/stop/pause/delete) that
  // emit `cron.fired` events into the plan-trigger dispatcher so the
  // existing actions (room.message / console.log / webhook.post /
  // task.create) can react to a time source. v1 schedule is interval-only
  // (`interval_ms`); cron expressions are a v2 widen lane via
  // schedule_kind='cron'. Status gates the ticker — only 'running' rows
  // fire; 'paused' / 'stopped' preserve configuration; 'deleted' is
  // soft-delete (manual prune later per SURFACE-SIZE-ONLY pattern).
  `CREATE TABLE IF NOT EXISTS cron_jobs (
    id                        TEXT PRIMARY KEY,
    name                      TEXT NOT NULL,
    status                    TEXT NOT NULL DEFAULT 'paused'
                                CHECK (status IN ('running', 'paused', 'stopped', 'deleted')),
    schedule_kind             TEXT NOT NULL DEFAULT 'interval'
                                CHECK (schedule_kind IN ('interval', 'cron')),
    interval_ms               INTEGER,
    cron_expr                 TEXT,
    target_room_id            TEXT,
    target_message_template   TEXT,
    action                    TEXT NOT NULL DEFAULT 'room.message'
                                CHECK (action IN ('room.message', 'console.log', 'webhook.post', 'task.create')),
    action_config             TEXT NOT NULL DEFAULT '{}',
    created_by_handle         TEXT,
    created_at_ms             INTEGER NOT NULL,
    updated_at_ms             INTEGER NOT NULL,
    last_fired_at_ms          INTEGER,
    next_fire_at_ms           INTEGER,
    fire_count                INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cron_jobs_status_next
    ON cron_jobs (status, next_fire_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_cron_jobs_created_by
    ON cron_jobs (created_by_handle, status)`,

  // ─── Consent-gated impersonation (plan_consent_gate_2026_05_20) ───
  // owners: stable identity for every kind="human" member. The handle
  // string can be renamed (owner_handles tracks aliases); owner_id is
  // the load-bearing identity that consent grants reference. password_hash
  // is bcrypt (cost 12). totp_secret_encrypted is the base32 TOTP secret
  // wrapped by ANT_OWNER_SECRET_KEY (env), null until enrollment. The
  // totp_last_counter prevents replay of the same 30-second code window.
  `CREATE TABLE IF NOT EXISTS owners (
    id                         TEXT PRIMARY KEY,
    primary_handle             TEXT NOT NULL UNIQUE,
    password_hash              TEXT NOT NULL,
    totp_secret_encrypted      TEXT,
    totp_enrolled_at_ms        INTEGER,
    totp_last_counter          INTEGER,
    created_at_ms              INTEGER NOT NULL,
    updated_at_ms              INTEGER NOT NULL
  )`,

  // owner_handles: rename history + alias support. One owner can hold
  // multiple handles over time; is_primary=1 mirrors owners.primary_handle.
  // Every chat write that resolves to a kind="human" handle goes through
  // (handle) → owner_id via this table.
  `CREATE TABLE IF NOT EXISTS owner_handles (
    owner_id        TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    handle          TEXT NOT NULL UNIQUE,
    is_primary      INTEGER NOT NULL DEFAULT 0,
    assigned_at_ms  INTEGER NOT NULL,
    PRIMARY KEY (owner_id, handle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_owner_handles_lookup
    ON owner_handles (handle)`,

  // agent_handles: which human owner a given agent handle belongs to.
  // Read authorization expands user/agent principals through this table so
  // a user's own agents share room scope without leaking across users.
  `CREATE TABLE IF NOT EXISTS agent_handles (
    owner_id        TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    handle          TEXT NOT NULL UNIQUE,
    assigned_at_ms  INTEGER NOT NULL,
    PRIMARY KEY (owner_id, handle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_handles_owner
    ON agent_handles (owner_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_handles_lookup
    ON agent_handles (handle)`,

  // owner_recovery_codes: 10 one-time backup codes printed at TOTP
  // enrollment. Stored as bcrypt hashes — never the plaintext. used_at_ms
  // null = still valid; set on consumption. PRIMARY KEY (owner_id, code_hash)
  // because the same hash collision across owners is fine.
  `CREATE TABLE IF NOT EXISTS owner_recovery_codes (
    owner_id     TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    code_hash    TEXT NOT NULL,
    issued_at_ms INTEGER NOT NULL,
    used_at_ms   INTEGER,
    PRIMARY KEY (owner_id, code_hash)
  )`,

  // human_consent_grants: distinct from the existing consent_grants
  // (which is topic-scoped Lane A work). Each row authorises a SPECIFIC
  // terminal to post as a SPECIFIC human owner for a bounded window /
  // use-count. Created only from the owner's own terminal + password +
  // current TOTP code. Status lifecycle: active → consumed (uses--) →
  // active OR exhausted; or active → expired (TTL) OR revoked.
  `CREATE TABLE IF NOT EXISTS human_consent_grants (
    id                       TEXT PRIMARY KEY,
    owner_id                 TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
    granted_to_terminal_id   TEXT NOT NULL,
    granted_to_handle        TEXT NOT NULL,
    max_uses                 INTEGER,
    uses_consumed            INTEGER NOT NULL DEFAULT 0,
    status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','revoked','expired','exhausted')),
    granted_at_ms            INTEGER NOT NULL,
    expires_at_ms            INTEGER,
    created_by_terminal_id   TEXT NOT NULL,
    revoked_at_ms            INTEGER,
    revoked_by_handle        TEXT,
    updated_at_ms            INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_human_consent_grants_lookup
    ON human_consent_grants (owner_id, granted_to_terminal_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_human_consent_grants_expiry
    ON human_consent_grants (status, expires_at_ms)`,

  // human_consent_grant_audit: append-only audit row per consumption,
  // revocation, expiry, exhaustion event. Every chat message posted
  // under a grant writes a 'consumed' row referencing message_id.
  `CREATE TABLE IF NOT EXISTS human_consent_grant_audit (
    id            TEXT PRIMARY KEY,
    grant_id      TEXT NOT NULL REFERENCES human_consent_grants(id) ON DELETE CASCADE,
    action        TEXT NOT NULL CHECK (action IN ('created','consumed','revoked','expired','exhausted')),
    actor_handle  TEXT,
    actor_terminal_id TEXT,
    message_id    TEXT,
    occurred_at_ms INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_human_consent_grant_audit_grant
    ON human_consent_grant_audit (grant_id, occurred_at_ms)`
  ,
  `ALTER TABLE owners ADD COLUMN external_account_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_owners_external_account_id ON owners (external_account_id) WHERE external_account_id IS NOT NULL`
  ,
  // transcriptToChatFanout (2026-05-21): dedupe table for transcript-derived
  // chat-room posts. One row per (terminal_id, transcript_event_id) means
  // re-ingesting the same JSONL line on restart will NOT double-post into
  // the linked chat room. Survives restart unlike an in-memory Set.
  `CREATE TABLE IF NOT EXISTS transcript_chat_idempotency (
    terminal_id         TEXT NOT NULL,
    transcript_event_id TEXT NOT NULL,
    chat_message_id     TEXT NOT NULL,
    room_id             TEXT NOT NULL,
    posted_at_ms        INTEGER NOT NULL,
    PRIMARY KEY (terminal_id, transcript_event_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transcript_chat_idempotency_room ON transcript_chat_idempotency (room_id, posted_at_ms)`,
  // PID-as-identity model 2026-05-21 (JWPK msg_n2cyrel4u5):
  // Identity = PID; aliases are pure display, stack unlimited per (room×handle),
  // unique-per-room so routing stays deterministic. Replaces the in-mem Map that
  // evaporated on every kickstart.
  `CREATE TABLE IF NOT EXISTS chat_room_aliases (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id       TEXT NOT NULL,
    global_handle TEXT NOT NULL,
    alias         TEXT NOT NULL,
    set_by        TEXT,
    set_at_ms     INTEGER NOT NULL,
    UNIQUE(room_id, alias)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_aliases_room_handle ON chat_room_aliases (room_id, global_handle)`,
  `CREATE INDEX IF NOT EXISTS idx_aliases_room_set_at ON chat_room_aliases (room_id, set_at_ms DESC)`,
  // VERIFICATION-LENS (originally VALIDATION-LENS 2026-05-23, renamed
  // 2026-05-28 per Slice 5 A7 ratification): per-user verification
  // lenses + observations. A lens is a named verification schema (POC,
  // FCA, investment-memo, etc). Originally `validation_schemas`/
  // `validation_runs`; renamed to `verification_lenses`/
  // `verification_observations` to align with the V2 substrate vocabulary.
  // The rename migration runs in renameLegacyValidationTables() before
  // these DDL statements execute.
  //
  // New columns added 2026-05-28:
  //   - minimum_pass_record_age_ms (temporal rule: don't accept a pass
  //     verdict until the source record is older than N ms — guards
  //     against just-published-then-edited claims)
  //   - re_verification_on_content_change (1 = trigger re-run when
  //     anchor content_hash drifts)
  //   - out_of_scope_tags_json (tags that, when applied to a fragment,
  //     exclude the fragment from this lens entirely)
  `CREATE TABLE IF NOT EXISTS verification_lenses (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    lens_kind       TEXT NOT NULL CHECK (lens_kind IN ('poc','fca','investment_memo','scientific_claim','marketing_copy','custom')),
    scope           TEXT NOT NULL DEFAULT 'public' CHECK (scope IN ('org','user','public')),
    scope_id        TEXT NOT NULL DEFAULT 'global',
    rules_json      TEXT NOT NULL DEFAULT '[]',
    created_by      TEXT,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL,
    archived_at_ms  INTEGER
  )`,
  `ALTER TABLE verification_lenses ADD COLUMN scope TEXT NOT NULL DEFAULT 'public' CHECK (scope IN ('org','user','public'))`,
  `ALTER TABLE verification_lenses ADD COLUMN scope_id TEXT NOT NULL DEFAULT 'global'`,
  `ALTER TABLE verification_lenses ADD COLUMN minimum_pass_record_age_ms INTEGER`,
  `ALTER TABLE verification_lenses ADD COLUMN re_verification_on_content_change INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE verification_lenses ADD COLUMN out_of_scope_tags_json TEXT NOT NULL DEFAULT '[]'`,
  `CREATE INDEX IF NOT EXISTS idx_verification_lenses_kind ON verification_lenses (lens_kind)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_lenses_scope ON verification_lenses (scope, scope_id, lens_kind)`,
  `CREATE TABLE IF NOT EXISTS verification_lens_audit (
    id              TEXT PRIMARY KEY,
    lens_id         TEXT NOT NULL REFERENCES verification_lenses(id) ON DELETE CASCADE,
    actor_handle    TEXT NOT NULL,
    actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('human','agent')),
    action          TEXT NOT NULL CHECK (action IN ('create','update','archive')),
    before_json     TEXT,
    after_json      TEXT,
    reason          TEXT,
    created_at_ms   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_verification_lens_audit_lens ON verification_lens_audit (lens_id, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_lens_audit_actor ON verification_lens_audit (actor_handle, created_at_ms DESC)`,
  // verification_observations (Slice 6 / Phase A8 2026-05-28): append-only
  // event log. Each row is an immutable observation; corrections happen
  // by writing a NEW row that links to the prior via
  // parent_observation_id. The effective verdict per (lens_id,
  // claim_anchor) is computed by walking the chain newest-first.
  //
  // Status enum extended per ratified spec to include 'dispute',
  // 'insufficient_evidence', 'retag_required' verdicts. Existing values
  // ('pending', 'running', 'passed', 'failed', 'waived') preserved for
  // backward compat with rows written by the pre-refactor UPDATE path
  // (validationLensStore.completeValidationRun); new code SHOULD use the
  // append-only verdict path (verificationVerdictsStore).
  //
  // The fresh-DB CREATE TABLE includes the new columns. Pre-existing
  // databases get the columns + extended status enum via
  // rebuildVerificationObservationsForAppendOnly (in applySchemaMigrations).
  `CREATE TABLE IF NOT EXISTS verification_observations (
    id                     TEXT PRIMARY KEY,
    lens_id                TEXT NOT NULL REFERENCES verification_lenses(id) ON DELETE CASCADE,
    claim_anchor           TEXT NOT NULL,
    claim_text             TEXT NOT NULL,
    status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','passed','failed','waived','dispute','insufficient_evidence','retag_required')),
    score                  INTEGER,
    result_json            TEXT,
    started_at_ms          INTEGER NOT NULL,
    completed_at_ms        INTEGER,
    run_by                 TEXT,
    parent_observation_id  TEXT REFERENCES verification_observations(id) ON DELETE SET NULL,
    verifier_handle        TEXT,
    verifier_kind          TEXT CHECK (verifier_kind IN ('human','agent','system','automated')),
    dispute_reason         TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_verification_observations_lens ON verification_observations (lens_id, claim_anchor)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_observations_claim ON verification_observations (claim_anchor, completed_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_observations_parent ON verification_observations (parent_observation_id) WHERE parent_observation_id IS NOT NULL`,
  // V2-LENS-TAG-ROWS (2026-05-28, Slice 5 / Phase A7): replaces the
  // rules_json blob with first-class per-tag rows. Each row binds a
  // (lens, tag, expectation) tuple: the lens passes when this tag is
  // applied (expectation='required') OR fails when this tag is applied
  // (expectation='forbidden') OR a verifier mix must converge
  // (expectation='consensus-required'). dispute_policy defines how
  // disagreement between applications resolves.
  `CREATE TABLE IF NOT EXISTS lens_tag_rows (
    id                  TEXT PRIMARY KEY,
    lens_id             TEXT NOT NULL REFERENCES verification_lenses(id) ON DELETE CASCADE,
    tag_id              TEXT NOT NULL,
    tag_version         INTEGER,
    expectation         TEXT NOT NULL CHECK (expectation IN ('required','forbidden','consensus-required','heuristic-allowed','out-of-scope')),
    min_verifier_count  INTEGER NOT NULL DEFAULT 1,
    verifier_mix_json   TEXT NOT NULL DEFAULT '[]',
    dispute_policy      TEXT NOT NULL DEFAULT 'majority' CHECK (dispute_policy IN ('majority','unanimous','any-pass','any-fail','escalate')),
    weight              REAL NOT NULL DEFAULT 1.0,
    notes               TEXT,
    created_by          TEXT NOT NULL,
    created_at_ms       INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lens_tag_rows_lens ON lens_tag_rows (lens_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lens_tag_rows_tag ON lens_tag_rows (tag_id)`,
  // V2-SKILL-INVOCATIONS (2026-05-28, Slice 11 / Phase B3 audit substrate):
  // Append-only log of every skill invocation. Records caller identity,
  // input requirements (raw + hash for dedup), full output JSON, and
  // either the output lens id (on success) or error_kind (on refusal).
  // model_used + cost_estimate_usd populated when the LLM call wiring
  // lands (B3 LLM piece still needs JWPK model+cost ratify).
  //
  // Raw input_json + output_json are admin-bearer-only via the audit
  // endpoint (B3 follow-up); requirements_hash lets the audit UI dedup
  // identical-input calls without exposing the raw text.
  `CREATE TABLE IF NOT EXISTS skill_invocations (
    id                       TEXT PRIMARY KEY,
    skill_id                 TEXT NOT NULL,
    invoker_handle           TEXT NOT NULL,
    invoker_kind             TEXT NOT NULL CHECK (invoker_kind IN ('human','agent','system')),
    scope_id                 TEXT NOT NULL,
    input_requirements_hash  TEXT NOT NULL,
    input_json               TEXT NOT NULL,
    output_json              TEXT NOT NULL,
    output_lens_id           TEXT REFERENCES verification_lenses(id) ON DELETE SET NULL,
    error_kind               TEXT,
    model_used               TEXT,
    cost_estimate_usd        REAL,
    invoked_at_ms            INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skill_invocations_scope ON skill_invocations (scope_id, invoked_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_skill_invocations_invoker ON skill_invocations (invoker_handle, invoked_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_skill_invocations_output_lens ON skill_invocations (output_lens_id) WHERE output_lens_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_skill_invocations_skill ON skill_invocations (skill_id, invoked_at_ms DESC)`,
  // VERIFICATION-V2 (2026-05-28): taxonomy-first verification per JWPK
  // 17-question ratification at eiw05zdurz. Tag definitions are versioned
  // governance objects (NOT prompt fragments); lifecycle is create →
  // active → deprecated → superseded → withdrawn (never hard-delete —
  // would invalidate historical verifications). System defaults under
  // `ant.*` namespace; org extensions under `org.<orgId>.*`. Relational
  // tag families (e.g. `source.supports-claim.<claimID>`) carry
  // is_relational=1 + family_root pointing at the root id.
  // See deck d5024535-a495-45ea-9e4f-ba11bb197ab8 slide 10 for substrate
  // plan; this is Slice 1.
  `CREATE TABLE IF NOT EXISTS verification_taxonomy (
    id                      TEXT NOT NULL,
    version                 INTEGER NOT NULL,
    name                    TEXT NOT NULL,
    description             TEXT NOT NULL,
    category                TEXT NOT NULL,
    provenance              TEXT NOT NULL CHECK (provenance IN ('system','org','user')),
    scope_id                TEXT NOT NULL DEFAULT 'global',
    protocol_resolver_json  TEXT NOT NULL DEFAULT '{}',
    lifecycle_state         TEXT NOT NULL CHECK (lifecycle_state IN ('proposed','active','deprecated','superseded','withdrawn')),
    superseded_by_id        TEXT,
    is_human_editable       INTEGER NOT NULL DEFAULT 1,
    is_relational           INTEGER NOT NULL DEFAULT 0,
    family_root             TEXT,
    created_by              TEXT NOT NULL,
    created_at_ms           INTEGER NOT NULL,
    PRIMARY KEY (id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_verification_taxonomy_category ON verification_taxonomy (category, lifecycle_state)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_taxonomy_provenance ON verification_taxonomy (provenance, scope_id, lifecycle_state)`,
  `CREATE INDEX IF NOT EXISTS idx_verification_taxonomy_family ON verification_taxonomy (family_root) WHERE family_root IS NOT NULL`,
  // Audit log for tag-definition lifecycle events AND per-tag-application
  // human edits (classification_override, flag_ignorable). audit-of-flagger
  // is VITAL per JWPK msg requesting human-edit governance — every event
  // captures actor_handle + actor_kind + reason. Append-only; never amend.
  `CREATE TABLE IF NOT EXISTS tag_lifecycle_events (
    id                  TEXT PRIMARY KEY,
    tag_id              TEXT NOT NULL,
    tag_version         INTEGER,
    event_kind          TEXT NOT NULL CHECK (event_kind IN ('create','edit','deprecate','restore','supersede','classification_override','flag_ignorable')),
    actor_handle        TEXT NOT NULL,
    actor_kind          TEXT NOT NULL CHECK (actor_kind IN ('human','agent','system')),
    reason              TEXT,
    before_json         TEXT,
    after_json          TEXT,
    references_event_id TEXT,
    created_at_ms       INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tag_lifecycle_events_tag ON tag_lifecycle_events (tag_id, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tag_lifecycle_events_actor ON tag_lifecycle_events (actor_handle, created_at_ms DESC)`,
  // V2-SOURCE-SETS (2026-05-28, Slice 2 / homebrew's Phase A6): per-org
  // governed source-set registries that back the source.reputable
  // verification protocol. No ANT-shipped defaults — orgs build their
  // own via the lens-creation skill (Slice 4) when they need regulatory-
  // grounded sets. JWPK ratification at the apps coordination thread;
  // deck d5024535-a495-45ea-9e4f-ba11bb197ab8 slide 5.
  //
  // source_sets defines the registry; source_set_members carries the
  // actual sources (add/remove audited via the removed_* columns plus
  // source_set_audit for governance events).
  `CREATE TABLE IF NOT EXISTS source_sets (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    description         TEXT,
    owner_org           TEXT NOT NULL,
    scope_kind          TEXT NOT NULL CHECK (scope_kind IN ('org-wide','lens-specific')),
    bound_lens_id       TEXT,
    approvers_json      TEXT NOT NULL DEFAULT '[]',
    review_cadence_ms   INTEGER,
    lifecycle_state     TEXT NOT NULL CHECK (lifecycle_state IN ('proposed','active','deprecated','withdrawn')),
    created_by          TEXT NOT NULL,
    created_at_ms       INTEGER NOT NULL,
    updated_at_ms       INTEGER NOT NULL,
    last_reviewed_at_ms INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_sets_owner ON source_sets (owner_org, lifecycle_state)`,
  `CREATE INDEX IF NOT EXISTS idx_source_sets_bound_lens ON source_sets (bound_lens_id) WHERE bound_lens_id IS NOT NULL`,
  // Members of each source set. member_kind discriminates between the
  // seven source types from deck slide 5. Add/remove are audited via the
  // removed_* columns; current membership is rows where removed_at_ms IS NULL.
  `CREATE TABLE IF NOT EXISTS source_set_members (
    id                TEXT PRIMARY KEY,
    set_id            TEXT NOT NULL REFERENCES source_sets(id) ON DELETE CASCADE,
    member_kind       TEXT NOT NULL CHECK (member_kind IN ('domain','url','repo','file_collection','named_person','database','named_document_set')),
    member_value      TEXT NOT NULL,
    label             TEXT,
    added_by          TEXT NOT NULL,
    added_reason      TEXT,
    added_at_ms       INTEGER NOT NULL,
    removed_by        TEXT,
    removed_reason    TEXT,
    removed_at_ms     INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_set_members_set ON source_set_members (set_id, removed_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_source_set_members_lookup ON source_set_members (member_kind, member_value, removed_at_ms)`,
  // Append-only audit log for source-set governance — approver changes,
  // lifecycle transitions, review checkpoints, member add/remove. Mirrors
  // tag_lifecycle_events shape so the same audit UX renders both.
  `CREATE TABLE IF NOT EXISTS source_set_audit (
    id              TEXT PRIMARY KEY,
    set_id          TEXT NOT NULL REFERENCES source_sets(id) ON DELETE CASCADE,
    event_kind      TEXT NOT NULL CHECK (event_kind IN ('create','rename','add_approver','remove_approver','deprecate','restore','review_checkpoint','add_member','remove_member')),
    actor_handle    TEXT NOT NULL,
    actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('human','agent','system')),
    reason          TEXT,
    before_json     TEXT,
    after_json      TEXT,
    created_at_ms   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_source_set_audit_set ON source_set_audit (set_id, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_source_set_audit_actor ON source_set_audit (actor_handle, created_at_ms DESC)`,
  // V2-TAGGING-ANCHORS (2026-05-28, Slice 3 / Phase A3): content-type-
  // agnostic anchor primitive. Tag applications bind to anchors (not
  // raw byte offsets) so the substrate doesn't need to know how each
  // content type addresses its fragments. Adapters (univer-block,
  // markdown-offset, pdf-region, image-region, audio-timestamp) live
  // outside the substrate; the table just stores opaque anchor_data_json.
  //
  // content_hash is what makes verification replayable on content change.
  // If the underlying artefact's hash diverges from the anchor's hash,
  // any lens with re_verification_on_content_change=true triggers a
  // re-run of the affected applications.
  `CREATE TABLE IF NOT EXISTS tagging_anchors (
    id                TEXT PRIMARY KEY,
    content_kind      TEXT NOT NULL CHECK (content_kind IN ('univer-block','markdown-offset','pdf-region','image-region','audio-timestamp','message-range','file-checksum')),
    content_id        TEXT NOT NULL,
    content_hash      TEXT NOT NULL,
    anchor_data_json  TEXT NOT NULL,
    created_by        TEXT NOT NULL,
    created_at_ms     INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tagging_anchors_content ON tagging_anchors (content_id, content_kind)`,
  `CREATE INDEX IF NOT EXISTS idx_tagging_anchors_hash ON tagging_anchors (content_hash)`,
  // V2-TAG-APPLICATIONS (2026-05-28, Slice 3 / Phase A4): immutable
  // record of "tag X was applied to anchor Y by Z at time T". One row
  // per (tag, anchor, applicator); re-applying the same tag is allowed
  // but creates a new application row (multiple agents can co-tag a
  // fragment with the same tag — the dispute policy resolves
  // disagreement).
  //
  // tag_version captures WHICH version of the tag was applied, so
  // historical applications resolve against their original definition
  // even after the tag is edited. This is the load-bearing reason
  // verificationTaxonomyStore retains old versions instead of mutating.
  //
  // For relational tags (e.g. source.supports-claim.<claimId>),
  // target_claim_id carries the claim being supported/refuted. tag_id
  // stores the parameterised form (source.supports-claim.claim-123)
  // while family_root in the taxonomy stores just 'source.supports-
  // claim' — readers reconstruct the relationship from both.
  //
  // tagging_run_id groups applications written in a single `ant tags
  // apply` invocation so the UI can render "Agent X ran tagging at T
  // and produced N applications" without scanning ms timestamps.
  `CREATE TABLE IF NOT EXISTS tag_applications (
    id                TEXT PRIMARY KEY,
    tag_id            TEXT NOT NULL,
    tag_version       INTEGER NOT NULL,
    target_anchor_id  TEXT NOT NULL REFERENCES tagging_anchors(id) ON DELETE RESTRICT,
    target_claim_id   TEXT,
    applicator_handle TEXT NOT NULL,
    applicator_kind   TEXT NOT NULL CHECK (applicator_kind IN ('human','agent','system')),
    applied_reason    TEXT,
    tagging_run_id    TEXT NOT NULL,
    applied_at_ms     INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tag_applications_anchor ON tag_applications (target_anchor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tag_applications_tag ON tag_applications (tag_id, applied_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tag_applications_run ON tag_applications (tagging_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tag_applications_claim ON tag_applications (target_claim_id) WHERE target_claim_id IS NOT NULL`,
  // tagging_runs is the grouping primitive: every `ant tags apply`
  // invocation creates one row, then writes N tag_applications that
  // share tagging_run_id. The UI lists runs (latest-first) and drills
  // into the applications produced by each.
  `CREATE TABLE IF NOT EXISTS tagging_runs (
    id              TEXT PRIMARY KEY,
    scope_id        TEXT NOT NULL,
    scope_kind      TEXT NOT NULL CHECK (scope_kind IN ('artefact','message','file','document','room')),
    initiator_handle TEXT NOT NULL,
    initiator_kind  TEXT NOT NULL CHECK (initiator_kind IN ('human','agent','system')),
    run_reason      TEXT,
    started_at_ms   INTEGER NOT NULL,
    completed_at_ms INTEGER,
    application_count INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tagging_runs_scope ON tagging_runs (scope_id, started_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tagging_runs_initiator ON tagging_runs (initiator_handle, started_at_ms DESC)`,
  // V2-TAG-APPLICATION-OVERRIDES (2026-05-28, Slice 4 / Phase A5):
  // per-application overrides for classification class or flag-as-
  // ignorable. Append-only — each override is a new row, never a
  // mutation. Effective state is computed by walking the override
  // chain newest-first.
  //
  // Three override_kind values:
  //   - 'classification' — change the protocol class for this specific
  //     application (e.g. demote 'consensus-required' to 'heuristic'
  //     when context warrants). new_protocol_class is required.
  //   - 'flag_ignorable' — mark this application as ignorable (e.g.
  //     "this is a joke claim, not a real one"). The verification
  //     readers skip ignorable applications.
  //   - 'withdraw' — withdraw a previous override on the same
  //     application, reverting to whatever the prior override was
  //     (or original if none).
  //
  // reason is REQUIRED per JWPK ratification — audit-of-flagger is
  // VITAL. There is no soft-delete; mistakes are corrected by adding
  // a withdraw override (which is itself audited).
  `CREATE TABLE IF NOT EXISTS tag_application_overrides (
    id                    TEXT PRIMARY KEY,
    tag_application_id    TEXT NOT NULL REFERENCES tag_applications(id) ON DELETE RESTRICT,
    override_kind         TEXT NOT NULL CHECK (override_kind IN ('classification','flag_ignorable','withdraw')),
    new_protocol_class    TEXT,
    handler_handle        TEXT NOT NULL,
    handler_kind          TEXT NOT NULL CHECK (handler_kind IN ('human','agent','system')),
    reason                TEXT NOT NULL,
    created_at_ms         INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tag_app_overrides_app ON tag_application_overrides (tag_application_id, created_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_tag_app_overrides_handler ON tag_application_overrides (handler_handle, created_at_ms DESC)`,

  // ORGS (2026-05-28): F1 license-time namespace provisioning substrate.
  // Buying a license on antonline.dev registers the org's namespace
  // (org.<orgId>.*) so org-scoped tags / source-sets / lenses can be
  // created. The license-holder becomes the initial org-admin.
  //
  // Append-only semantics — orgs are archived (archived_at_ms set), not
  // hard-deleted, so historical verifications + tag applications keep
  // resolving against their owning namespace. Tier is mutable so a
  // license upgrade flips oss → premium → enterprise without losing the
  // namespace registration.
  `CREATE TABLE IF NOT EXISTS orgs (
    id                TEXT PRIMARY KEY,
    display_name      TEXT NOT NULL,
    namespace_prefix  TEXT NOT NULL UNIQUE,
    tier              TEXT NOT NULL CHECK (tier IN ('oss','premium','enterprise')) DEFAULT 'oss',
    created_by        TEXT NOT NULL,
    created_at_ms     INTEGER NOT NULL,
    archived_at_ms    INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_namespace ON orgs (namespace_prefix)`,
  `CREATE INDEX IF NOT EXISTS idx_orgs_tier ON orgs (tier, created_at_ms DESC)`,

  // ORG_ADMINS (2026-05-28): org-admin role assignments. Soft-delete via
  // revoked_at_ms so the audit trail of who-held-admin-when survives.
  // The partial UNIQUE index keeps (org_id, handle) unique among ACTIVE
  // rows while permitting re-grant after revocation.
  `CREATE TABLE IF NOT EXISTS org_admins (
    id                TEXT PRIMARY KEY,
    org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    handle            TEXT NOT NULL,
    assigned_by       TEXT NOT NULL,
    assigned_at_ms    INTEGER NOT NULL,
    revoked_at_ms     INTEGER,
    revoked_by        TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_org_admins_active ON org_admins (org_id, handle) WHERE revoked_at_ms IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_org_admins_handle ON org_admins (handle, revoked_at_ms)`,

  // DESIGN-STYLES (2026-05-23): banked styles for decks, UI surfaces, and org branding.
  // Styles are scoped to org or user, shareable, and referenced by id.
  `CREATE TABLE IF NOT EXISTS design_styles (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('palette','font','asset','spacing','shadow','border')),
    scope           TEXT NOT NULL CHECK (scope IN ('org','user','public')),
    scope_id        TEXT NOT NULL,
    data_json       TEXT NOT NULL DEFAULT '{}',
    tags_json       TEXT NOT NULL DEFAULT '[]',
    is_default      INTEGER NOT NULL DEFAULT 0,
    created_by      TEXT,
    created_at_ms   INTEGER NOT NULL,
    updated_at_ms   INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_design_styles_scope ON design_styles (scope, scope_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_design_styles_kind ON design_styles (kind, created_at_ms DESC)`,
  // AWAY-MODE (2026-05-23): user presence tiers + agent-intensity dial.
  // Tier maps to expected duration; intensity controls token-burn aggressiveness.
  `CREATE TABLE IF NOT EXISTS away_modes (
    handle          TEXT PRIMARY KEY,
    tier            TEXT NOT NULL CHECK (tier IN ('active','away-desk','away-office','away-phone')),
    intensity       INTEGER NOT NULL DEFAULT 50 CHECK (intensity >= 0 AND intensity <= 100),
    note            TEXT,
    expected_back_ms INTEGER,
    set_by          TEXT,
    set_at_ms       INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_away_modes_tier ON away_modes (tier, set_at_ms DESC)`,

  // Manual canvas v2 (JWPK msg_i538jl6ztt 2026-05-23): interactive
  // screens canvas with per-element annotations + per-state variants +
  // central suggestion-capture feed. The "manual_" prefix is to
  // distinguish from the per-route /api/discover manifest data (manifest
  // is generated; manual is hand-authored + audit-tracked).
  `CREATE TABLE IF NOT EXISTS manual_screen_states (
    screen_id        TEXT NOT NULL,
    state_slug       TEXT NOT NULL,
    state_label      TEXT NOT NULL,
    description      TEXT,
    screenshot_path  TEXT NOT NULL,
    viewport_w       INTEGER NOT NULL,
    viewport_h       INTEGER NOT NULL,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    created_at_ms    INTEGER NOT NULL,
    updated_at_ms    INTEGER NOT NULL,
    PRIMARY KEY (screen_id, state_slug)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_manual_screen_states_screen ON manual_screen_states (screen_id, sort_order)`,

  // Per-element annotation: bounding box on the screenshot + structured
  // metadata fields matching JWPK's sketch (Item / CLI / Data sources /
  // Logic / Intended Actions). JSON columns for the list-shaped fields
  // keep the schema flat without an extra child table.
  `CREATE TABLE IF NOT EXISTS manual_element_annotations (
    screen_id           TEXT NOT NULL,
    state_slug          TEXT NOT NULL,
    element_slug        TEXT NOT NULL,
    item_name           TEXT NOT NULL,
    bbox_x              INTEGER NOT NULL,
    bbox_y              INTEGER NOT NULL,
    bbox_w              INTEGER NOT NULL,
    bbox_h              INTEGER NOT NULL,
    cli_verbs_json      TEXT NOT NULL DEFAULT '[]',
    data_sources_json   TEXT NOT NULL DEFAULT '[]',
    logic_text          TEXT,
    intended_actions_json TEXT NOT NULL DEFAULT '[]',
    tab_order           INTEGER NOT NULL DEFAULT 0,
    created_at_ms       INTEGER NOT NULL,
    updated_at_ms       INTEGER NOT NULL,
    PRIMARY KEY (screen_id, state_slug, element_slug),
    FOREIGN KEY (screen_id, state_slug) REFERENCES manual_screen_states (screen_id, state_slug) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_manual_element_annotations_state ON manual_element_annotations (screen_id, state_slug, tab_order)`,

  // Manual canvas v2 slice 6 (JWPK 2026-05-24 audit purpose): append-only
  // history of every annotation edit. Closes the third of JWPK's three
  // original purposes (learning/notes-capture/audit). Inserted by the
  // PATCH /annotations endpoint after each successful upsert. Old/new
  // values stored as JSON snapshots so the audit view can diff fields
  // without joining back to the canonical row.
  `CREATE TABLE IF NOT EXISTS manual_element_annotations_audit (
    id                  TEXT PRIMARY KEY,
    screen_id           TEXT NOT NULL,
    state_slug          TEXT NOT NULL,
    element_slug        TEXT NOT NULL,
    edited_by_handle    TEXT NOT NULL,
    edited_at_ms        INTEGER NOT NULL,
    action              TEXT NOT NULL CHECK (action IN ('create','update','delete')),
    before_json         TEXT,
    after_json          TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_manual_element_annotations_audit_element
     ON manual_element_annotations_audit (screen_id, state_slug, element_slug, edited_at_ms DESC)`,

  // Central suggestions feed — Add-button writes here. screen_id /
  // state_slug / element_slug all nullable so a user can capture at any
  // scope (screen-level, state-level, element-level). Workspace-public
  // read per JWPK 2026-05-23.
  `CREATE TABLE IF NOT EXISTS manual_screen_suggestions (
    id                  TEXT PRIMARY KEY,
    screen_id           TEXT,
    state_slug          TEXT,
    element_slug        TEXT,
    body                TEXT NOT NULL,
    captured_by_handle  TEXT NOT NULL,
    captured_at_ms      INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','addressed','dismissed')),
    addressed_at_ms     INTEGER,
    addressed_by_handle TEXT,
    addressed_note      TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_manual_screen_suggestions_feed ON manual_screen_suggestions (status, captured_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_manual_screen_suggestions_screen ON manual_screen_suggestions (screen_id, state_slug, element_slug)`,
  // Premium Bring-in-App audit trail (JWPK msg_a0s51ioct6 2026-05-25 — Q2:
  // Yes proceed). Records every context payload mint per (operator, room,
  // target external app) so the launch history surface + future consent
  // revoke can read it. Append-only; no soft-delete (revoke happens at the
  // consent layer, not the audit layer).
  `CREATE TABLE IF NOT EXISTS bring_in_app_launches (
    id                 TEXT PRIMARY KEY,
    room_id            TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
    target             TEXT NOT NULL CHECK (target IN ('claude-desktop','claude-mobile','chatgpt','codex-desktop','gemini')),
    operator_handle    TEXT NOT NULL,
    launched_at_ms     INTEGER NOT NULL,
    payload_byte_size  INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bring_in_app_launches_operator ON bring_in_app_launches (operator_handle, launched_at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bring_in_app_launches_room ON bring_in_app_launches (room_id, launched_at_ms DESC)`,
  // ANT apps shared contract 2026-05-27 (eiw05zdurz msg_z0r3ys9xd5): per-viewer room
  // preferences that drive native-app sidebar ordering. pinned floats above the
  // priorityScore sort; muted zeroes the score; archived hides from default queries.
  // Multi-device persistent so a user muting on iPhone stays muted on Mac.
  //
  // Deliberately NOT a FOREIGN KEY against chat_rooms.id: pref rows are
  // UI-state, no orphan harm if a room is hard-deleted (queries scope by
  // handle and would skip orphans anyway). Avoiding FK keeps test setup
  // light + makes the table robust to room-id renames if those ever happen.
  `CREATE TABLE IF NOT EXISTS room_member_preferences (
    room_id       TEXT NOT NULL,
    handle        TEXT NOT NULL,
    muted         INTEGER NOT NULL DEFAULT 0,
    pinned        INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (room_id, handle)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_room_member_preferences_handle ON room_member_preferences (handle)`,
  // Open-usage daemon snapshots (JWPK msg_300r0u8dlx + msg_4rbn05cztw antV4
  // 2026-05-28). Every successful usageSnapshotPoller tick appends one row
  // carrying the full UsagePayload as JSON so we can later draw trend lines
  // per provider. Append-only; pruning happens via operationalRetention.
  //
  // payload_json is the serialised UsagePayload from $lib/usage/types so
  // both the proxy response and any downstream chart can deserialise with
  // the same type. Deliberately NOT broken out per provider: one tick =
  // one snapshot keeps the trend timestamps aligned across providers and
  // avoids fan-out writes when 5 providers all sample at the same instant.
  `CREATE TABLE IF NOT EXISTS usage_snapshots (
    id            TEXT PRIMARY KEY,
    captured_at_ms INTEGER NOT NULL,
    payload_json  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_usage_snapshots_captured_at ON usage_snapshots (captured_at_ms DESC)`,
  // PR-C super-admin reclaim primitive (substrate v0.2 plan, 2026-05-29).
  //
  // Tonight's identity-surgery sprint surfaced a class of recovery operations
  // (membership rebinding, stale terminal cleanup, dual-bind resolution) that
  // required raw sqlite3 UPDATE statements against fresh-ant.db with no audit
  // trail. reclaim_requests is the named primitive that replaces that ad-hoc
  // forensic with a signed, audited, CLI-driven path.
  //
  // signed_payload: canonical JSON of the request (captured at create time so
  // the audit chain survives schema drift on subsequent reads).
  //
  // signature: NULL in Stage A (admin-bearer only); populated when Part 4
  // identity_keys / trust_pubkey lifts ship and reclaim signing becomes
  // mandatory. Future tightening lands without a schema change.
  //
  // target_kind dispatch in reclaimRequestsStore.executeReclaim:
  //   - terminal:   flip terminals.status -> 'archived', soft-revoke any
  //                 room_memberships pointing at it.
  //   - membership: soft-revoke a specific room_memberships row.
  //   - identity:   NO-OP until v0.2 identities table lives.
  //   - session:    NO-OP until v0.2 sessions table lives.
  //
  // resulting_actions_json captures the actions taken (or simulated under
  // dryRun) so the audit log is queryable post-hoc.
  `CREATE TABLE IF NOT EXISTS reclaim_requests (
    reclaim_id              TEXT PRIMARY KEY,
    requester_handle        TEXT NOT NULL,
    target_kind             TEXT NOT NULL CHECK (target_kind IN ('terminal','membership','identity','session')),
    target_id               TEXT NOT NULL,
    reason                  TEXT NOT NULL,
    diagnostic_json         TEXT,
    status                  TEXT NOT NULL CHECK (status IN ('pending','approved','executed','denied','expired')) DEFAULT 'pending',
    created_at_ms           INTEGER NOT NULL,
    approved_at_ms          INTEGER,
    approved_by_handle      TEXT,
    executed_at_ms          INTEGER,
    executed_by_handle      TEXT,
    resulting_actions_json  TEXT,
    signed_payload          TEXT NOT NULL,
    signature               TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reclaim_requests_pending ON reclaim_requests(status, created_at_ms) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS idx_reclaim_requests_target ON reclaim_requests(target_kind, target_id)`,
  // Substrate v0.2 Part 4 — identity_keys multi-device + recovery (2026-05-29).
  // Spec: /tmp/ant-identity-keys-multi-device-canvas-2026-05-29.md.
  //
  // Four new tables (additive — existing terminals / terminal_records /
  // room_memberships unchanged). identities is the durable subject;
  // identity_keys are the device-scoped cryptographic credentials that
  // come and go; identity_attestations is the append-only proof log for
  // every mint/revoke; recovery_grants is the pending-approval queue for
  // Tier 2 (org-admin attests) and Tier 3 (paper-key / multi-admin).
  //
  // The Stage B permissions layer (separate slice) consumes these tables
  // for cryptographic auth (signed-nonce challenge against an active key)
  // instead of the legacy pidChain walk. paper_key_hash is set on
  // identity-creation as the always-available Tier 3 fallback so no
  // identity ever has < 2 active recovery routes.
  `CREATE TABLE IF NOT EXISTS identities (
    identity_id        TEXT PRIMARY KEY,
    kind               TEXT NOT NULL CHECK (kind IN ('human','agent','bot','system')),
    display_name       TEXT NOT NULL,
    canonical_handle   TEXT NOT NULL,
    owner_identity_id  TEXT REFERENCES identities(identity_id),
    org_id             TEXT,
    paper_key_hash     TEXT,
    created_at_ms      INTEGER NOT NULL,
    revoked_at_ms      INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_handle ON identities(canonical_handle) WHERE revoked_at_ms IS NULL`,
  `CREATE TABLE IF NOT EXISTS identity_keys (
    key_id              TEXT PRIMARY KEY,
    identity_id         TEXT NOT NULL REFERENCES identities(identity_id),
    device_label        TEXT NOT NULL,
    public_key          TEXT NOT NULL,
    key_kind            TEXT NOT NULL CHECK (key_kind IN ('device','paper','escrow')),
    created_at_ms       INTEGER NOT NULL,
    attested_by_key_id  TEXT REFERENCES identity_keys(key_id),
    revoked_at_ms       INTEGER,
    revoke_reason       TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_keys_active ON identity_keys(identity_id) WHERE revoked_at_ms IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_identity_keys_public_key ON identity_keys(public_key)`,
  `CREATE TABLE IF NOT EXISTS identity_attestations (
    attestation_id      TEXT PRIMARY KEY,
    identity_id         TEXT NOT NULL REFERENCES identities(identity_id),
    new_key_id          TEXT REFERENCES identity_keys(key_id),
    revoked_key_id      TEXT REFERENCES identity_keys(key_id),
    attester_key_id     TEXT NOT NULL REFERENCES identity_keys(key_id),
    attester_kind       TEXT NOT NULL CHECK (attester_kind IN ('self','org-admin','paper-key','multi-admin')),
    signature           TEXT NOT NULL,
    canonical_payload   TEXT NOT NULL,
    reason              TEXT,
    created_at_ms       INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_identity_attestations_identity ON identity_attestations(identity_id, created_at_ms)`,
  `CREATE TABLE IF NOT EXISTS recovery_grants (
    grant_id                     TEXT PRIMARY KEY,
    requester_identity_id        TEXT NOT NULL REFERENCES identities(identity_id),
    requested_at_ms              INTEGER NOT NULL,
    reason                       TEXT NOT NULL,
    target_approver_identity_id  TEXT REFERENCES identities(identity_id),
    paper_key_hash               TEXT,
    status                       TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired')),
    decided_at_ms                INTEGER,
    decided_by_identity_id       TEXT REFERENCES identities(identity_id),
    resulting_attestation_id     TEXT REFERENCES identity_attestations(attestation_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_grants_pending ON recovery_grants(status, requested_at_ms)`,
  // device_revocations view — convenience projection for admin queries of
  // "what device key was revoked, when, why, by whom". Derivable from
  // identity_keys + identity_attestations so no base table cost. Joined
  // through the attestation_id with attester_kind to surface the
  // recovery-tier classification in one place.
  `CREATE VIEW IF NOT EXISTS device_revocations AS
    SELECT
      k.key_id            AS key_id,
      k.identity_id       AS identity_id,
      k.device_label      AS device_label,
      k.public_key        AS public_key,
      k.key_kind          AS key_kind,
      k.revoked_at_ms     AS revoked_at_ms,
      k.revoke_reason     AS revoke_reason,
      a.attestation_id    AS revoke_attestation_id,
      a.attester_key_id   AS attester_key_id,
      a.attester_kind     AS attester_kind,
      a.reason            AS attestation_reason,
      a.created_at_ms     AS attestation_created_at_ms
    FROM identity_keys k
    LEFT JOIN identity_attestations a
      ON a.revoked_key_id = k.key_id
    WHERE k.revoked_at_ms IS NOT NULL`,
  // Stage A — restructured 403 PermissionDenied payload (plan milestone
  // p3-stage-a-403-payload of ant-substrate-v0.2-2026-05-29, ratified PR
  // shape 2026-05-29). `grants_shim` is the minimal forward-compatible
  // shim that the new `ant grant` CLI writes to + the 403 builder
  // consults for `no_grant` decisions. Stage B replaces this with the
  // full v0.2 `grants` + `permission_requests` + `pending_actions`
  // tables, but the row shape is identical here so a migration script
  // can copy rows forward without backfill. scope='once' is the Stage B
  // default that this Stage A shim accepts but does not consume — the
  // ant-cli-grant verb sets it explicitly to track operator intent.
  `CREATE TABLE IF NOT EXISTS grants_shim (
    grant_id          TEXT PRIMARY KEY,
    grantee_handle    TEXT NOT NULL,
    action            TEXT NOT NULL,
    target_kind       TEXT NOT NULL,
    target_id         TEXT NOT NULL,
    granted_by_handle TEXT NOT NULL,
    granted_at_ms     INTEGER NOT NULL,
    revoked_at_ms     INTEGER,
    scope             TEXT NOT NULL DEFAULT 'once'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_grants_shim_lookup ON grants_shim (grantee_handle, action, target_id, revoked_at_ms)`,
  // Stage B foundation — permission_requests + pending_actions (plan
  // milestone p3-stage-b-permission-requests of
  // ant-substrate-v0.2-2026-05-29). When an agent hits a 403 the substrate
  // creates a permission_requests row + parks the original action in
  // pending_actions with a 5-minute TTL; when an approver clicks Grant the
  // substrate writes a grants_shim row + flips replay_status to
  // 'ready_for_replay' so the original CLI caller can retry seamlessly.
  // Modal routing (push to approver devices) ships when antos/antchat
  // apps wire up; this is the substrate-only primitive layer.
  //
  // Why CLI-driven replay (not server-side internal fetch):
  // The endpoint just signals readiness — the original CLI caller polls
  // GET /api/permission-requests/[id] until status='approved' and retries
  // the original action with the new grant in place. Simpler, easier to
  // debug, no infinite-replay-loop risk if the original endpoint also
  // 403s for a different reason. The status enum reflects this:
  //   pending          — request open, waiting for approver decision
  //   ready_for_replay — approved + grant written, CLI should retry now
  //   replayed_by_caller — CLI confirmed it retried (audit signal)
  //   expired          — TTL elapsed without approver decision
  //   denied           — approver explicitly denied; CLI should not retry
  `CREATE TABLE IF NOT EXISTS permission_requests (
    request_id            TEXT PRIMARY KEY,
    requester_handle      TEXT NOT NULL,
    action                TEXT NOT NULL,
    target_kind           TEXT NOT NULL CHECK (target_kind IN ('room','plan','task','org','system')),
    target_id             TEXT NOT NULL,
    reason                TEXT,
    approver_handles_json TEXT NOT NULL DEFAULT '[]',
    status                TEXT NOT NULL CHECK (status IN ('pending','approved','denied','expired','superseded')) DEFAULT 'pending',
    created_at_ms         INTEGER NOT NULL,
    decided_at_ms         INTEGER,
    decided_by_handle     TEXT,
    decision_scope        TEXT CHECK (decision_scope IN ('once','always-for-room','always-for-agent')) DEFAULT 'once',
    resulting_grant_id    TEXT,
    pending_action_id     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_permission_requests_pending ON permission_requests(status, created_at_ms) WHERE status = 'pending'`,
  `CREATE INDEX IF NOT EXISTS idx_permission_requests_approver ON permission_requests(target_kind, target_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_permission_requests_requester ON permission_requests(requester_handle, status, created_at_ms DESC)`,
  `CREATE TABLE IF NOT EXISTS pending_actions (
    action_id     TEXT PRIMARY KEY,
    request_id    TEXT NOT NULL REFERENCES permission_requests(request_id),
    http_method   TEXT NOT NULL,
    http_path     TEXT NOT NULL,
    payload_json  TEXT NOT NULL,
    headers_json  TEXT,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    replayed_at_ms INTEGER,
    replay_status TEXT CHECK (replay_status IN ('pending','ready_for_replay','replayed_by_caller','expired','denied'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pending_actions_expiry ON pending_actions(expires_at_ms) WHERE replayed_at_ms IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_pending_actions_request ON pending_actions(request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grants_shim_lookup_v2 ON grants_shim (grantee_handle, action, target_id, revoked_at_ms)`,
  // PR-D — tools catalog migration (plan milestone pr-d-tools-catalog of
  // ant-substrate-v0.2-2026-05-29). Closes the "nifty leak" case JWPK
  // surfaced msg_mjh7rgi3wa + msg_6gq9zczigb (2026-05-30 ~01:00 BST):
  // skills load from filesystem globs, MCPs from per-client config, CLI
  // verbs from hardcoded dispatch tables — "what skills does this agent
  // have access to?" had no single answer. Deleting a SKILL.md left
  // agents still referencing it because the catalog was the filesystem,
  // not a queryable surface. tools_catalog is the canonical row source
  // for skills/MCPs/cli-verbs/hooks/plugins/bridges; tool_grants_v02 is
  // the per-agent grant table. The `_v02` suffix is intentional — it
  // coexists with caller_grants (2026-05-19 slice) and grants_shim
  // (PR #98 Stage A); v0.2 cut-over will consolidate, but that's a
  // planned milestone, not this PR. Additive only.
  `CREATE TABLE IF NOT EXISTS tools_catalog (
    tool_id        TEXT PRIMARY KEY,
    tool_slug      TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('skill','mcp','cli-verb','hook','plugin','bridge')),
    name           TEXT NOT NULL,
    description    TEXT,
    version        TEXT,
    source_path    TEXT,
    owner_org      TEXT,
    min_tier       TEXT CHECK (min_tier IN ('oss','premium','internal')) DEFAULT 'oss',
    added_at_ms    INTEGER NOT NULL,
    deprecated_at_ms INTEGER,
    retired_at_ms  INTEGER,
    metadata_json  TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tools_catalog_slug_active ON tools_catalog(tool_slug) WHERE retired_at_ms IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_tools_catalog_kind ON tools_catalog(kind) WHERE retired_at_ms IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_tools_catalog_org ON tools_catalog(owner_org) WHERE retired_at_ms IS NULL`,
  `CREATE TABLE IF NOT EXISTS tool_grants_v02 (
    grant_id           TEXT PRIMARY KEY,
    grantee_handle     TEXT NOT NULL,
    tool_id            TEXT NOT NULL REFERENCES tools_catalog(tool_id),
    scope_kind         TEXT NOT NULL CHECK (scope_kind IN ('global','org','room','session')),
    scope_id           TEXT,
    granted_by_handle  TEXT NOT NULL,
    granted_at_ms      INTEGER NOT NULL,
    revoked_at_ms      INTEGER,
    expires_at_ms      INTEGER,
    reason             TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tool_grants_v02_lookup ON tool_grants_v02(grantee_handle, tool_id, scope_kind, scope_id, revoked_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_grants_v02_tool ON tool_grants_v02(tool_id, revoked_at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_grants_shim_lookup ON grants_shim (grantee_handle, action, target_id, revoked_at_ms)`,

  // M6.1 — RBAC role registry (antOS Enterprise Control Plane plan).
  // Replaces ad-hoc endpoint-level gates (room_owner / org_admin /
  // plan_owner / isAdminBearer) with an enumerable role model bound to
  // identities. Role IDs are deliberately string-stable so the parallel
  // `enterpriseCapabilityPolicy` work (commit 3cbfc32, raw-PTY gate via
  // tool_grants_v02) can dependency-seam onto these IDs without coupling
  // to the row layout. is_seeded marks the four canonical roles
  // (super-admin / org-admin / room-owner / member) so admin-bearer
  // writers cannot accidentally delete or relabel them via /api/roles.
  // role_capabilities is a junction table; (role_id, capability, scope)
  // is the natural composite PK. role_assignments binds a role to an
  // identity handle scoped to global / org / room / session — scope_id
  // is NULL when scope_kind = 'global'. Additive only; no FK to identities
  // because that table belongs to PR #99's surface and may be renamed.
  `CREATE TABLE IF NOT EXISTS roles (
    role_id       TEXT PRIMARY KEY,
    name          TEXT NOT NULL UNIQUE,
    description   TEXT,
    created_at_ms INTEGER NOT NULL,
    is_seeded     INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS role_capabilities (
    role_id    TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    capability TEXT NOT NULL,
    scope      TEXT NOT NULL,
    PRIMARY KEY (role_id, capability, scope)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_role_capabilities_role ON role_capabilities(role_id)`,
  `CREATE TABLE IF NOT EXISTS role_assignments (
    assignment_id       TEXT PRIMARY KEY,
    role_id             TEXT NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
    identity_handle     TEXT NOT NULL,
    scope_kind          TEXT NOT NULL,
    scope_id            TEXT,
    assigned_at_ms      INTEGER NOT NULL,
    assigned_by_handle  TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_role_assignments_identity ON role_assignments(identity_handle)`,
  `CREATE INDEX IF NOT EXISTS idx_role_assignments_role ON role_assignments(role_id)`,
  `CREATE INDEX IF NOT EXISTS idx_role_assignments_scope ON role_assignments(scope_kind, scope_id)`
];

// =====================================================================
// v0.2 schema (additive — see docs/concepts/ant-v02-identity-and-recovery.md)
// =====================================================================
//
// Option D collapse (JWPK msg_bby3p17jk6 2026-05-30 ~00:45 BST,
// docs/concepts/ant-v02-option-d-collapse-plan.md): with the
// archive-and-ditch decision there is no migration window that needs the
// `v02_` prefix to disambiguate from legacy tables. The unprefixed names
// below ARE the canonical v0.2 surface. Legacy tables (terminals /
// room_memberships / chat_rooms / chat_room_members) are untouched here;
// the cut-over PRs flip endpoint writers from legacy to these new tables
// then a post-cut-over slice drops the legacy schema.
//
// The constant name `V02_SCHEMA_DDL_STATEMENTS` is kept (it remains the
// v0.2 substrate); only the CREATE TABLE / INDEX names lose the prefix.
//
// Tables superseded by the other parallel substrate stream and DROPPED
// from this set as part of the Option D collapse:
//   - `v02_agent_trust_keys`     → superseded by PR #99 `identity_keys`
//   - `v02_key_rotation_requests` → superseded by PR #99 `recovery_grants`
//   - `v02_permission_requests`  → superseded by PR #105 `permission_requests`
//   - `v02_pending_actions`      → superseded by PR #105 `pending_actions`
//   - `v02_reclaim_requests`     → superseded by PR #106 `reclaim_requests`
//
// FK references to out-of-scope entities (orgs, cli_providers, tools) are
// intentionally TEXT columns WITHOUT REFERENCES clauses. The spec mentions
// these as future targets but they are explicitly out-of-scope for v0.2
// per docs/concepts/ant-v02-identity-and-recovery.md ("Messages, plans,
// tasks, memories, artefacts are explicitly OUT OF SCOPE"). When those
// tables ship, the FK constraints can be added via a follow-up ALTER.
//
// Structural invariants enforced via SQLite constraints (not app code):
//   1. UNIQUE INDEX (agent_id) WHERE status='live' on runtimes
//      → an agent has at most ONE live runtime. Dual-bind = constraint
//        violation, not silent fanout drift.
//   2. UNIQUE INDEX (agent_id, room_id) WHERE left_at_ms IS NULL on
//      memberships → one active membership per room.
//   3. memberships explicitly has NO fanout_target_runtime_id column
//      → fanout target derived at send time from
//        agents.current_runtime_id; no cache that can go stale.
//
// `agents.primary_trust_key_id` FK targets PR #99's `identity_keys(key_id)`
// — the canonical multi-device key primitive. PR #99 must merge before
// this migration runs.
//
// `user_room_preferences` + `user_panel_pins` follow the spec addendum
// in docs/concepts/ant-v02-identity-and-recovery.md §user_room_preferences
// and §user_panel_pins.
//
// Open question (Option D plan §6): `identities` (PR #99) vs `agents` is
// pending JWPK ratification. Defaulting to (b) — keep both coexisting —
// per plan instructions: `agents` is the substrate-identity surface
// (kind/display_name/current_runtime_id/owner_org); `identities` is the
// cryptographic-identity surface (signing keys/attestations).
const V02_SCHEMA_DDL_STATEMENTS = [
  // -- Identity Layer -------------------------------------------------
  // agents — DURABLE identity. 'TigerResearch' lives here from creation
  // to deletion. Every membership/audit/message FK points here, not to a
  // runtime. primary_trust_key_id is NULLABLE because an agent can exist
  // briefly between row creation and first key registration; production
  // code should require a primary key before flipping status='live' (this
  // is application-level, not a DB constraint, so a partial agent under
  // construction is representable). owner_org is TEXT (no FK) per the
  // out-of-scope note above.
  //
  // primary_trust_key_id targets PR #99's `identity_keys(key_id)` — the
  // canonical multi-device key primitive (Option D collapse).
  `CREATE TABLE IF NOT EXISTS agents (
    agent_id              TEXT PRIMARY KEY,
    display_name          TEXT NOT NULL,
    primary_handle        TEXT NOT NULL,
    primary_trust_key_id  TEXT REFERENCES identity_keys(key_id),
    status                TEXT NOT NULL DEFAULT 'live'
                            CHECK (status IN ('live','archived','deleted')),
    owner_org             TEXT,
    current_runtime_id    TEXT REFERENCES runtimes(runtime_id),
    created_at_ms         INTEGER NOT NULL,
    reclaim_count         INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agents_primary_handle
     ON agents (primary_handle)`,
  `CREATE INDEX IF NOT EXISTS idx_agents_owner_org
     ON agents (owner_org)`,

  // runtimes — EPHEMERAL pane binding. pid_start_iso is ISO 8601 UTC
  // (NEVER raw `ps -o lstart` output — today's silence root cause was
  // locale-dependent string compare on the legacy `pid_start` column).
  // cli_provider_id is TEXT (no FK) per out-of-scope note.
  //
  // The UNIQUE INDEX below is THE structural fix for the dual-bind bug:
  // an agent has at most ONE live runtime. Attempting to insert a
  // second runtime with status='live' for the same agent_id raises
  // SQLITE_CONSTRAINT_UNIQUE instead of silently fanning out to two
  // panes.
  `CREATE TABLE IF NOT EXISTS runtimes (
    runtime_id                  TEXT PRIMARY KEY,
    agent_id                    TEXT NOT NULL REFERENCES agents(agent_id),
    host                        TEXT NOT NULL,
    tmux_pane                   TEXT,
    pid                         INTEGER NOT NULL,
    pid_start_iso               TEXT NOT NULL,
    cli_provider_id             TEXT,
    status                      TEXT NOT NULL DEFAULT 'live'
                                  CHECK (status IN ('live','stale','archived','reclaimed')),
    started_at_ms               INTEGER NOT NULL,
    last_heartbeat_ms           INTEGER,
    ended_at_ms                 INTEGER,
    reclaimed_by_runtime_id     TEXT REFERENCES runtimes(runtime_id),
    register_challenge_proof    TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_runtimes_agent_live
     ON runtimes (agent_id) WHERE status='live'`,
  `CREATE INDEX IF NOT EXISTS idx_runtimes_agent
     ON runtimes (agent_id)`,
  `CREATE INDEX IF NOT EXISTS idx_runtimes_status_heartbeat
     ON runtimes (status, last_heartbeat_ms)`,

  // -- Room Layer -----------------------------------------------------
  // rooms — persistent coordination space. Independent of any hardware
  // change. owner_org TEXT (no FK).
  `CREATE TABLE IF NOT EXISTS rooms (
    room_id             TEXT PRIMARY KEY,
    display_name        TEXT NOT NULL,
    owner_org           TEXT,
    owner_agent_id      TEXT REFERENCES agents(agent_id),
    visibility          TEXT NOT NULL CHECK (visibility IN ('private','org','public')),
    entry_policy_json   TEXT,
    created_at_ms       INTEGER NOT NULL,
    archived_at_ms      INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rooms_owner_org ON rooms (owner_org)`,
  `CREATE INDEX IF NOT EXISTS idx_rooms_visibility ON rooms (visibility)`,

  // memberships — SINGLE table. NO roster/fanout split. NO
  // fanout_target_runtime_id column. Fanout target is DERIVED at send
  // time from agents.current_runtime_id, never cached. This is the
  // structural fix for the bug that recurred 4× on 2026-05-29.
  //
  // UNIQUE INDEX (agent_id, room_id) WHERE left_at_ms IS NULL: an agent
  // has at most ONE active membership per room. Historical rows
  // (left_at_ms IS NOT NULL) are preserved for audit and do not
  // participate in the uniqueness check.
  `CREATE TABLE IF NOT EXISTS memberships (
    membership_id           TEXT PRIMARY KEY,
    agent_id                TEXT NOT NULL REFERENCES agents(agent_id),
    room_id                 TEXT NOT NULL REFERENCES rooms(room_id),
    role                    TEXT NOT NULL DEFAULT 'member'
                              CHECK (role IN ('owner','member','chair','observer','bot')),
    room_alias              TEXT,
    joined_at_ms            INTEGER NOT NULL,
    left_at_ms              INTEGER,
    last_read_post_order    INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_memberships_agent_room_active
     ON memberships (agent_id, room_id) WHERE left_at_ms IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_room
     ON memberships (room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_memberships_agent
     ON memberships (agent_id)`,

  // M9d cut-over: per-room presentation columns mirrored from the
  // legacy chat_room_members table (display_color / display_icon /
  // display_background_style / member_kind + room_display_name).
  // All nullable — pre-M9d rows resolve missing values via the agent
  // default-colour / icon helpers and fall back to agents.display_name
  // when room_display_name is NULL (mirrors chat_room_members.display_*
  // fallback behaviour exactly).
  // member_kind tracks 'human' vs 'agent' so the read path reproduces
  // the same kind label without re-deriving from terminal_records on
  // every load.
  // room_display_name preserves per-room display-name overrides
  // (chatRoomStore.updateRoomMemberPresentation). NULL = inherit
  // agents.display_name.
  // Ratified by JWPK msg_xlw33qkds8 2026-05-30 (verification interface
  // verification swarm — "kick the swarm off and let's get this
  // finished"). See docs/concepts/ant-v02-identity-and-recovery.md.
  // Tolerated by the duplicate-column-name catch in
  // applySchemaMigrations so re-running on an existing DB is safe.
  `ALTER TABLE memberships ADD COLUMN display_color TEXT`,
  `ALTER TABLE memberships ADD COLUMN display_icon TEXT`,
  `ALTER TABLE memberships ADD COLUMN display_background_style TEXT`,
  `ALTER TABLE memberships ADD COLUMN member_kind TEXT
     CHECK (member_kind IS NULL OR member_kind IN ('human','agent'))`,
  `ALTER TABLE memberships ADD COLUMN room_display_name TEXT`,

  // -- Catalogue Layer ------------------------------------------------
  // default_models / default_agent_kinds — server-side canonical lists
  // for the model + agent-kind chips (JWPK 2026-05-31). These replace the
  // browser-only localStorage store (src/lib/stores/agentKinds.svelte.ts),
  // making the defaults durable + shareable across devices. Seeded by
  // scripts/seed-default-catalogues.mjs (INSERT OR IGNORE, idempotent);
  // schema lives here so a fresh DB has the (empty) tables on bootstrap.
  // logo_slug references src/lib/icons/llmLogoCatalogue.ts.
  `CREATE TABLE IF NOT EXISTS default_models (
    name              TEXT PRIMARY KEY,
    provider          TEXT,
    runs_where        TEXT CHECK (runs_where IS NULL OR runs_where IN ('cloud','local')),
    default_on        INTEGER NOT NULL DEFAULT 1,
    sort_order        INTEGER NOT NULL,
    logo_slug         TEXT,
    created_at_ms     INTEGER NOT NULL,
    updated_at_ms     INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS default_agent_kinds (
    name              TEXT PRIMARY KEY,
    provider          TEXT,
    default_on        INTEGER NOT NULL DEFAULT 1,
    sort_order        INTEGER NOT NULL,
    logo_slug         TEXT,
    created_at_ms     INTEGER NOT NULL,
    updated_at_ms     INTEGER NOT NULL
  )`,

  // -- Access Layer ---------------------------------------------------
  // tool_grants — issued capability rows. tool_slug is open-ended TEXT
  // (the tools catalog is out of scope this PR; can be added as an FK
  // when the catalog table ships).
  //
  // source_request_id targets PR #105's `permission_requests(request_id)`
  // (Option D collapse — was v02_permission_requests pre-collapse).
  `CREATE TABLE IF NOT EXISTS tool_grants (
    grant_id                TEXT PRIMARY KEY,
    subject_kind            TEXT NOT NULL CHECK (subject_kind IN ('agent','org','room','everyone')),
    subject_id              TEXT,
    tool_slug               TEXT NOT NULL,
    room_id                 TEXT REFERENCES rooms(room_id),
    permission              TEXT NOT NULL CHECK (permission IN ('use','admin','read')),
    granted_by_agent_id     TEXT NOT NULL REFERENCES agents(agent_id),
    granted_at_ms           INTEGER NOT NULL,
    expires_at_ms           INTEGER,
    revoked_at_ms           INTEGER,
    revoked_by_agent_id     TEXT REFERENCES agents(agent_id),
    source_request_id       TEXT REFERENCES permission_requests(request_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tool_grants_lookup
     ON tool_grants (subject_kind, subject_id, tool_slug, room_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_grants_active
     ON tool_grants (tool_slug, revoked_at_ms)`,

  // -- Forensic Layer -------------------------------------------------
  // audit_events — APPEND-ONLY single typed event log. Replaces every
  // *_audit / *_history / *_status_events table. Forensic = ONE query
  // (WHERE entity_id=? ORDER BY at_ms), not a 12-way UNION.
  //
  // entity_kind CHECK covers all v0.2 substrate entity types (agents,
  // runtimes, rooms, memberships, tool_grants — owned by THIS DDL) and
  // the entity types owned by sibling Option D substrate PRs (#99
  // identities/identity_keys/recovery_grants, #105
  // permission_requests/pending_actions, #106 reclaim_requests), plus
  // 'system' for non-entity events (cron sweeps, boot-time housekeeping,
  // etc.). Tight on purpose — a typo can't silently classify a row.
  `CREATE TABLE IF NOT EXISTS audit_events (
    audit_id            TEXT PRIMARY KEY,
    at_ms               INTEGER NOT NULL,
    kind                TEXT NOT NULL,
    entity_kind         TEXT NOT NULL
                          CHECK (entity_kind IN (
                            'agent','runtime','room','membership','tool_grant',
                            'identity','identity_key','recovery_grant',
                            'permission_request','pending_action','reclaim_request',
                            'user_room_preference','user_panel_pin','system'
                          )),
    entity_id           TEXT NOT NULL,
    actor_agent_id      TEXT REFERENCES agents(agent_id),
    actor_runtime_id    TEXT REFERENCES runtimes(runtime_id),
    before_json         TEXT,
    after_json          TEXT,
    request_id          TEXT,
    ip_hash             TEXT,
    challenge_proof     TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_entity
     ON audit_events (entity_id, at_ms)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_kind_time
     ON audit_events (kind, at_ms DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_request
     ON audit_events (request_id) WHERE request_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_audit_events_actor_time
     ON audit_events (actor_agent_id, at_ms DESC) WHERE actor_agent_id IS NOT NULL`,

  // -- User Preferences Layer ----------------------------------------
  // user_room_preferences — per (user_agent × room) UI state. Lazy
  // creation; a row exists only if the user has set at least one
  // preference for that room (avoids 115×N empty rows). Spec:
  // docs/concepts/ant-v02-identity-and-recovery.md §user_room_preferences.
  `CREATE TABLE IF NOT EXISTS user_room_preferences (
    preference_id       TEXT PRIMARY KEY,
    user_agent_id       TEXT NOT NULL REFERENCES agents(agent_id),
    room_id             TEXT NOT NULL REFERENCES rooms(room_id),
    starred             INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0,1)),
    sort_order          REAL,
    last_read_at_ms     INTEGER,
    notification_pref   TEXT CHECK (notification_pref IN ('all','mentions','muted')),
    pinned_at_ms        INTEGER,
    created_at_ms       INTEGER NOT NULL,
    updated_at_ms       INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_room_preferences_user_room
     ON user_room_preferences (user_agent_id, room_id)`,

  // user_panel_pins — right-hand panel pins. Cross-entity (rooms /
  // plans / agents / memories / decks / artefacts) so kept separate
  // from user_room_preferences. Spec:
  // docs/concepts/ant-v02-identity-and-recovery.md §user_panel_pins.
  `CREATE TABLE IF NOT EXISTS user_panel_pins (
    pin_id              TEXT PRIMARY KEY,
    user_agent_id       TEXT NOT NULL REFERENCES agents(agent_id),
    entity_kind         TEXT NOT NULL
                          CHECK (entity_kind IN ('room','plan','agent','memory','deck','artefact')),
    entity_id           TEXT NOT NULL,
    display_order       REAL NOT NULL,
    pinned_at_ms        INTEGER NOT NULL,
    unpinned_at_ms      INTEGER,
    metadata_json       TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_user_panel_pins_user_entity_active
     ON user_panel_pins (user_agent_id, entity_kind, entity_id)
     WHERE unpinned_at_ms IS NULL`
];

function resolveDbFilePath(): string {
  const explicit = process.env.ANT_FRESH_DB_PATH;
  if (explicit && explicit.length > 0) return explicit;
  // Phase 5.1: when vitest runs without explicit ANT_FRESH_DB_PATH, scope
  // each worker to its own DB file so persisted-store tests (now including
  // chatRoomStore) don't collide across worker processes via SQLITE_BUSY.
  // Pre-Phase 5.1 these tests used in-memory Maps so cross-worker contention
  // didn't exist; preserving zero-test-churn requires the auto-isolation.
  if (process.env.VITEST) {
    const workerId = process.env.VITEST_WORKER_ID ?? '0';
    return join('/tmp', `ant-vitest-fresh-${workerId}-${process.pid}.db`);
  }
  const home = process.env.HOME ?? '/tmp';
  return join(home, '.ant', 'fresh-ant.db');
}

function ensureParentDirectoryExists(dbFile: string): void {
  mkdirSync(dirname(dbFile), { recursive: true });
}

function applySchemaMigrations(db: DatabaseInstance): void {
  renameLegacyValidationTables(db);
  // The verification_observations rebuild must run BEFORE the static
  // SCHEMA_DDL_STATEMENTS loop — that loop includes a CREATE INDEX on
  // parent_observation_id which only exists AFTER the rebuild. Without
  // this ordering, any server restart against a pre-Phase-A8 DB throws
  // SqliteError("no such column: parent_observation_id") and every API
  // route 500s because getIdentityDb() never completes init. (Found
  // 2026-05-28 during live deploy of PR #82 — the V2-server slice that
  // introduced the rebuild left the static index ordered before it.)
  rebuildVerificationObservationsForAppendOnly(db);
  for (const ddlStatement of SCHEMA_DDL_STATEMENTS) {
    try {
      db.prepare(ddlStatement).run();
    } catch (cause) {
      // Tolerate "duplicate column name" on idempotent ALTER TABLE re-runs.
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!message.includes('duplicate column name')) throw cause;
    }
  }
  extendAsksStatusCheckForActiveStatuses(db);
  extendArtefactKindCheckForStage(db);
  // v0.2 additive migration — see V02_SCHEMA_DDL_STATEMENTS comment block.
  // Runs after legacy schema so v0.2 tables can reference legacy tables in
  // future cut-over slices if needed. Same duplicate-column tolerance.
  for (const ddlStatement of V02_SCHEMA_DDL_STATEMENTS) {
    try {
      db.prepare(ddlStatement).run();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (!message.includes('duplicate column name')) throw cause;
    }
  }
}

/**
 * Slice 6 / Phase A8 migration (2026-05-28): rebuild
 * verification_observations to support the append-only verdict log shape:
 *   - Extend status enum with 'dispute', 'insufficient_evidence',
 *     'retag_required' verdicts.
 *   - Add parent_observation_id (chain link for corrections).
 *   - Add verifier_handle + verifier_kind (audit-of-flagger discipline).
 *   - Add dispute_reason (required when status='dispute').
 *
 * SQLite doesn't allow modifying CHECK constraints, so we rebuild the
 * table via the standard `_new + copy + drop + rename` dance. Skips
 * when the live schema already has the new columns (idempotent).
 */
function rebuildVerificationObservationsForAppendOnly(db: DatabaseInstance): void {
  const existingSchema = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='verification_observations'`)
    .get() as { sql: string | null } | undefined;
  if (!existingSchema || !existingSchema.sql) return;
  // Already rebuilt? Detect via presence of one of the new columns.
  if (existingSchema.sql.includes('parent_observation_id')) return;

  const rebuild = db.transaction(() => {
    db.prepare(`DROP INDEX IF EXISTS idx_verification_observations_lens`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_verification_observations_claim`).run();
    db.prepare(`CREATE TABLE verification_observations_new (
      id                     TEXT PRIMARY KEY,
      lens_id                TEXT NOT NULL REFERENCES verification_lenses(id) ON DELETE CASCADE,
      claim_anchor           TEXT NOT NULL,
      claim_text             TEXT NOT NULL,
      status                 TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','passed','failed','waived','dispute','insufficient_evidence','retag_required')),
      score                  INTEGER,
      result_json            TEXT,
      started_at_ms          INTEGER NOT NULL,
      completed_at_ms        INTEGER,
      run_by                 TEXT,
      parent_observation_id  TEXT REFERENCES verification_observations_new(id) ON DELETE SET NULL,
      verifier_handle        TEXT,
      verifier_kind          TEXT CHECK (verifier_kind IN ('human','agent','system','automated')),
      dispute_reason         TEXT
    )`).run();
    db.prepare(`INSERT INTO verification_observations_new (
      id, lens_id, claim_anchor, claim_text, status, score, result_json,
      started_at_ms, completed_at_ms, run_by
    ) SELECT
      id, lens_id, claim_anchor, claim_text, status, score, result_json,
      started_at_ms, completed_at_ms, run_by
    FROM verification_observations`).run();
    db.prepare(`DROP TABLE verification_observations`).run();
    db.prepare(`ALTER TABLE verification_observations_new RENAME TO verification_observations`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_verification_observations_lens ON verification_observations (lens_id, claim_anchor)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_verification_observations_claim ON verification_observations (claim_anchor, completed_at_ms DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_verification_observations_parent ON verification_observations (parent_observation_id) WHERE parent_observation_id IS NOT NULL`).run();
  });
  rebuild();
}

/**
 * Slice 5 / Phase A7 migration: rename the legacy validation_* tables
 * to verification_* names. Idempotent — only runs when the old tables
 * still exist. SQLite's ALTER TABLE RENAME TO updates referencing FKs
 * automatically since 3.25, but the validation_schema_audit and
 * validation_runs tables also have FK references to validation_schemas
 * that we rename in the same transaction so they all land coherently.
 *
 * After this runs, the SCHEMA_DDL_STATEMENTS CREATE TABLE IF NOT EXISTS
 * verification_lenses (etc) will see the renamed tables already present
 * and skip.
 */
function renameLegacyValidationTables(db: DatabaseInstance): void {
  const hasLegacy = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='validation_schemas'`
    )
    .get();
  if (!hasLegacy) return;

  const hasNew = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='verification_lenses'`
    )
    .get();
  if (hasNew) {
    // Both names exist somehow — bail loudly rather than corrupt either.
    throw new Error(
      'renameLegacyValidationTables: both validation_schemas and verification_lenses exist; manual reconciliation required'
    );
  }

  const inTxn = db.transaction(() => {
    // Drop the old indexes that name the old tables; SQLite refuses
    // duplicate index names so the new CREATE INDEX statements below
    // would conflict if we left these in place.
    db.prepare(`DROP INDEX IF EXISTS idx_validation_schemas_kind`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_validation_schemas_scope`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_validation_schema_audit_schema`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_validation_schema_audit_actor`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_validation_runs_schema`).run();
    db.prepare(`DROP INDEX IF EXISTS idx_validation_runs_claim`).run();
    db.prepare(`ALTER TABLE validation_schemas RENAME TO verification_lenses`).run();
    // validation_schema_audit's FK to validation_schemas auto-updates,
    // but the column is still named schema_id; rename it to lens_id to
    // match the new vocabulary.
    const hasAudit = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='validation_schema_audit'`
      )
      .get();
    if (hasAudit) {
      db.prepare(`ALTER TABLE validation_schema_audit RENAME TO verification_lens_audit`).run();
      db.prepare(`ALTER TABLE verification_lens_audit RENAME COLUMN schema_id TO lens_id`).run();
    }
    const hasRuns = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='validation_runs'`
      )
      .get();
    if (hasRuns) {
      db.prepare(`ALTER TABLE validation_runs RENAME TO verification_observations`).run();
      db.prepare(`ALTER TABLE verification_observations RENAME COLUMN schema_id TO lens_id`).run();
    }
  });
  inTxn();
}

/**
 * ANT Stage is distinct from normal built decks. Older DBs have a CHECK
 * constraint on chat_room_artefacts.kind that does not include 'stage', so
 * rebuild the small metadata table once when the live schema is missing it.
 */
function extendArtefactKindCheckForStage(db: DatabaseInstance): void {
  const existingSchema = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_room_artefacts'`)
    .get() as { sql: string | null } | undefined;
  if (!existingSchema || !existingSchema.sql || existingSchema.sql.includes("'stage'")) return;

  const rebuild = db.transaction(() => {
    db.prepare(`CREATE TABLE chat_room_artefacts_new (
      id              TEXT PRIMARY KEY,
      room_id         TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
      kind            TEXT NOT NULL CHECK (kind IN ('html','deck','stage','spreadsheet','doc','mockup','other')),
      title           TEXT NOT NULL,
      ref_url         TEXT,
      summary         TEXT,
      created_by      TEXT,
      created_at_ms   INTEGER NOT NULL,
      deleted_at_ms   INTEGER
    )`).run();
    db.prepare(`INSERT INTO chat_room_artefacts_new (
      id, room_id, kind, title, ref_url, summary, created_by, created_at_ms, deleted_at_ms
    ) SELECT
      id, room_id, kind, title, ref_url, summary, created_by, created_at_ms, deleted_at_ms
    FROM chat_room_artefacts`).run();
    db.prepare(`DROP TABLE chat_room_artefacts`).run();
    db.prepare(`ALTER TABLE chat_room_artefacts_new RENAME TO chat_room_artefacts`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_chat_room_artefacts_room_kind ON chat_room_artefacts (room_id, kind, created_at_ms DESC)`).run();
  });
  rebuild();
}

/**
 * Asks-as-pill (JWPK 2026-05-22): the `status` CHECK on `asks` only
 * permitted ('open','answered','dismissed') on older DBs. SQLite doesn't
 * allow modifying a CHECK constraint via ALTER TABLE, so we rebuild the
 * table via the standard `_new` + copy + drop + rename dance — but only
 * when the live schema is missing an active status value.
 */
function extendAsksStatusCheckForActiveStatuses(db: DatabaseInstance): void {
  const existingSchema = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'asks'`)
    .get() as { sql: string | null } | undefined;
  if (!existingSchema || !existingSchema.sql) return;
  const existingColumns = new Set(
    (db.prepare(`PRAGMA table_info(asks)`).all() as Array<{ name: string }>).map((column) => column.name)
  );
  const requiredColumns = ['target_handle', 'merged_into_ask_id', 'merged_at_ms', 'merged_by_handle'];
  const hasRequiredStatuses =
    existingSchema.sql.includes("'merged'") && existingSchema.sql.includes("'deferred'");
  const hasRequiredColumns = requiredColumns.every((columnName) => existingColumns.has(columnName));
  if (hasRequiredStatuses && hasRequiredColumns) return;

  const targetHandleSelect = existingColumns.has('target_handle') ? 'target_handle' : 'NULL';
  const mergedIntoAskIdSelect = existingColumns.has('merged_into_ask_id') ? 'merged_into_ask_id' : 'NULL';
  const mergedAtMsSelect = existingColumns.has('merged_at_ms') ? 'merged_at_ms' : 'NULL';
  const mergedByHandleSelect = existingColumns.has('merged_by_handle') ? 'merged_by_handle' : 'NULL';

  const rebuild = db.transaction(() => {
    db.prepare(`CREATE TABLE asks_new (
      id              TEXT PRIMARY KEY,
      room_id         TEXT NOT NULL,
      opened_by_handle TEXT NOT NULL,
      opened_by_display_name TEXT,
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      status          TEXT NOT NULL CHECK (status IN ('open','answered','dismissed','merged','deferred')) DEFAULT 'open',
      opened_at_ms    INTEGER NOT NULL,
      answer          TEXT,
      answered_by_handle TEXT,
      answered_by_display_name TEXT,
      answered_at_ms  INTEGER,
      dismissed_by_handle TEXT,
      dismissed_by_display_name TEXT,
      dismissed_at_ms INTEGER,
      target_handle   TEXT,
      merged_into_ask_id TEXT,
      merged_at_ms    INTEGER,
      merged_by_handle TEXT
    )`).run();
    db.prepare(`INSERT INTO asks_new (
      id, room_id, opened_by_handle, opened_by_display_name, title, body, status,
      opened_at_ms, answer, answered_by_handle, answered_by_display_name, answered_at_ms,
      dismissed_by_handle, dismissed_by_display_name, dismissed_at_ms, target_handle,
      merged_into_ask_id, merged_at_ms, merged_by_handle
    ) SELECT
      id, room_id, opened_by_handle, opened_by_display_name, title, body, status,
      opened_at_ms, answer, answered_by_handle, answered_by_display_name, answered_at_ms,
      dismissed_by_handle, dismissed_by_display_name, dismissed_at_ms, ${targetHandleSelect},
      ${mergedIntoAskIdSelect}, ${mergedAtMsSelect}, ${mergedByHandleSelect}
    FROM asks`).run();
    db.prepare(`DROP TABLE asks`).run();
    db.prepare(`ALTER TABLE asks_new RENAME TO asks`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_asks_room_status ON asks (room_id, status, opened_at_ms DESC)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_asks_id ON asks (id)`).run();
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_asks_target_status ON asks (target_handle, status)`).run();
  });
  rebuild();
}

// B2-8 diagnostics: expose the resolved DB file path so the ops endpoint
// can report its on-disk size (the 6.9GB-WAL incident made DB growth a
// thing operators must be able to see).
export function getDbFilePath(): string {
  return resolveDbFilePath();
}

function ensureYouMembership(db: DatabaseInstance): void {
  // Task #138 retro-fix: ensure @you is a member of every room
  const roomsWithoutYou = db.prepare(`
    SELECT r.id FROM chat_rooms r
    WHERE r.deleted_at_ms IS NULL
      AND r.id NOT IN (
        SELECT room_id FROM chat_room_members WHERE handle = '@you'
      )
  `).all() as { id: string }[];
  const nowIso = new Date().toISOString();
  for (const row of roomsWithoutYou) {
    db.prepare(`INSERT INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human')`).run(
      `m-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      row.id,
      '@you',
      '@you',
      '#DC2626',
      'J',
      'card',
      nowIso
    );
  }
}

export function getIdentityDb(): DatabaseInstance {
  const globalSlot = globalThis as Record<string, unknown>;
  const existing = globalSlot[DB_GLOBAL_KEY] as DatabaseInstance | undefined;
  if (existing) return existing;

  const dbFile = resolveDbFilePath();
  ensureParentDirectoryExists(dbFile);
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Speed Pact T-Sec-Speed-2: busy_timeout was 0 (default) — SQLite returned
  // SQLITE_BUSY immediately on any lock contention. With concurrent writers
  // (agentStatusPoller every 10s + chat-message inserts + task creates + plan
  // events all sharing this DB file), reads like /api/plans were stalling
  // 1.5-7s and `database is locked` surfaced on chat sends. 5000ms gives
  // SQLite a 5-second native busy-wait that resolves contention without
  // bouncing back to the JS retry layer. Standard better-sqlite3 best practice.
  db.pragma('busy_timeout = 5000');
  // cache_size in pages (negative = KB). -64000 = 64MB page cache — small
  // memory cost, large win on repeated SELECTs like listAllTerminals (431
  // rows) that the poller does twice per tick.
  db.pragma('cache_size = -64000');
  applySchemaMigrations(db);
  ensureYouMembership(db);
  sweepAutoCreatedRoomPlansInDb(db);
  // Backfill chat_rooms.last_post_order from the live chat_messages
  // history once (JWPK 2026-05-22 rooms-sort fix). Idempotent: only
  // touches rows where the column is currently NULL. Cheap — one
  // GROUP-BY SELECT joined back via correlated subquery. Future
  // messages set the column at INSERT time inside insertMessageRow's
  // transaction. Fail-quiet: backfill is convergence, not correctness.
  try {
    db.prepare(`
      UPDATE chat_rooms
      SET last_post_order = (
        SELECT MAX(post_order) FROM chat_messages WHERE room_id = chat_rooms.id
      )
      WHERE last_post_order IS NULL
    `).run();
  } catch {
    /* swallow — listChatRooms ORDER BY's COALESCE fallback covers NULL rows */
  }
  globalSlot[DB_GLOBAL_KEY] = db;
  // Archived-name tag backfill (spec 2026-05-31): tag any legacy archived
  // terminals whose name is still untagged so their base name frees up in the
  // UNIQUE index. Idempotent + cheap (one SELECT when nothing to do). Cycle-safe
  // via dynamic import; runs AFTER the handle is cached so the re-entrant
  // getIdentityDb() inside setTerminalStatus returns the same instance.
  try {
    void import('./terminalsStore').then((module) => {
      try { module.backfillArchivedTerminalTags(); } catch { /* idempotent — swallow */ }
    });
  } catch {
    /* import failure (e.g. test env) — swallow */
  }
  // Per-human inbox backfill (asks-as-pill JWPK 2026-05-22): seed inbox
  // rooms + memberships for existing humans on first call. Best-effort —
  // a backfill failure must NEVER block the DB handle return; the live
  // hooks in chatRoomStore + terminalRecordsStore will fill gaps as
  // membership changes happen post-deploy. Lazy import to avoid the
  // cycle (humanInboxBackfill → ensureHumanInboxRoom → getIdentityDb).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    void import('./humanInboxBackfill').then((module) => {
      try { module.backfillHumanInboxes(); } catch { /* idempotent — swallow */ }
    });
  } catch {
    /* import failure (e.g. test env) — swallow */
  }
  // Manual canvas v2 seed (JWPK 2026-05-23 slice 1): hand-authored
  // annotations for the /rooms default state. Idempotent — only writes
  // when the table is empty. Cycle-safe via dynamic import.
  try {
    void import('./manualScreenSeed').then((module) => {
      try { module.seedManualScreensIfEmpty(); } catch { /* idempotent — swallow */ }
    });
  } catch {
    /* test env — swallow */
  }
  return db;
}

/**
 * Test helper: close the in-process better-sqlite3 connection and clear the
 * singleton WITHOUT deleting the underlying file. The next getIdentityDb()
 * re-opens against the same on-disk database, so all committed rows survive.
 *
 * This is the honest simulation of a process restart (the server going down
 * and coming back up against its persistent DB). It is distinct from
 * resetIdentityDbForTests(), which DELETES the file to guarantee a clean
 * slate between unrelated tests. Conflating the two — as the old leaky
 * resetIdentityDbForTests() accidentally did — is what coupled
 * restart-persistence proofs to a reset that "happened not to wipe". Keep
 * them separate: this preserves data; reset destroys it.
 */
export function closeIdentityDbHandleForTests(): void {
  const globalSlot = globalThis as Record<string, unknown>;
  const existing = globalSlot[DB_GLOBAL_KEY] as DatabaseInstance | undefined;
  if (existing) {
    try { existing.close(); } catch { /* db may already be closed */ }
  }
  delete globalSlot[DB_GLOBAL_KEY];
}

export function resetIdentityDbForTests(): void {
  const globalSlot = globalThis as Record<string, unknown>;
  const existing = globalSlot[DB_GLOBAL_KEY] as DatabaseInstance | undefined;
  if (existing) {
    try { existing.close(); } catch { /* db may already be closed */ }
  }
  delete globalSlot[DB_GLOBAL_KEY];

  // Closing the handle is NOT enough: the identity DB is a FILE (per-worker
  // /tmp/ant-vitest-fresh-*.db or an explicit ANT_FRESH_DB_PATH), so the next
  // getIdentityDb() reopens the same file with every row intact. That made
  // tests order-dependent — e.g. a terminal row (pid 4242) inserted by one
  // describe block bled into a later block sharing the file, resolving a
  // pidChain to a non-member terminal and turning an expected 201 into a 403
  // (found 2026-06-01 in chat-rooms messages strict-403 suite: passed solo,
  // failed in-suite). Delete the file + WAL/SHM sidecars so the next open
  // re-runs the schema migrations against a genuinely empty database.
  //
  // GUARD: only delete a TEST-scoped path. We refuse to unlink anything
  // outside the vitest temp pattern or an explicitly test-pointed
  // ANT_FRESH_DB_PATH — so a stray call in a non-test context can never
  // destroy ~/.ant/fresh-ant.db.
  const dbFile = resolveDbFilePath();
  const isVitestTempScope = /\/ant-vitest-fresh-[^/]+\.db$/.test(dbFile);
  const isExplicitTestPath =
    Boolean(process.env.ANT_FRESH_DB_PATH) && process.env.VITEST === 'true';
  if (!isVitestTempScope && !isExplicitTestPath) return;
  for (const suffix of ['', '-wal', '-shm']) {
    const path = `${dbFile}${suffix}`;
    if (existsSync(path)) {
      try { rmSync(path, { force: true }); } catch { /* best-effort cleanup */ }
    }
  }
}
