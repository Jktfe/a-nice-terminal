/**
 * pairingTokenStore — QR-based device onboarding tokens.
 *
 * Short-lived, single-use tokens that encode server URL + room + key.
 * Native clients scan QR → consume token → device registered.
 */

import { getIdentityDb as getDb } from './db';
import { randomBytes } from 'node:crypto';

export type PairingToken = {
  token: string;
  room_id: string;
  server_url: string;
  api_key: string;
  device_name: string | null;
  created_by: string | null;
  created_at_ms: number;
  expires_at_ms: number | null;
  consumed_at_ms: number | null;
  consumed_by_device: string | null;
};

function generateToken(): string {
  return randomBytes(16).toString('hex');
}

function nowMs(): number {
  return Date.now();
}

function rowToToken(row: any): PairingToken {
  return {
    token: row.token,
    room_id: row.room_id,
    server_url: row.server_url,
    api_key: row.api_key,
    device_name: row.device_name ?? null,
    created_by: row.created_by ?? null,
    created_at_ms: row.created_at_ms,
    expires_at_ms: row.expires_at_ms ?? null,
    consumed_at_ms: row.consumed_at_ms ?? null,
    consumed_by_device: row.consumed_by_device ?? null,
  };
}

export function createPairingToken(input: {
  room_id: string;
  server_url: string;
  api_key: string;
  device_name?: string | null;
  created_by?: string | null;
  expires_at_ms?: number | null;
}): PairingToken {
  const db = getDb();
  const token = generateToken();
  const ts = nowMs();
  const stmt = db.prepare(`
    INSERT INTO pairing_tokens (token, room_id, server_url, api_key, device_name, created_by, created_at_ms, expires_at_ms, consumed_at_ms, consumed_by_device)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    token,
    input.room_id,
    input.server_url,
    input.api_key,
    input.device_name ?? null,
    input.created_by ?? null,
    ts,
    input.expires_at_ms ?? null,
    null,
    null
  );
  return rowToToken({
    token,
    room_id: input.room_id,
    server_url: input.server_url,
    api_key: input.api_key,
    device_name: input.device_name ?? null,
    created_by: input.created_by ?? null,
    created_at_ms: ts,
    expires_at_ms: input.expires_at_ms ?? null,
    consumed_at_ms: null,
    consumed_by_device: null,
  });
}

export function getPairingToken(token: string): PairingToken | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pairing_tokens WHERE token = ?').get(token);
  if (!row) return null;
  return rowToToken(row);
}

export function consumePairingToken(token: string, deviceName?: string): PairingToken | null {
  const db = getDb();
  const existing = getPairingToken(token);
  if (!existing) return null;
  if (existing.consumed_at_ms) return null;
  if (existing.expires_at_ms && existing.expires_at_ms < nowMs()) return null;

  db.prepare('UPDATE pairing_tokens SET consumed_at_ms = ?, consumed_by_device = ? WHERE token = ?').run(
    nowMs(),
    deviceName ?? null,
    token
  );
  return getPairingToken(token);
}

export function revokePairingToken(token: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM pairing_tokens WHERE token = ?').run(token);
  return result.changes > 0;
}

export function listPairingTokensForRoom(roomId: string): PairingToken[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM pairing_tokens WHERE room_id = ? ORDER BY created_at_ms DESC').all(roomId);
  return rows.map(rowToToken);
}
