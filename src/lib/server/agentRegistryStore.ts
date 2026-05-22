/**
 * agentRegistryStore — v3-parity agents registry.
 *
 * Builds on chat_room_members: aggregates agent rows across rooms,
 * and exposes a global registry view without a separate SQLite table.
 */

import { getIdentityDb as getDb } from './db';

export type AgentRegistryEntry = {
  handle: string;
  displayName: string;
  displayColor: string | null;
  displayIcon: string | null;
  displayBackgroundStyle: string | null;
  rooms: AgentRoomMembership[];
};

export type AgentRoomMembership = {
  roomId: string;
  roomName: string;
  joinedAt: string;
};

type AgentMemberRow = {
  handle: string;
  display_name: string;
  display_color: string | null;
  display_icon: string | null;
  display_background_style: string | null;
  room_id: string;
  room_name: string;
  joined_at: string;
};

function rowToMembership(row: AgentMemberRow): AgentRoomMembership {
  return {
    roomId: row.room_id,
    roomName: row.room_name,
    joinedAt: row.joined_at,
  };
}

function groupRowsByHandle(rows: AgentMemberRow[]): AgentRegistryEntry[] {
  const byHandle = new Map<string, AgentMemberRow[]>();
  for (const row of rows) {
    const list = byHandle.get(row.handle) ?? [];
    list.push(row);
    byHandle.set(row.handle, list);
  }

  const entries: AgentRegistryEntry[] = [];

  for (const [handle, memberRows] of byHandle) {
    // Pick the most recent display metadata across rooms
    const sorted = memberRows.sort(
      (a, b) => new Date(b.joined_at).getTime() - new Date(a.joined_at).getTime()
    );
    const latest = sorted[0];

    entries.push({
      handle,
      displayName: latest.display_name,
      displayColor: latest.display_color,
      displayIcon: latest.display_icon,
      displayBackgroundStyle: latest.display_background_style,
      rooms: memberRows.map(rowToMembership).sort(
        (a, b) => new Date(b.joinedAt).getTime() - new Date(a.joinedAt).getTime()
      ),
    });
  }

  return entries.sort((a, b) => a.handle.localeCompare(b.handle));
}

export function listAgents(roomId?: string): AgentRegistryEntry[] {
  const db = getDb();

  if (roomId) {
    const rows = db
      .prepare(
        `SELECT
          crm.handle,
          crm.display_name,
          crm.display_color,
          crm.display_icon,
          crm.display_background_style,
          crm.room_id,
          cr.name AS room_name,
          crm.joined_at
        FROM chat_room_members crm
        JOIN chat_rooms cr ON cr.id = crm.room_id
        WHERE crm.room_id = ? AND crm.kind = 'agent'
          AND crm.room_id NOT LIKE '__inbox_%'
        ORDER BY crm.handle ASC`
      )
      .all(roomId) as AgentMemberRow[];
    return groupRowsByHandle(rows);
  }

  const rows = db
    .prepare(
      `SELECT
        crm.handle,
        crm.display_name,
        crm.display_color,
        crm.display_icon,
        crm.display_background_style,
        crm.room_id,
        cr.name AS room_name,
        crm.joined_at
      FROM chat_room_members crm
      JOIN chat_rooms cr ON cr.id = crm.room_id
      WHERE crm.kind = 'agent'
        AND crm.room_id NOT LIKE '__inbox_%'
      ORDER BY crm.handle ASC`
    )
    .all() as AgentMemberRow[];
  return groupRowsByHandle(rows);
}

export function getAgent(handle: string): AgentRegistryEntry | null {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        crm.handle,
        crm.display_name,
        crm.display_color,
        crm.display_icon,
        crm.display_background_style,
        crm.room_id,
        cr.name AS room_name,
        crm.joined_at
      FROM chat_room_members crm
      JOIN chat_rooms cr ON cr.id = crm.room_id
      WHERE crm.handle = ? AND crm.kind = 'agent'
        AND crm.room_id NOT LIKE '__inbox_%'
      ORDER BY crm.joined_at DESC`
    )
    .all(handle) as AgentMemberRow[];

  if (rows.length === 0) return null;

  const grouped = groupRowsByHandle(rows);
  return grouped[0] ?? null;
}

export function updateAgentMetadata(
  handle: string,
  patch: {
    displayName?: string;
    displayColor?: string;
    displayIcon?: string;
    displayBackgroundStyle?: string;
  }
): boolean {
  const db = getDb();
  const fields: string[] = [];
  const values: any[] = [];

  if (patch.displayName !== undefined) {
    fields.push('display_name = ?');
    values.push(patch.displayName);
  }
  if (patch.displayColor !== undefined) {
    fields.push('display_color = ?');
    values.push(patch.displayColor);
  }
  if (patch.displayIcon !== undefined) {
    fields.push('display_icon = ?');
    values.push(patch.displayIcon);
  }
  if (patch.displayBackgroundStyle !== undefined) {
    fields.push('display_background_style = ?');
    values.push(patch.displayBackgroundStyle);
  }

  if (fields.length === 0) return false;

  values.push(handle);
  db.prepare(`UPDATE chat_room_members SET ${fields.join(', ')} WHERE handle = ? AND kind = 'agent'`).run(...values);
  return true;
}

export function resetAgentRegistryStoreForTests(): void {
  // No-op: this store is read-only over chat_room_members;
  // test reset is handled by resetting chatRoomStore.
}
