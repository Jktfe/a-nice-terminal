/**
 * Tests for persistRoomTokenToConfig + readRoomTokenEntry (0.1.11,
 * xenoCC quickpaste 8729 root-cause fix).
 *
 * All tests scope writes to a per-test scratch HOME via mkdtempSync
 * so they never touch the user's real ~/.ant/config.json.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  persistRoomTokenToConfig,
  readRoomTokenEntry,
  _configFilePathForTests
} from './ant-cli-config-write.mjs';

let scratchHome;

beforeEach(() => {
  scratchHome = mkdtempSync(join(tmpdir(), 'ant-cli-config-write-test-'));
});

afterEach(() => {
  rmSync(scratchHome, { recursive: true, force: true });
});

function seedExistingConfig(initial) {
  const dir = join(scratchHome, '.ant');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(initial, null, 2));
}

describe('persistRoomTokenToConfig', () => {
  it('creates a fresh config.json + .ant directory when neither exists', () => {
    const result = persistRoomTokenToConfig({
      roomId: 'r_fresh',
      tokenSecret: 'tok_fresh_001',
      handle: '@xenoCC',
      serverUrl: 'https://example.com',
      homeDir: scratchHome
    });
    expect(result.ok).toBe(true);
    const entry = readRoomTokenEntry('r_fresh', scratchHome);
    expect(entry).toMatchObject({
      token: 'tok_fresh_001',
      server_url: 'https://example.com',
      default_handle: '@xenoCC',
      byHandle: { '@xenoCC': { token: 'tok_fresh_001' } }
    });
  });

  it('overwrites the flat token when a stale entry already exists (xenoCC May-22 bug case)', () => {
    seedExistingConfig({
      tokens: {
        r_stale: {
          token: 'tok_stale_may22',
          server_url: 'https://example.com',
          byHandle: { '@xenocc': { token: 'tok_stale_may22' } }
        }
      }
    });
    const result = persistRoomTokenToConfig({
      roomId: 'r_stale',
      tokenSecret: 'tok_fresh_today',
      handle: '@xenoCC',
      homeDir: scratchHome
    });
    expect(result.ok).toBe(true);
    const entry = readRoomTokenEntry('r_stale', scratchHome);
    expect(entry?.token).toBe('tok_fresh_today');
    // byHandle for the same handle is also updated
    expect(entry?.byHandle?.['@xenoCC']?.token).toBe('tok_fresh_today');
    // The pre-existing lowercase byHandle entry is preserved verbatim
    expect(entry?.byHandle?.['@xenocc']?.token).toBe('tok_stale_may22');
  });

  it('preserves unrelated rooms\' entries verbatim', () => {
    seedExistingConfig({
      tokens: {
        r_keep: {
          token: 'tok_keep_001',
          server_url: 'https://other.example',
          byHandle: { '@other': { token: 'tok_keep_001' } }
        },
        r_target: { token: 'tok_old_target' }
      },
      serverUrl: 'https://global.example'
    });
    persistRoomTokenToConfig({
      roomId: 'r_target',
      tokenSecret: 'tok_new_target',
      handle: '@me',
      serverUrl: 'https://target.example',
      homeDir: scratchHome
    });
    const raw = JSON.parse(readFileSync(join(scratchHome, '.ant', 'config.json'), 'utf8'));
    expect(raw.tokens.r_keep).toEqual({
      token: 'tok_keep_001',
      server_url: 'https://other.example',
      byHandle: { '@other': { token: 'tok_keep_001' } }
    });
    expect(raw.tokens.r_target.token).toBe('tok_new_target');
    expect(raw.serverUrl).toBe('https://global.example');
  });

  it('writes both flat + byHandle shapes so pre-PR-#68 readers still work', () => {
    persistRoomTokenToConfig({
      roomId: 'r_dual',
      tokenSecret: 'tok_dual',
      handle: '@xenoCC',
      homeDir: scratchHome
    });
    const entry = readRoomTokenEntry('r_dual', scratchHome);
    expect(entry?.token).toBe('tok_dual'); // flat (PR #68 reader)
    expect(entry?.byHandle?.['@xenoCC']?.token).toBe('tok_dual'); // byHandle (legacy)
    expect(entry?.default_handle).toBe('@xenoCC');
  });

  it('omits server_url when not supplied (does not write empty string)', () => {
    persistRoomTokenToConfig({
      roomId: 'r_no_url',
      tokenSecret: 'tok_no_url',
      handle: '@me',
      homeDir: scratchHome
    });
    const entry = readRoomTokenEntry('r_no_url', scratchHome);
    expect(entry?.server_url).toBeUndefined();
  });

  it('normalises handles missing leading @ (writes @x for "x")', () => {
    persistRoomTokenToConfig({
      roomId: 'r_norm',
      tokenSecret: 'tok_norm',
      handle: 'xenoCC',
      homeDir: scratchHome
    });
    const entry = readRoomTokenEntry('r_norm', scratchHome);
    expect(entry?.default_handle).toBe('@xenoCC');
    expect(entry?.byHandle?.['@xenoCC']?.token).toBe('tok_norm');
  });

  it('omits byHandle + default_handle when no handle is supplied', () => {
    persistRoomTokenToConfig({
      roomId: 'r_no_handle',
      tokenSecret: 'tok_no_handle',
      homeDir: scratchHome
    });
    const entry = readRoomTokenEntry('r_no_handle', scratchHome);
    expect(entry?.token).toBe('tok_no_handle');
    expect(entry?.default_handle).toBeUndefined();
    expect(entry?.byHandle).toBeUndefined();
  });

  it('rejects missing roomId / tokenSecret (returns ok:false, never throws)', () => {
    expect(persistRoomTokenToConfig({ roomId: '', tokenSecret: 'x' }).ok).toBe(false);
    expect(persistRoomTokenToConfig({ roomId: 'r_x' }).ok).toBe(false);
    expect(persistRoomTokenToConfig({ roomId: 'r_x', tokenSecret: '' }).ok).toBe(false);
  });

  it('recovers from malformed existing config.json by treating it as empty', () => {
    const dir = join(scratchHome, '.ant');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), 'not json at all{{{');
    const result = persistRoomTokenToConfig({
      roomId: 'r_recover',
      tokenSecret: 'tok_recover',
      handle: '@me',
      homeDir: scratchHome
    });
    expect(result.ok).toBe(true);
    const entry = readRoomTokenEntry('r_recover', scratchHome);
    expect(entry?.token).toBe('tok_recover');
  });

  it('written file advances mtime on a subsequent persist (xenoCC mtime-check is meaningful)', async () => {
    persistRoomTokenToConfig({
      roomId: 'r_mtime',
      tokenSecret: 'tok_v1',
      homeDir: scratchHome
    });
    const path = _configFilePathForTests(scratchHome);
    const firstMtime = statSync(path).mtimeMs;
    // Filesystems may have ms granularity, so wait briefly before the
    // second write to guarantee a strictly-later mtime.
    await new Promise((resolve) => setTimeout(resolve, 12));
    persistRoomTokenToConfig({
      roomId: 'r_mtime',
      tokenSecret: 'tok_v2',
      homeDir: scratchHome
    });
    const secondMtime = statSync(path).mtimeMs;
    expect(secondMtime).toBeGreaterThan(firstMtime);
  });
});

describe('readRoomTokenEntry', () => {
  it('returns null when the config file is missing', () => {
    expect(readRoomTokenEntry('r_missing', scratchHome)).toBeNull();
  });

  it('returns the entry verbatim when present', () => {
    seedExistingConfig({
      tokens: { r_x: { token: 'tok_x', server_url: 'https://x.example' } }
    });
    const entry = readRoomTokenEntry('r_x', scratchHome);
    expect(entry).toEqual({ token: 'tok_x', server_url: 'https://x.example' });
  });

  it('returns null when the room has no entry', () => {
    seedExistingConfig({ tokens: { r_other: { token: 'tok_other' } } });
    expect(readRoomTokenEntry('r_x', scratchHome)).toBeNull();
  });

  it('returns null on malformed config.json (parse failure)', () => {
    const dir = join(scratchHome, '.ant');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), 'garbage');
    expect(readRoomTokenEntry('r_x', scratchHome)).toBeNull();
  });
});
