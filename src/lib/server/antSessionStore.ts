/**
 * antSessionStore — the DURABLE identity layer for the Simplify & Harden
 * room-identity model (plan room-identity-stage-full-delivery-2026-06-02,
 * lane A / task 9cad361d).
 *
 * THE LOAD-BEARING INVARIANT — identity is NOT the runtime:
 *   An ANT session has a durable, generated ID that is *not* derived from
 *   pid / pid_start. The pid is the disposable delivery endpoint; the
 *   session ID is the identity. A process restart or the day-roll — which
 *   today drift pid_start and trigger the stale-rebind 403 lockouts — does
 *   NOT change the session ID, so the identity (and its room-handle leases)
 *   survives intact. Re-resolving by ID after a "restart" returns the same
 *   session. That single separation kills the lockout class.
 *
 * Self-contained table init (answerCapsuleStore pattern) — no db.ts edit,
 * so it doesn't collide with the main-platform schema lane during the build.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

/** What kind of thing holds this identity. All kinds share THIS model;
 *  only their delivery adapter differs (see roomHandleLeaseStore + the
 *  envelope/routing lane). */
export type SessionKind =
  | 'human'
  | 'local-cli'
  | 'remote-agent'
  | 'mcp-agent'
  | 'web-session'
  | 'subagent';

export type AntSession = {
  id: string;
  kind: SessionKind;
  /** Human-readable label (e.g. the terminal name) — display only, never
   *  the identity. Mutable; the id is the stable key. */
  label: string | null;
  /** For subagents: the parent session ID. A subagent is a child identity
   *  tied to its parent but independently addressable (slide 11). NULL for
   *  top-level sessions. */
  parent_session_id: string | null;
  /** The terminal this session is BOUND to (the registering terminal's id).
   *  Set on create, immutable on resolve. The anti-adoption anchor: a caller
   *  re-presenting this session's token must come from the SAME terminal, and
   *  the post-path requires the caller's pidChain to resolve to this terminal.
   *  NULL only for server-minted sessions with no terminal (rare). */
  terminal_id: string | null;
  created_at_ms: number;
  /** Last time the session was seen/resolved — liveness signal, distinct
   *  from identity. Updated on resolve; never gates identity. */
  last_seen_at_ms: number;
};

type SessionRow = {
  id: string;
  kind: string;
  label: string | null;
  parent_session_id: string | null;
  terminal_id: string | null;
  created_at_ms: number;
  last_seen_at_ms: number;
};

const VALID_KINDS: ReadonlySet<string> = new Set<SessionKind>([
  'human',
  'local-cli',
  'remote-agent',
  'mcp-agent',
  'web-session',
  'subagent'
]);

function ensureTable(db = getIdentityDb()): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ant_sessions (
      id                 TEXT PRIMARY KEY,
      kind               TEXT NOT NULL
        CHECK (kind IN ('human','local-cli','remote-agent','mcp-agent','web-session','subagent')),
      label              TEXT,
      parent_session_id  TEXT REFERENCES ant_sessions(id) ON DELETE SET NULL,
      terminal_id        TEXT,
      created_at_ms      INTEGER NOT NULL,
      last_seen_at_ms    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ant_sessions_parent
      ON ant_sessions (parent_session_id);
  `);
  // Migration for the pre-existing live table: CREATE TABLE IF NOT EXISTS is a
  // no-op when ant_sessions already exists (it was created by the original
  // antSessionStore deploy WITHOUT terminal_id), so the column above is NOT
  // added on an existing table. Backfill it via ALTER — the same
  // ALTER-on-existing pattern db.ts uses for terminals/chat_rooms columns.
  // Without this, createSession's INSERT (... terminal_id ...) throws
  // "no such column" and 500s register on live. (Caught by @v4claude — the
  // fresh-db tests miss this path; see the seed-old-schema regression test.)
  const cols = db.prepare(`PRAGMA table_info(ant_sessions)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'terminal_id')) {
    db.exec(`ALTER TABLE ant_sessions ADD COLUMN terminal_id TEXT`);
  }
}

function rowToSession(r: SessionRow): AntSession {
  return {
    id: r.id,
    kind: r.kind as SessionKind,
    label: r.label,
    parent_session_id: r.parent_session_id,
    terminal_id: r.terminal_id,
    created_at_ms: r.created_at_ms,
    last_seen_at_ms: r.last_seen_at_ms
  };
}

export type CreateSessionInput = {
  kind: SessionKind;
  label?: string | null;
  /** Set for subagents — must reference an existing session. */
  parentSessionId?: string | null;
  /** Durable session token supplied by the client (persisted client-side and
   *  re-presented across restarts). When given, it BECOMES the session id, so
   *  the same client resolves the same identity forever. Omit to mint a fresh
   *  UUID (server-originated sessions). This is the hook the activation wiring
   *  uses: the CLI generates+persists a token once, register/login calls
   *  ensureSession(token), and ant_sessions populates. */
  id?: string;
  /** The terminal this session binds to (the registering terminal's id). The
   *  anti-adoption anchor — see AntSession.terminal_id. */
  terminalId?: string | null;
};

/** Mint a new durable identity. The returned id is the stable handle the
 *  rest of the system keys off — pid/runtime is bound separately +
 *  disposably via the delivery adapter, never here. */
