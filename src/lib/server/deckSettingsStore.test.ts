import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import {
  readDeckSettings,
  writeDeckSettings,
  deckRootsResolved,
  readRoomOverrides
} from './deckSettingsStore';

let scratchDir = '';
let settingsFile = '';

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-deck-settings-'));
  settingsFile = join(scratchDir, 'deck-settings.json');
});

afterEach(() => {
  try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('readDeckSettings', () => {
  it('returns empty roots when file absent (not an error)', () => {
    const result = readDeckSettings(settingsFile);
    expect(result.decksRoots).toEqual([]);
  });

  it('returns parsed roots from a valid file', () => {
    writeFileSync(settingsFile, JSON.stringify({ decksRoots: ['/a/b', '/c/d'] }), 'utf8');
    const result = readDeckSettings(settingsFile);
    expect(result.decksRoots).toEqual(['/a/b', '/c/d']);
  });

  it('treats malformed JSON as empty (never strand the operator)', () => {
    writeFileSync(settingsFile, 'not json {{{', 'utf8');
    expect(readDeckSettings(settingsFile).decksRoots).toEqual([]);
  });

  it('filters out non-string + empty-string entries', () => {
    writeFileSync(settingsFile,
      JSON.stringify({ decksRoots: ['/ok', '', null, 42, '/also-ok'] }), 'utf8');
    expect(readDeckSettings(settingsFile).decksRoots).toEqual(['/ok', '/also-ok']);
  });
});

describe('writeDeckSettings', () => {
  it('writes the file (creates parent dir if missing)', () => {
    const nested = join(scratchDir, 'a', 'b', 'deck-settings.json');
    expect(existsSync(nested)).toBe(false);
    writeDeckSettings({ decksRoots: ['/x/y'] }, nested);
    expect(existsSync(nested)).toBe(true);
    expect(JSON.parse(readFileSync(nested, 'utf8'))).toEqual({ decksRoots: ['/x/y'], roomOverrides: {} });
  });

  it('trims whitespace + drops empty entries', () => {
    writeDeckSettings({ decksRoots: ['  /a/b  ', '', '   ', '/c/d'] }, settingsFile);
    expect(readDeckSettings(settingsFile).decksRoots).toEqual(['/a/b', '/c/d']);
  });

  it('preserves JWPK Dropbox-style path with spaces', () => {
    const jwpkPath = '/Users/you/Dropbox/Decks/ANTdecks';
    writeDeckSettings({ decksRoots: [jwpkPath] }, settingsFile);
    const re = readDeckSettings(settingsFile);
    expect(re.decksRoots).toEqual([jwpkPath]);
  });

  it('rejects non-array input', () => {
    expect(() => writeDeckSettings({ decksRoots: 'oops' }, settingsFile))
      .toThrow(/must be an array/);
  });

  it('round-trips empty roots cleanly', () => {
    writeDeckSettings({ decksRoots: [] }, settingsFile);
    expect(readDeckSettings(settingsFile).decksRoots).toEqual([]);
  });
});

describe('roomOverrides', () => {
  it('round-trips a room→root map cleanly', () => {
    writeDeckSettings({
      decksRoots: ['/global/default'],
      roomOverrides: {
        'room-project': '/Users/you/Dropbox/ProjectBoard',
        'room-internal': '/Users/you/Dropbox/InternalDecks'
      }
    }, settingsFile);
    const overrides = readRoomOverrides(settingsFile);
    expect(overrides['room-project']).toBe('/Users/you/Dropbox/ProjectBoard');
    expect(overrides['room-internal']).toBe('/Users/you/Dropbox/InternalDecks');
  });

  it('preserves existing roomOverrides when caller updates decksRoots without specifying overrides', () => {
    writeDeckSettings({
      decksRoots: ['/r1'],
      roomOverrides: { 'r1': '/path1' }
    }, settingsFile);
    // Settings UI write path doesn't pass roomOverrides — must preserve.
    writeDeckSettings({ decksRoots: ['/r1', '/r2'] }, settingsFile);
    expect(readRoomOverrides(settingsFile)).toEqual({ 'r1': '/path1' });
  });

  it('explicit empty roomOverrides clears the map', () => {
    writeDeckSettings({ decksRoots: [], roomOverrides: { 'r1': '/p1' } }, settingsFile);
    writeDeckSettings({ decksRoots: [], roomOverrides: {} }, settingsFile);
    expect(readRoomOverrides(settingsFile)).toEqual({});
  });

  it('rejects non-object roomOverrides', () => {
    expect(() => writeDeckSettings(
      { decksRoots: [], roomOverrides: 'oops' as unknown as Record<string, string> },
      settingsFile
    )).toThrow(/must be an object/);
    expect(() => writeDeckSettings(
      { decksRoots: [], roomOverrides: ['array'] as unknown as Record<string, string> },
      settingsFile
    )).toThrow(/must be an object/);
  });

  it('filters out empty room ids + empty paths', () => {
    writeDeckSettings({
      decksRoots: [],
      roomOverrides: { '': '/path', 'good': '', 'also-good': '/real-path' }
    }, settingsFile);
    expect(readRoomOverrides(settingsFile)).toEqual({ 'also-good': '/real-path' });
  });

  it('returns empty object when file absent', () => {
    expect(readRoomOverrides(settingsFile)).toEqual({});
  });
});

describe('deckRootsResolved', () => {
  it('merges env + file + fallbacks in that order, deduped', () => {
    writeDeckSettings({ decksRoots: ['/file-a', '/file-b'] }, settingsFile);
    const home = '/tmp/test-home';
    const env = { ANT_BUILT_DECKS_ROOTS: `/env-a${delimiter}/env-b` } as NodeJS.ProcessEnv;
    const result = deckRootsResolved(env, home, settingsFile);
    expect(result).toEqual([
      '/env-a', '/env-b',
      '/file-a', '/file-b',
      join(home, 'CascadeProjects', 'ANT-Decks'),
      join(home, 'CascadeProjects', 'ANT-Open-Slide')
    ]);
  });

  it('dedupes when env + file share an entry', () => {
    writeDeckSettings({ decksRoots: ['/shared', '/file-only'] }, settingsFile);
    const env = { ANT_BUILT_DECKS_ROOTS: '/shared' } as NodeJS.ProcessEnv;
    const result = deckRootsResolved(env, '/tmp/home', settingsFile);
    expect(result[0]).toBe('/shared');
    expect(result.indexOf('/shared')).toBe(result.lastIndexOf('/shared'));
    expect(result).toContain('/file-only');
  });

  it('works with empty env (file + fallbacks)', () => {
    writeDeckSettings({ decksRoots: ['/file-only'] }, settingsFile);
    const result = deckRootsResolved({}, '/tmp/h', settingsFile);
    expect(result[0]).toBe('/file-only');
    expect(result[1]).toBe('/tmp/h/CascadeProjects/ANT-Decks');
  });

  it('works with no file (env + fallbacks)', () => {
    const env = { ANT_BUILT_DECKS_ROOTS: '/env-only' } as NodeJS.ProcessEnv;
    const result = deckRootsResolved(env, '/tmp/h', settingsFile);
    expect(result[0]).toBe('/env-only');
    expect(result[1]).toBe('/tmp/h/CascadeProjects/ANT-Decks');
  });

  it('JWPK Dropbox path-with-spaces survives the merge', () => {
    const jwpkPath = '/Users/you/Dropbox/Decks/ANTdecks';
    writeDeckSettings({ decksRoots: [jwpkPath] }, settingsFile);
    const result = deckRootsResolved({}, '/Users/you', settingsFile);
    expect(result[0]).toBe(jwpkPath);
  });
});
