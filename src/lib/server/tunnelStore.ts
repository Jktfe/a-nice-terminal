/**
 * tunnelStore — v3-parity local-dev site sharing.
 *
 * Each tunnel exposes a public URL scoped to one or more rooms.
 * Owner room has full CRUD; other allowed rooms can view.
 */

import { getIdentityDb as getDb } from './db';

export type Tunnel = {
  slug: string;
  title?: string | null;
  public_url: string;
  local_url?: string | null;
  owner_room_id: string;
  allowed_room_ids: string[];
  access_required: boolean;
  status: 'linked' | 'offline' | 'error';
  created_at_ms: number;
  updated_at_ms: number;
};

function nowMs(): number {
  return Date.now();
}

function rowToTunnel(row: any): Tunnel {
  return {
    slug: row.slug,
    title: row.title ?? null,
    public_url: row.public_url,
    local_url: row.local_url ?? null,
    owner_room_id: row.owner_room_id,
    allowed_room_ids: JSON.parse(row.allowed_room_ids || '[]'),
    access_required: Boolean(row.access_required),
    status: row.status,
    created_at_ms: row.created_at_ms,
    updated_at_ms: row.updated_at_ms,
  };
}

export function createTunnel(input: Omit<Tunnel, 'created_at_ms' | 'updated_at_ms'>): Tunnel {
  const db = getDb();
  const ts = nowMs();
  // Always include owner room in allowed_room_ids
  const allowed = Array.from(new Set([input.owner_room_id, ...input.allowed_room_ids]));
  const stmt = db.prepare(`
    INSERT INTO tunnels (slug, title, public_url, local_url, owner_room_id, allowed_room_ids, access_required, status, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    input.slug,
    input.title ?? null,
    input.public_url,
    input.local_url ?? null,
    input.owner_room_id,
    JSON.stringify(allowed),
    input.access_required ? 1 : 0,
    input.status,
    ts,
    ts
  );
  return { ...input, allowed_room_ids: allowed, created_at_ms: ts, updated_at_ms: ts };
}

export function getTunnelBySlug(slug: string): Tunnel | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tunnels WHERE slug = ?').get(slug);
  if (!row) return null;
  return rowToTunnel(row);
}

export function listTunnelsForRoom(roomId: string): Tunnel[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tunnels WHERE owner_room_id = ? OR allowed_room_ids LIKE ?').all(roomId, `%${roomId}%`);
  return rows.map(rowToTunnel).filter((t: Tunnel) => t.allowed_room_ids.includes(roomId));
}

export function updateTunnel(slug: string, patch: Partial<Pick<Tunnel, 'title' | 'public_url' | 'local_url' | 'allowed_room_ids' | 'access_required' | 'status'>>): Tunnel | null {
  const db = getDb();
  const existing = getTunnelBySlug(slug);
  if (!existing) return null;

  const fields: string[] = [];
  const values: any[] = [];

  if (patch.title !== undefined) { fields.push('title = ?'); values.push(patch.title); }
  if (patch.public_url !== undefined) { fields.push('public_url = ?'); values.push(patch.public_url); }
  if (patch.local_url !== undefined) { fields.push('local_url = ?'); values.push(patch.local_url); }
  if (patch.allowed_room_ids !== undefined) {
    const allowed = Array.from(new Set([existing.owner_room_id, ...patch.allowed_room_ids]));
    fields.push('allowed_room_ids = ?'); values.push(JSON.stringify(allowed));
  }
  if (patch.access_required !== undefined) { fields.push('access_required = ?'); values.push(patch.access_required ? 1 : 0); }
  if (patch.status !== undefined) { fields.push('status = ?'); values.push(patch.status); }

  if (fields.length === 0) return existing;

  fields.push('updated_at_ms = ?');
  values.push(nowMs());
  values.push(slug);

  db.prepare(`UPDATE tunnels SET ${fields.join(', ')} WHERE slug = ?`).run(...values);
  return getTunnelBySlug(slug);
}

export function deleteTunnel(slug: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tunnels WHERE slug = ?').run(slug);
  return result.changes > 0;
}
