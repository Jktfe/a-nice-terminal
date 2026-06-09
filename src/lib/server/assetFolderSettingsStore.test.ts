import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import {
  readAssetFolderSettings,
  writeAssetFolderSettings,
  assetRootsResolved
} from './assetFolderSettingsStore';

let scratchDir = '';
let settingsFile = '';

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-asset-folders-'));
  settingsFile = join(scratchDir, 'asset-folders.json');
});

afterEach(() => {
  try { rmSync(scratchDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('readAssetFolderSettings', () => {
  it('returns empty roots when file absent (not an error)', () => {
    const result = readAssetFolderSettings(settingsFile);
    expect(result.assetRoots).toEqual([]);
  });

  it('returns parsed roots from a valid file', () => {
    writeFileSync(settingsFile, JSON.stringify({ assetRoots: ['/a/b', '/c/d'] }), 'utf8');
    const result = readAssetFolderSettings(settingsFile);
    expect(result.assetRoots).toEqual(['/a/b', '/c/d']);
  });

  it('treats malformed JSON as empty (never strand the operator)', () => {
    writeFileSync(settingsFile, 'not json {{{', 'utf8');
    expect(readAssetFolderSettings(settingsFile).assetRoots).toEqual([]);
  });

  it('filters out non-string + empty-string entries', () => {
    writeFileSync(settingsFile,
      JSON.stringify({ assetRoots: ['/ok', '', null, 42, '/also-ok'] }), 'utf8');
    expect(readAssetFolderSettings(settingsFile).assetRoots).toEqual(['/ok', '/also-ok']);
  });
});

describe('writeAssetFolderSettings', () => {
  it('writes the file (creates parent dir if missing)', () => {
    const nested = join(scratchDir, 'a', 'b', 'asset-folders.json');
    const result = writeAssetFolderSettings({ assetRoots: ['/x'] }, nested);
    expect(result.assetRoots).toEqual(['/x']);
    expect(existsSync(nested)).toBe(true);
  });

  it('rejects non-array input', () => {
    expect(() => writeAssetFolderSettings(
      { assetRoots: 'not-an-array' as unknown as string[] },
      settingsFile
    )).toThrow(/assetRoots must be an array/);
  });

  it('trims whitespace + drops empty entries', () => {
    const result = writeAssetFolderSettings(
      { assetRoots: ['/a', '  /b  ', '', '   '] },
      settingsFile
    );
    expect(result.assetRoots).toEqual(['/a', '/b']);
  });
});

describe('assetRootsResolved', () => {
  it('merges env var + file + static/ (last) in order, deduped', () => {
    // Use real existing dirs (env and file) so the existsSync guard in the
    // resolver does not drop them. We also use a different second entry in
    // the file so the dedup story is observable.
    const second = mkdtempSync(join(scratchDir, 'second-'));
    writeFileSync(settingsFile, JSON.stringify({ assetRoots: [second] }), 'utf8');
    const env = { ANT_ASSET_ROOTS: scratchDir } as NodeJS.ProcessEnv;
    // cwd = scratchDir: the resolver's staticRoot = join(cwd, 'static') which
    // does not exist under scratchDir, so the static/ fallback is filtered
    // out — leaving env+file in order, deduped.
    const result = assetRootsResolved(env, scratchDir, settingsFile);
    // Env (scratchDir) is first; the file entry (second) is second.
    expect(result[0]).toBe(scratchDir);
    expect(result[1]).toBe(second);
    // Dedup invariant: no entry appears twice.
    expect(new Set(result).size).toBe(result.length);
  });

  it('skips non-existent env roots silently (no throw)', () => {
    const env = { ANT_ASSET_ROOTS: '/does-not-exist-1:/also-missing' } as NodeJS.ProcessEnv;
    const result = assetRootsResolved(env, scratchDir, settingsFile);
    // Both env entries should be filtered out (they don't exist on disk).
    expect(result).not.toContain('/does-not-exist-1');
    expect(result).not.toContain('/also-missing');
  });

  it('empty env + empty file = whatever static/ exists for is the only root', () => {
    const result = assetRootsResolved({}, scratchDir, settingsFile);
    // scratchDir is an empty temp dir — no static/ inside. The resolver
    // includes the static/ candidate (join(scratchDir, 'static')) and
    // it doesn't exist, so it gets skipped. Result is empty.
    expect(result).toEqual([]);
  });
});
