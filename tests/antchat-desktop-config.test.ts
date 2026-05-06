// Tests for antchat/lib/desktop-config.ts.
//
// We avoid touching the real ~/Library/.../claude_desktop_config.json — the
// helpers all accept an explicit path, so each test points them at a
// tmpdir-scoped fixture.

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  readDesktopConfig,
  writeDesktopConfig,
  upsertServer,
  removeServer,
  defaultServerName,
  desktopConfigPath,
} from '../antchat/lib/desktop-config.js';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'antchat-desktop-'));
  path = join(dir, 'claude_desktop_config.json');
});

describe('desktop-config IO', () => {
  it('returns {} when the config file is missing', () => {
    expect(readDesktopConfig(path)).toEqual({});
  });

  it('returns {} when the config file is empty', () => {
    writeFileSync(path, '', 'utf8');
    expect(readDesktopConfig(path)).toEqual({});
  });

  it('throws a useful error on malformed JSON', () => {
    writeFileSync(path, '{ not json', 'utf8');
    expect(() => readDesktopConfig(path)).toThrowError(/Failed to parse/);
  });

  it('round-trips through write+read with trailing newline', () => {
    writeDesktopConfig({ mcpServers: { foo: { command: '/bin/foo' } }, somethingElse: 1 }, path);
    const raw = readFileSync(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(readDesktopConfig(path)).toEqual({
      mcpServers: { foo: { command: '/bin/foo' } },
      somethingElse: 1,
    });
  });
});

describe('upsertServer', () => {
  it('creates mcpServers when missing', () => {
    const next = upsertServer({}, 'antchat-abc', { command: '/usr/local/bin/antchat', args: ['mcp', 'serve', 'abc'] });
    expect(next.mcpServers).toEqual({ 'antchat-abc': { command: '/usr/local/bin/antchat', args: ['mcp', 'serve', 'abc'] } });
  });

  it('preserves unrelated mcpServers entries', () => {
    const before = { mcpServers: { existing: { command: '/bin/x' } } };
    const next = upsertServer(before, 'antchat-xyz', { command: '/bin/y' });
    expect(next.mcpServers).toEqual({
      existing: { command: '/bin/x' },
      'antchat-xyz': { command: '/bin/y' },
    });
    expect(next).not.toBe(before);
    expect(next.mcpServers).not.toBe(before.mcpServers);
  });

  it('overwrites an existing entry with the same name', () => {
    const before = { mcpServers: { 'antchat-xyz': { command: '/bin/old' } } };
    const next = upsertServer(before, 'antchat-xyz', { command: '/bin/new' });
    expect(next.mcpServers!['antchat-xyz']).toEqual({ command: '/bin/new' });
  });

  it('preserves other top-level keys verbatim', () => {
    const before = { mcpServers: {}, theme: 'dark', recentChats: ['a', 'b'] };
    const next = upsertServer(before, 'foo', { command: '/x' });
    expect(next.theme).toBe('dark');
    expect(next.recentChats).toEqual(['a', 'b']);
  });
});

describe('removeServer', () => {
  it('returns removed=false when the entry is absent', () => {
    const { config, removed } = removeServer({ mcpServers: { other: { command: '/o' } } }, 'antchat-abc');
    expect(removed).toBe(false);
    expect(config.mcpServers).toEqual({ other: { command: '/o' } });
  });

  it('returns removed=true and a new object when the entry exists', () => {
    const before = { mcpServers: { 'antchat-abc': { command: '/x' }, other: { command: '/o' } } };
    const { config, removed } = removeServer(before, 'antchat-abc');
    expect(removed).toBe(true);
    expect(config.mcpServers).toEqual({ other: { command: '/o' } });
    expect(config.mcpServers).not.toBe(before.mcpServers);
  });

  it('handles missing mcpServers without throwing', () => {
    const { config, removed } = removeServer({}, 'antchat-abc');
    expect(removed).toBe(false);
    expect(config).toEqual({});
  });
});

describe('defaultServerName', () => {
  it('prefixes the room id with antchat-', () => {
    expect(defaultServerName('abc123')).toBe('antchat-abc123');
  });
});

describe('desktopConfigPath', () => {
  it('returns a path inside the user home directory', () => {
    const p = desktopConfigPath();
    expect(p.endsWith('claude_desktop_config.json')).toBe(true);
    expect(p.length).toBeGreaterThan('claude_desktop_config.json'.length);
  });
});

describe('writeDesktopConfig', () => {
  it('creates the parent directory if it does not exist', () => {
    const nested = join(dir, 'nested', 'sub', 'claude_desktop_config.json');
    writeDesktopConfig({ mcpServers: { foo: { command: '/x' } } }, nested);
    expect(existsSync(nested)).toBe(true);
    expect(readDesktopConfig(nested)).toEqual({ mcpServers: { foo: { command: '/x' } } });
  });
});
