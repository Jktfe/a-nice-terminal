// Reads the user's ~/.ant/config.json (the same file the CLI's config module
// writes via 'ant join-room') and exposes the joined remote rooms to the
// SvelteKit server.
//
// Mostly read-only EXCEPT for a one-shot legacy migration: tokens written
// before per-token server_url existed get upgraded in-place using the
// top-level config.serverUrl as the inferred server. Without this, dropping
// the runtime fallback (commit 867d31c) silently disappears existing rooms
// from the listing — a regression on upgrade. Migrated entries are tagged
// server_url_inferred so callers can surface a "guessed, re-join to verify"
// hint to the user.

import { readFileSync, writeFileSync, existsSync } from 'fs';
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
  // True when server_url was inferred from a legacy migration rather than
  // captured at join time. UI should warn and prompt 'ant join-room' to refresh.
  server_url_inferred: boolean;
}

const CONFIG_FILE = join(process.env.HOME || '/tmp', '.ant', 'config.json');

let migrationDone = false;

function loadRaw(): Record<string, any> {
  if (!existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function migrateLegacyTokensInPlace(raw: Record<string, any>): void {
  if (migrationDone) return;
  migrationDone = true;
  const fallbackUrl = typeof raw.serverUrl === 'string' ? raw.serverUrl : '';
  if (!fallbackUrl) return;
  const tokens = (raw.tokens && typeof raw.tokens === 'object') ? raw.tokens : {};
  const repaired: string[] = [];
  for (const [roomId, t] of Object.entries(tokens) as Array<[string, any]>) {
    if (t && typeof t === 'object' && !t.server_url) {
      t.server_url = fallbackUrl;
      t.server_url_inferred = true;
      repaired.push(roomId);
    }
  }
  if (repaired.length === 0) return;
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(raw, null, 2));
    console.warn(
      `[remote-rooms] migrated ${repaired.length} legacy token(s) without server_url, ` +
      `inferred from config.serverUrl='${fallbackUrl}'. ` +
      `Re-run 'ant join-room' for any of these if the server is wrong: ${repaired.join(', ')}`,
    );
  } catch (err) {
    console.warn(`[remote-rooms] migration write failed: ${err instanceof Error ? err.message : err}`);
  }
}

export function listRemoteRooms(): RemoteRoom[] {
  const raw = loadRaw();
  migrateLegacyTokensInPlace(raw);
  const tokens = (raw.tokens && typeof raw.tokens === 'object') ? raw.tokens : {};
  const out: RemoteRoom[] = [];
  for (const [roomId, t] of Object.entries(tokens) as Array<[string, any]>) {
    if (!t || typeof t !== 'object') continue;
    if (!t.server_url || typeof t.server_url !== 'string') continue;
    out.push({
      room_id: t.room_id || roomId,
      server_url: t.server_url,
      token: t.token,
      token_id: t.token_id,
      invite_id: t.invite_id,
      kind: t.kind || 'cli',
      handle: t.handle ?? null,
      joined_at: t.joined_at || '',
      label: t.label || null,
      server_url_inferred: t.server_url_inferred === true,
    });
  }
  return out.sort((a, b) => (a.joined_at < b.joined_at ? 1 : -1));
}

export function getRemoteRoom(roomId: string): RemoteRoom | null {
  const all = listRemoteRooms();
  return all.find((r) => r.room_id === roomId) ?? null;
}
