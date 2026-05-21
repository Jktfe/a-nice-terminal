// Browser-session identity primitive for M3.6a-v0. Cookie secret resolves to
// browser_sessions.handle; synthetic terminal/membership rows preserve audit.

import { hashToken, mintTokenSecret } from './chatInviteStore';
import { getIdentityDb } from './db';

// 30 days. Bumped from 24h after JWPK 2026-05-19 "this keeps happening"
// — the 24h re-auth loop was unworkable for daily-driver use. Matches
// SURFACE-SIZE-ONLY pattern: long-lived by default, manual logout +
// revoked_at_ms are the actual end-of-life signals.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type BrowserSessionRow = {
  id: string;
  room_id: string;
  terminal_id: string;
  handle: string;
  synthetic_handle: string;
  created_at_ms: number;
  expires_at_ms: number;
  revoked_at_ms: number | null;
  last_seen_at_ms: number | null;
};

export type CreateBrowserSessionInput = {
  roomId: string;
  authorHandle: string;
  browserSessionId?: string;
  nowMs?: number;
  ttlMs?: number;
};

export type CreateBrowserSessionResult = {
  session: BrowserSessionRow;
  browserSessionSecret: string;
};

export type ResolvedBrowserSession = {
  session_id: string;
  room_id: string;
  terminal_id: string;
  handle: string;
};

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function newBrowserSessionId(): string { return `bs_${mintTokenSecret().slice(0, 16)}`; }
function terminalIdFor(sessionId: string): string { return `browser-${sessionId}`; }
function membershipIdFor(sessionId: string): string { return `mem_${sessionId}`; }
function syntheticHandleFor(sessionId: string): string { return `@browser-${sessionId}`; }

function rowToSession(row: Record<string, unknown>): BrowserSessionRow {
  return {
    id: row.id as string,
    room_id: row.room_id as string,
    terminal_id: row.terminal_id as string,
    handle: row.handle as string,
    synthetic_handle: row.synthetic_handle as string,
    created_at_ms: row.created_at_ms as number,
    expires_at_ms: row.expires_at_ms as number,
    revoked_at_ms: (row.revoked_at_ms as number | null) ?? null,
    last_seen_at_ms: (row.last_seen_at_ms as number | null) ?? null
  };
}

function hasActiveMembership(roomId: string, handle: string): boolean {
  const row = getIdentityDb().prepare(
    `SELECT id FROM room_memberships
     WHERE room_id = ? AND handle = ? AND revoked_at_ms IS NULL`
  ).get(roomId, handle) as { id: string } | undefined;
  return Boolean(row);
}

