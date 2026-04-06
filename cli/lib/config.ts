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

export const config = {
  get(key: string): string | undefined { return _config[key]; },
  set(key: string, value: string) { _config[key] = value; save(); },
  getAll() { return { ..._config }; },
};