export function createSession(input: CreateSessionInput, db = getIdentityDb()): AntSession {
  ensureTable(db);
  if (!VALID_KINDS.has(input.kind)) {
    throw new Error(`createSession: unknown kind '${input.kind}'`);
  }
  if (input.parentSessionId && !getSession(input.parentSessionId, db)) {
    throw new Error(`createSession: parent session '${input.parentSessionId}' does not exist`);
  }
  const now = Date.now();
  if (input.id && getSession(input.id, db)) {
    throw new Error(`createSession: id '${input.id}' already exists (use ensureSession to resolve-or-create)`);
  }
  const row: SessionRow = {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    label: input.label ?? null,
    parent_session_id: input.parentSessionId ?? null,
    terminal_id: input.terminalId ?? null,
    created_at_ms: now,
    last_seen_at_ms: now
  };
  db.prepare(
    `INSERT INTO ant_sessions (id, kind, label, parent_session_id, terminal_id, created_at_ms, last_seen_at_ms)
     VALUES (@id, @kind, @label, @parent_session_id, @terminal_id, @created_at_ms, @last_seen_at_ms)`
  ).run(row);
  return rowToSession(row);
}

/** Thrown when a caller tries to resolve (adopt) an existing session from a
 *  DIFFERENT terminal than the one it's bound to. The anti-adoption gate. */
export class SessionAdoptionRefused extends Error {
  constructor(public readonly token: string, public readonly boundTerminalId: string | null, public readonly callerTerminalId: string | null) {
    super(`Session '${token}' is bound to terminal '${boundTerminalId}'; refusing adoption by terminal '${callerTerminalId}'.`);
    this.name = 'SessionAdoptionRefused';
  }
}

/**
 * Resolve-or-create by a durable client token — THE activation entry point.
 * register/login calls this with the client's persisted token: if a session
 * already exists for that token it's returned (and touched for liveness), else
 * one is created BOUND to opts.terminalId. Idempotent across restarts: the
 * same token + same terminal always lands on the same identity.
 *
 * ANTI-ADOPTION (the #149 vector @v4claude found): a session id is NOT a
 * capability. On RESOLVE, if the existing session is bound to a terminal and
 * the caller presents a DIFFERENT terminal_id, REFUSE — a discoverable token
 * can't be used to adopt another terminal's identity. (A caller with no
 * terminalId, or matching it, resolves normally.)
 */
export function ensureSession(
  token: string,
  opts: { kind: SessionKind; label?: string | null; parentSessionId?: string | null; terminalId?: string | null },
  db = getIdentityDb()
): AntSession {
  const existing = getSession(token, db);
  if (existing) {
    if (
      existing.terminal_id !== null &&
      opts.terminalId != null &&
      existing.terminal_id !== opts.terminalId
    ) {
      throw new SessionAdoptionRefused(token, existing.terminal_id, opts.terminalId);
    }
    return markSessionSeen(token, Date.now(), db) ?? existing;
  }
  return createSession(
    { id: token, kind: opts.kind, label: opts.label, parentSessionId: opts.parentSessionId, terminalId: opts.terminalId },
    db
  );
}

/**
 * Resolve the durable identity currently bound to a terminal, or create one.
 *
 * Invite/bind flows start from a known terminal_record. Fanout, however, now
 * routes through room_membership.session_id, so the terminal must have a
 * durable ant_sessions row at invite time. Prefer the most recently seen
 * existing row; if none exists, use the terminal id as the durable token so the
 * same terminal resolves back to the same identity on future repairs.
 */
export function ensureSessionForTerminal(
  input: { terminalId: string; kind?: SessionKind; label?: string | null },
  db = getIdentityDb()
): AntSession {
  ensureTable(db);
  const existing = db
    .prepare(`SELECT * FROM ant_sessions WHERE terminal_id = ? ORDER BY last_seen_at_ms DESC LIMIT 1`)
    .get(input.terminalId) as SessionRow | undefined;
  if (existing) {
    return markSessionSeen(existing.id, Date.now(), db) ?? rowToSession(existing);
  }
  return ensureSession(input.terminalId, {
    kind: input.kind ?? 'local-cli',
    label: input.label ?? null,
    terminalId: input.terminalId
  }, db);
}

/** Resolve a session by its durable ID. This is the restart-safe path:
 *  the same ID resolves to the same identity regardless of pid drift. */
export function getSession(id: string, db = getIdentityDb()): AntSession | null {
  ensureTable(db);
  const row = db.prepare(`SELECT * FROM ant_sessions WHERE id = ?`).get(id) as SessionRow | undefined;
  return row ? rowToSession(row) : null;
}

/** Touch liveness — distinct from identity. Used by heartbeat / on-resolve.
 *  Returns the refreshed session, or null if the id is unknown. */
export function markSessionSeen(id: string, nowMs: number = Date.now(), db = getIdentityDb()): AntSession | null {
  ensureTable(db);
  const res = db.prepare(`UPDATE ant_sessions SET last_seen_at_ms = ? WHERE id = ?`).run(nowMs, id);
  if (res.changes === 0) return null;
  return getSession(id, db);
}

/** Direct child subagent sessions of a parent. */
export function childSessions(parentSessionId: string, db = getIdentityDb()): AntSession[] {
  ensureTable(db);
  const rows = db
    .prepare(`SELECT * FROM ant_sessions WHERE parent_session_id = ? ORDER BY created_at_ms ASC`)
    .all(parentSessionId) as SessionRow[];
  return rows.map(rowToSession);
}
