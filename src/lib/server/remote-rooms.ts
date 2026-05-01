// Reads the user's ~/.ant/config.json (the same file the CLI's config module
// writes via 'ant join-room') and exposes the joined remote rooms to the
// SvelteKit server. Treated as read-only here — mutations stay in the CLI.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface RemoteRoom {
  room_id: string;
  server_url: string;
  token: string;
  token_id: string;
  invite_id: string;
  kind: string;
  handle: string | null;
  joined_at: string;
  label: string | null;
}

const CONFIG_FILE = join(process.env.HOME || '/tmp', '.ant', 'config.json');

function loadRaw(): Record<string, any> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function listRemoteRooms(): RemoteRoom[] {
  const raw = loadRaw();
  const fallbackUrl = typeof raw.serverUrl === 'string' ? raw.serverUrl : '';
  const tokens = (raw.tokens && typeof raw.tokens === 'object') ? raw.tokens : {};
  const out: RemoteRoom[] = [];
  for (const [roomId, t] of Object.entries(tokens) as Array<[string, any]>) {
    if (!t || typeof t !== 'object') continue;
    out.push({
      room_id: t.room_id || roomId,
      server_url: t.server_url || fallbackUrl,
      token: t.token,
      token_id: t.token_id,
      invite_id: t.invite_id,
      kind: t.kind || 'cli',
      handle: t.handle ?? null,
      joined_at: t.joined_at || '',
      label: t.label || null,
    });
  }
  return out.sort((a, b) => (a.joined_at < b.joined_at ? 1 : -1));
}

export function getRemoteRoom(roomId: string): RemoteRoom | null {
  const all = listRemoteRooms();
  return all.find((r) => r.room_id === roomId) ?? null;
}
