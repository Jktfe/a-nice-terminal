// Read/write Claude Desktop's mcpServers config without a 3rd-party JSON
// patch library. The file is hand-edited by users so we MUST round-trip
// unrelated keys verbatim and never reformat existing whitespace beyond
// what JSON.parse/JSON.stringify can preserve.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';

export interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface DesktopConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/** Best-effort lookup of Claude Desktop's config path on the current host. */
export function desktopConfigPath(): string {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32': {
      const appdata = process.env.APPDATA || join(home, 'AppData', 'Roaming');
      return join(appdata, 'Claude', 'claude_desktop_config.json');
    }
    default:
      // Linux: respect XDG_CONFIG_HOME with the standard fallback.
      return join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json');
  }
}

export function readDesktopConfig(path: string = desktopConfigPath()): DesktopConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  if (!raw.trim()) return {};
  try { return JSON.parse(raw) as DesktopConfig; }
  catch (err: any) {
    throw new Error(`Failed to parse ${path}: ${err.message}`);
  }
}

export function writeDesktopConfig(cfg: DesktopConfig, path: string = desktopConfigPath()): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Trailing newline is the convention Claude Desktop ships its own template
  // with — preserve it so a diff-tool comparison stays clean.
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** Insert or replace an MCP server entry; returns the updated config. */
export function upsertServer(cfg: DesktopConfig, name: string, entry: McpServerEntry): DesktopConfig {
  const next: DesktopConfig = { ...cfg };
  const servers = { ...(cfg.mcpServers ?? {}) };
  servers[name] = entry;
  next.mcpServers = servers;
  return next;
}

/**
 * Remove an MCP server entry. Returns { config, removed } so callers can tell
 * the difference between "removed" and "wasn't there in the first place"
 * without re-reading the file.
 */
export function removeServer(cfg: DesktopConfig, name: string): { config: DesktopConfig; removed: boolean } {
  if (!cfg.mcpServers || !(name in cfg.mcpServers)) {
    return { config: cfg, removed: false };
  }
  const servers = { ...cfg.mcpServers };
  delete servers[name];
  const next: DesktopConfig = { ...cfg, mcpServers: servers };
  return { config: next, removed: true };
}

/**
 * Default name for the proxy entry — `antchat-<roomId>`. Stable so reinstall
 * idempotently overwrites the same key.
 */
export function defaultServerName(roomId: string): string {
  return `antchat-${roomId}`;
}