export function createBrowserSession(input: CreateBrowserSessionInput): CreateBrowserSessionResult | null {
  const roomId = input.roomId.trim();
  const handle = normalizeHandle(input.authorHandle);
  if (roomId.length === 0 || handle.length === 0) return null;
  if (!hasActiveMembership(roomId, handle)) return null;

  const db = getIdentityDb();
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const expiresAtMs = nowMs + ttlMs;
  const nowSec = Math.floor(nowMs / 1000);
  const sessionId = input.browserSessionId ?? newBrowserSessionId();
  const terminalId = terminalIdFor(sessionId);
  const syntheticHandle = syntheticHandleFor(sessionId);
  const secret = `bws_${mintTokenSecret()}`;
  const secretHash = hashToken(secret);

  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO terminals
      (id, pid, pid_start, name, tmux_target_pane, agent_kind, pane_status,
       pane_stale_since, source, expires_at, meta, created_at, updated_at)
      VALUES (?, 0, 'browser-session', ?, NULL, 'browser', 'verified',
       NULL, 'browser-session', ?, ?, ?, ?)`).run(
      terminalId,
      `browser:${sessionId.slice(0, 12)}`,
      Math.floor(expiresAtMs / 1000),
      JSON.stringify({ browser_session_id: sessionId, room_id: roomId, handle }),
      nowSec,
      nowSec
    );
    db.prepare(`INSERT INTO browser_sessions
      (id, secret_hash, room_id, terminal_id, handle, synthetic_handle,
       created_at_ms, expires_at_ms, revoked_at_ms, last_seen_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`).run(
      sessionId, secretHash, roomId, terminalId, handle, syntheticHandle, nowMs, expiresAtMs
    );
    db.prepare(`INSERT INTO room_memberships
      (id, room_id, handle, terminal_id, created_at)
      VALUES (?, ?, ?, ?, ?)`).run(
      membershipIdFor(sessionId), roomId, syntheticHandle, terminalId, nowSec
    );
  });
  tx();

  return {
    browserSessionSecret: secret,
    session: {
      id: sessionId, room_id: roomId, terminal_id: terminalId, handle,
      synthetic_handle: syntheticHandle, created_at_ms: nowMs,
      expires_at_ms: expiresAtMs, revoked_at_ms: null, last_seen_at_ms: null
    }
  };
}

export function resolveBrowserSessionSecret(
  browserSessionSecret: string,
  roomId: string,
  nowMs: number = Date.now()
): ResolvedBrowserSession | null {
  const row = getIdentityDb().prepare(
    `SELECT * FROM browser_sessions WHERE secret_hash = ?`
  ).get(hashToken(browserSessionSecret)) as Record<string, unknown> | undefined;
  if (!row) return null;
  const session = rowToSession(row);
  if (session.room_id !== roomId) return null;
  if (session.revoked_at_ms !== null) return null;
  if (nowMs > session.expires_at_ms) return null;
  return {
    session_id: session.id,
    room_id: session.room_id,
    terminal_id: session.terminal_id,
    handle: session.handle
  };
}

/**
 * Resolve a browser-session secret to its identity WITHOUT enforcing a
 * room match. Use this when the caller is consuming the cookie as proof
 * of *identity*, not proof of room — the calling code is responsible for
 * the room-specific ACL (e.g. membership check) separately.
 *
 * Background (JWPK 2026-05-17, ANT artefacts room): browser sessions
 * are minted per-room, so a user with a cookie for room A who clicks
 * a shareable artefact link in room B previously hit a 403 even when
 * they were a member of room B. The resolver below lets the cross-room
 * artefact gates check identity + membership independently.
 *
 * Returns the same shape as resolveBrowserSessionSecret. Still rejects
 * expired and revoked sessions.
 */
export function resolveBrowserSessionSecretIgnoringRoom(
  browserSessionSecret: string,
  nowMs: number = Date.now()
): ResolvedBrowserSession | null {
  const row = getIdentityDb().prepare(
    `SELECT * FROM browser_sessions WHERE secret_hash = ?`
  ).get(hashToken(browserSessionSecret)) as Record<string, unknown> | undefined;
  if (!row) return null;
  const session = rowToSession(row);
  if (session.revoked_at_ms !== null) return null;
  if (nowMs > session.expires_at_ms) return null;
  return {
    session_id: session.id,
    room_id: session.room_id,
    terminal_id: session.terminal_id,
    handle: session.handle
  };
}

export function touchBrowserSessionLastSeen(
  sessionId: string,
  nowMs: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS
): boolean {
  const db = getIdentityDb();
  const tx = db.transaction(() => {
    const row = db.prepare(
      `SELECT terminal_id FROM browser_sessions
       WHERE id = ? AND revoked_at_ms IS NULL AND expires_at_ms > ?`
    ).get(sessionId, nowMs) as { terminal_id: string } | undefined;
    if (!row) return false;
    const expiresAtMs = nowMs + ttlMs;
    db.prepare(`UPDATE browser_sessions
      SET last_seen_at_ms = ?, expires_at_ms = ? WHERE id = ?`).run(nowMs, expiresAtMs, sessionId);
    db.prepare(`UPDATE terminals SET expires_at = ?, updated_at = ? WHERE id = ?`)
      .run(Math.floor(expiresAtMs / 1000), Math.floor(nowMs / 1000), row.terminal_id);
    return true;
  });
  return tx();
}

export function revokeBrowserSessionsForMember(
  roomId: string,
  handle: string,
  revokedAtMs: number = Date.now()
): number {
  const db = getIdentityDb();
  const normalised = normalizeHandle(handle);
  const tx = db.transaction(() => {
    const rows = db.prepare(
      `SELECT id FROM browser_sessions
       WHERE room_id = ? AND handle = ? AND revoked_at_ms IS NULL`
    ).all(roomId, normalised) as { id: string }[];
    for (const row of rows) {
      db.prepare(`UPDATE browser_sessions SET revoked_at_ms = ? WHERE id = ?`)
        .run(revokedAtMs, row.id);
      db.prepare(`UPDATE room_memberships SET revoked_at_ms = ? WHERE id = ?`)
        .run(revokedAtMs, membershipIdFor(row.id));
    }
    return rows.length;
  });
  return tx();
}
