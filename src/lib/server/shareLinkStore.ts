/**
 * shareLinkStore — read-only public URLs for sharing room state externally.
 *
 * Short token, optional expiry, revocable. Scope controls what is shared.
 */

import { getIdentityDb as getDb } from './db';
import { randomBytes } from 'node:crypto';

export type ShareLink = {
  token: string;
  room_id: string;
  title: string | null;
  scope: 'room' | 'messages' | 'tasks' | 'plan';
  created_by: string | null;
  created_at_ms: number;
  expires_at_ms: number | null;
  revoked_at_ms: number | null;
  access_count: number;
  last_accessed_ms: number | null;
};

function generateToken(): string {
  return randomBytes(12).toString('hex');
}

function nowMs(): number {
  return Date.now();
}

function rowToLink(row: any): ShareLink {
  return {
    token: row.token,
    room_id: row.room_id,
    title: row.title ?? null,
    scope: row.scope,
    created_by: row.created_by ?? null,
    created_at_ms: row.created_at_ms,
    expires_at_ms: row.expires_at_ms ?? null,
    revoked_at_ms: row.revoked_at_ms ?? null,
    access_count: row.access_count ?? 0,
    last_accessed_ms: row.last_accessed_ms ?? null,
  };
}

export function createShareLink(input: {
  room_id: string;
  title?: string | null;
  scope?: ShareLink['scope'];
  created_by?: string | null;
  expires_at_ms?: number | null;
}): ShareLink {
  const db = getDb();
  const token = generateToken();
  const ts = nowMs();
  const stmt = db.prepare(`
    INSERT INTO share_links (token, room_id, title, scope, created_by, created_at_ms, expires_at_ms, revoked_at_ms, access_count, last_accessed_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    token,
    input.room_id,
    input.title ?? null,
    input.scope ?? 'room',
    input.created_by ?? null,
    ts,
    input.expires_at_ms ?? null,
    null,
    0,
    null
  );
  return rowToLink({
    token,
    room_id: input.room_id,
    title: input.title ?? null,
    scope: input.scope ?? 'room',
    created_by: input.created_by ?? null,
    created_at_ms: ts,
    expires_at_ms: input.expires_at_ms ?? null,
    revoked_at_ms: null,
    access_count: 0,
    last_accessed_ms: null,
  });
}

export function getShareLink(token: string): ShareLink | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM share_links WHERE token = ?').get(token);
  if (!row) return null;
  return rowToLink(row);
}

export function isLinkValid(link: ShareLink): boolean {
  if (link.revoked_at_ms) return false;
  if (link.expires_at_ms && link.expires_at_ms < nowMs()) return false;
  return true;
}

export function incrementLinkAccess(token: string): ShareLink | null {
  const db = getDb();
  const existing = getShareLink(token);
  if (!existing || !isLinkValid(existing)) return null;
  db.prepare('UPDATE share_links SET access_count = access_count + 1, last_accessed_ms = ? WHERE token = ?').run(
    nowMs(),
    token
  );
  return getShareLink(token);
}

export function revokeShareLink(token: string): boolean {
  const db = getDb();
  const result = db.prepare('UPDATE share_links SET revoked_at_ms = ? WHERE token = ?').run(nowMs(), token);
  return result.changes > 0;
}

export function listShareLinksForRoom(roomId: string): ShareLink[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM share_links WHERE room_id = ? ORDER BY created_at_ms DESC').all(roomId);
  return rows.map(rowToLink);
}
