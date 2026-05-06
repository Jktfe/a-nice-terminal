import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Paths derive from $HOME at load() time, not module import, so tests can swap
// HOME between runs and call _resetForTest() to re-read against the new path.
let _configDir = join(process.env.HOME || '/tmp', '.ant');
let _configFile = join(_configDir, 'config.json');

let _config: Record<string, any> = {};

function load() {
  _configDir = join(process.env.HOME || '/tmp', '.ant');
  _configFile = join(_configDir, 'config.json');
  _config = {};
  if (existsSync(_configFile)) {
    try { _config = JSON.parse(readFileSync(_configFile, 'utf-8')); } catch {}
  }
  return _config;
}

function save() {
  mkdirSync(_configDir, { recursive: true });
  writeFileSync(_configFile, JSON.stringify(_config, null, 2));
}

load();

export interface RoomTokenInfo {
  token: string;
  token_id: string;
  invite_id: string;
  room_id: string;
  kind: string;
  handle: string | null;
  joined_at: string;
  // Server hosting this room. Optional for backwards compat with tokens stored
  // before this field existed — readers should fall back to top-level config.serverUrl.
  server_url?: string;
  // Optional human label set via 'ant join-room --label'.
  label?: string;
}

// Multi-token room entry. Legacy single-token rows (RoomTokenInfo at the top
// level of tokens[roomId]) are detected on read and migrated on the next write.
export interface RoomTokenBundle {
  default_handle: string;            // key into byHandle; sentinel below if no handle
  byHandle: Record<string, RoomTokenInfo>;
}

const NO_HANDLE_KEY = '__nohandle__';

function handleKey(handle: string | null | undefined): string {
  return handle && handle.startsWith('@') ? handle
    : handle ? `@${handle}`
    : NO_HANDLE_KEY;
}

function isLegacyEntry(v: unknown): v is RoomTokenInfo {
  return !!v && typeof v === 'object' && typeof (v as any).token === 'string';
}

function normaliseEntry(v: unknown): RoomTokenBundle | null {
  if (!v || typeof v !== 'object') return null;
  if (isLegacyEntry(v)) {
    const key = handleKey(v.handle);
    return { default_handle: key, byHandle: { [key]: v } };
  }
  if ('byHandle' in v && typeof (v as any).byHandle === 'object') {
    const bundle = v as RoomTokenBundle;
    if (!bundle.default_handle || !bundle.byHandle[bundle.default_handle]) {
      const first = Object.keys(bundle.byHandle)[0];
      if (first) return { default_handle: first, byHandle: bundle.byHandle };
      return null;
    }
    return bundle;
  }
  return null;
}

export const config = {
  get(key: string): string | undefined { return _config[key]; },
  set(key: string, value: string) { _config[key] = value; save(); },
  getAll() { return { ..._config }; },
  get path() { return _configFile; },
  // Test-only: re-read $HOME and reload the config file. The bun test runner
  // doesn't ship vi.resetModules(), so we expose an explicit reset rather than
  // relying on module-cache busting in tests/cli-config.test.ts.
  _resetForTest() { load(); },
  // Upsert one room+handle pair. The most recently set handle becomes the
  // room's default for subsequent getRoomToken(roomId) calls; pass an explicit
  // handle to getRoomToken to address a non-default identity.
  setRoomToken(roomId: string, info: RoomTokenInfo) {
    if (!_config.tokens || typeof _config.tokens !== 'object') _config.tokens = {};
    const key = handleKey(info.handle);
    const existing = normaliseEntry(_config.tokens[roomId]);
    const bundle: RoomTokenBundle = existing ?? { default_handle: key, byHandle: {} };
    bundle.byHandle[key] = info;
    bundle.default_handle = key;
    _config.tokens[roomId] = bundle;
    save();
  },
  // Resolve a room's token. With no handle, returns the room's default. With a
  // handle, returns that handle's token or undefined.
  getRoomToken(roomId: string, handle?: string | null): RoomTokenInfo | undefined {
    const bundle = normaliseEntry(_config.tokens?.[roomId]);
    if (!bundle) return undefined;
    if (handle === undefined) return bundle.byHandle[bundle.default_handle];
    return bundle.byHandle[handleKey(handle)];
  },
  // Remove one handle's token, or — if no handle given — the entire room entry.
  // When the last handle is removed, the room entry is dropped. If the removed
  // handle was the default, an arbitrary remaining handle is promoted.
  removeRoomToken(roomId: string, handle?: string | null) {
    if (!_config.tokens || typeof _config.tokens !== 'object') return;
    if (handle === undefined) {
      delete _config.tokens[roomId];
      save();
      return;
    }
    const bundle = normaliseEntry(_config.tokens[roomId]);
    if (!bundle) return;
    const key = handleKey(handle);
    delete bundle.byHandle[key];
    const remaining = Object.keys(bundle.byHandle);
    if (remaining.length === 0) {
      delete _config.tokens[roomId];
    } else {
      if (bundle.default_handle === key) bundle.default_handle = remaining[0];
      _config.tokens[roomId] = bundle;
    }
    save();
  },
  // Returns every stored token, grouped by room. Useful for ant rooms / status
  // commands and for verifier scripts that want to enumerate all identities.
  listRoomTokens(): Record<string, RoomTokenInfo[]> {
    const out: Record<string, RoomTokenInfo[]> = {};
    for (const [roomId, raw] of Object.entries(_config.tokens || {})) {
      const bundle = normaliseEntry(raw);
      if (!bundle) continue;
      out[roomId] = Object.values(bundle.byHandle);
    }
    return out;
  },
  // Inspection helper: which handles does this client hold for a given room?
  // Returns [] for unknown rooms. The first entry is always the default handle.
  listRoomHandles(roomId: string): string[] {
    const bundle = normaliseEntry(_config.tokens?.[roomId]);
    if (!bundle) return [];
    const all = Object.keys(bundle.byHandle);
    if (!bundle.default_handle) return all;
    return [bundle.default_handle, ...all.filter(h => h !== bundle.default_handle)];
  },
};
