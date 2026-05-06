// Multi-token room config tests. Each test runs against an isolated $HOME so
// the singleton doesn't pick up the developer's real ~/.ant/config.json. We
// call config._resetForTest() between runs to re-read against the new HOME —
// bun's vitest shim doesn't ship vi.resetModules() so module-cache busting is
// not portable here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { RoomTokenInfo } from '../cli/lib/config.js';

let homeDir: string;
let configPath: string;

function token(over: Partial<RoomTokenInfo>): RoomTokenInfo {
  return {
    token: 't-secret',
    token_id: 'tok-1',
    invite_id: 'inv-1',
    room_id: 'room-1',
    kind: 'cli',
    handle: '@james',
    joined_at: '2026-05-05T00:00:00Z',
    server_url: 'https://localhost:6458',
    ...over,
  };
}

async function freshConfig() {
  const { config } = await import('../cli/lib/config.js');
  config._resetForTest();
  return config;
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'ant-config-test-'));
  process.env.HOME = homeDir;
  configPath = join(homeDir, '.ant', 'config.json');
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe('config — multi-token room storage', () => {
  it('round-trips a single token under one handle', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@james' }));
    const got = config.getRoomToken('room-1');
    expect(got?.token).toBe('t-secret');
    expect(got?.handle).toBe('@james');
  });

  it('stores multiple handles per room and resolves each by name', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@james', token: 't-james' }));
    config.setRoomToken('room-1', token({ handle: '@jamess', token: 't-jamess' }));
    expect(config.getRoomToken('room-1', '@james')?.token).toBe('t-james');
    expect(config.getRoomToken('room-1', '@jamess')?.token).toBe('t-jamess');
  });

  it('most recently set handle becomes the default', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@james', token: 't-james' }));
    config.setRoomToken('room-1', token({ handle: '@jamess', token: 't-jamess' }));
    // No handle → default → most recent (@jamess)
    expect(config.getRoomToken('room-1')?.token).toBe('t-jamess');
  });

  it('treats handles without leading @ as @-prefixed for lookup', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@james' }));
    expect(config.getRoomToken('room-1', 'james')?.token).toBe('t-secret');
  });

  it('migrates legacy single-token row on read (no write needed)', async () => {
    // Seed the config file with the pre-multi-token shape.
    mkdirSync(join(homeDir, '.ant'), { recursive: true });
    const legacy = {
      tokens: { 'room-legacy': token({ handle: '@stevo', token: 't-legacy' }) },
    };
    writeFileSync(configPath, JSON.stringify(legacy));
    const config = await freshConfig();
    const got = config.getRoomToken('room-legacy');
    expect(got?.token).toBe('t-legacy');
    expect(got?.handle).toBe('@stevo');
  });

  it('legacy row migrates to byHandle shape on the next write', async () => {
    mkdirSync(join(homeDir, '.ant'), { recursive: true });
    const legacy = {
      tokens: { 'room-legacy': token({ handle: '@stevo', token: 't-legacy' }) },
    };
    writeFileSync(configPath, JSON.stringify(legacy));
    const config = await freshConfig();
    config.setRoomToken('room-legacy', token({ handle: '@stevo', token: 't-legacy-rotated' }));
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(raw.tokens['room-legacy'].byHandle['@stevo'].token).toBe('t-legacy-rotated');
    expect(raw.tokens['room-legacy'].default_handle).toBe('@stevo');
  });

  it('listRoomTokens returns every handle as an array per room', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@a', token: 't-a' }));
    config.setRoomToken('room-1', token({ handle: '@b', token: 't-b' }));
    config.setRoomToken('room-2', token({ handle: '@c', token: 't-c' }));
    const list = config.listRoomTokens();
    expect(list['room-1'].map(t => t.token).sort()).toEqual(['t-a', 't-b']);
    expect(list['room-2'].map(t => t.token)).toEqual(['t-c']);
  });

  it('listRoomHandles returns the default first', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@a' }));
    config.setRoomToken('room-1', token({ handle: '@b' }));
    // @b is most recent so it's default
    const handles = config.listRoomHandles('room-1');
    expect(handles[0]).toBe('@b');
    expect(handles.sort()).toEqual(['@a', '@b']);
  });

  it('removeRoomToken with a handle deletes only that handle', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@a', token: 't-a' }));
    config.setRoomToken('room-1', token({ handle: '@b', token: 't-b' }));
    config.removeRoomToken('room-1', '@a');
    expect(config.getRoomToken('room-1', '@a')).toBeUndefined();
    expect(config.getRoomToken('room-1', '@b')?.token).toBe('t-b');
  });

  it('removeRoomToken without a handle drops the entire room entry', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@a' }));
    config.setRoomToken('room-1', token({ handle: '@b' }));
    config.removeRoomToken('room-1');
    expect(config.getRoomToken('room-1')).toBeUndefined();
    expect(config.listRoomTokens()['room-1']).toBeUndefined();
  });

  it('removing the default handle promotes a remaining one', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: '@a', token: 't-a' }));
    config.setRoomToken('room-1', token({ handle: '@b', token: 't-b' }));
    // @b is default; remove it and @a should be addressable as the default
    config.removeRoomToken('room-1', '@b');
    expect(config.getRoomToken('room-1')?.token).toBe('t-a');
  });

  it('handles a token with handle: null (joined without --handle)', async () => {
    const config = await freshConfig();
    config.setRoomToken('room-1', token({ handle: null, token: 't-anon' }));
    expect(config.getRoomToken('room-1')?.token).toBe('t-anon');
    // null/undefined handle on read → returns the default
    expect(config.getRoomToken('room-1', undefined)?.token).toBe('t-anon');
  });
});

describe('joinRoom — parseShareString export', () => {
  it('parseShareString is importable from cli/commands/joinRoom', async () => {
    const mod = await import('../cli/commands/joinRoom.js');
    expect(typeof mod.parseShareString).toBe('function');
    const parsed = mod.parseShareString('ant://example.com/r/room-x?invite=inv-y');
    expect(parsed.serverUrl).toBe('https://example.com');
    expect(parsed.roomId).toBe('room-x');
    expect(parsed.inviteId).toBe('inv-y');
  });

  it('parseShareString accepts ant+http for explicit HTTP override', async () => {
    const { parseShareString } = await import('../cli/commands/joinRoom.js');
    const parsed = parseShareString('ant+http://lan.host:6458/r/room-q?invite=inv-z');
    expect(parsed.serverUrl).toBe('http://lan.host:6458');
  });

  it('parseShareString throws on missing invite query', async () => {
    const { parseShareString } = await import('../cli/commands/joinRoom.js');
    expect(() => parseShareString('ant://example.com/r/room-x?other=1')).toThrow(/invite/);
  });
});
