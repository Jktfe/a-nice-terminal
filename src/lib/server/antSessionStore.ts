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
      created_at_ms      INTEGER NOT NULL,
      last_seen_at_ms    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ant_sessions_parent
      ON ant_sessions (parent_session_id);
  `);
}

function rowToSession(r: SessionRow): AntSession {
  return {
    id: r.id,
    kind: r.kind as SessionKind,
    label: r.label,
    parent_session_id: r.parent_session_id,
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
    created_at_ms: now,
    last_seen_at_ms: now
  };
  db.prepare(
    `INSERT INTO ant_sessions (id, kind, label, parent_session_id, created_at_ms, last_seen_at_ms)
     VALUES (@id, @kind, @label, @parent_session_id, @created_at_ms, @last_seen_at_ms)`
  ).run(row);
  return rowToSession(row);
}

/**
 * Resolve-or-create by a durable client token — THE activation entry point.
 * register/login calls this with the client's persisted token: if a session
 * already exists for that token it's returned (and touched for liveness), else
 * one is created with the token as its id. Idempotent across restarts: the
 * same token always lands on the same identity, which is what populates
 * ant_sessions and puts the durable model in force for real agents.
 */
export function ensureSession(
  token: string,
  opts: { kind: SessionKind; label?: string | null; parentSessionId?: string | null },
  db = getIdentityDb()
): AntSession {
  const existing = getSession(token, db);
  if (existing) return markSessionSeen(token, Date.now(), db) ?? existing;
  return createSession({ id: token, kind: opts.kind, label: opts.label, parentSessionId: opts.parentSessionId }, db);
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
