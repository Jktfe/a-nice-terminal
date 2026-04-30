import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const CONFIG_DIR = join(process.env.HOME || '/tmp', '.ant');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

let _config: Record<string, any> = {};

function load() {
  if (existsSync(CONFIG_FILE)) {
    try { _config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
  }
  return _config;
}

function save() {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2));
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
}

export const config = {
  get(key: string): string | undefined { return _config[key]; },
  set(key: string, value: string) { _config[key] = value; save(); },
  getAll() { return { ..._config }; },
  path: CONFIG_FILE,
  setRoomToken(roomId: string, info: RoomTokenInfo) {
    if (!_config.tokens || typeof _config.tokens !== 'object') _config.tokens = {};
    _config.tokens[roomId] = info;
    save();
  },
  getRoomToken(roomId: string): RoomTokenInfo | undefined {
    return _config.tokens?.[roomId];
  },
  removeRoomToken(roomId: string) {
    if (_config.tokens && typeof _config.tokens === 'object') {
      delete _config.tokens[roomId];
      save();
    }
  },
  listRoomTokens(): Record<string, RoomTokenInfo> {
    return { ...(_config.tokens || {}) };
  },
};
