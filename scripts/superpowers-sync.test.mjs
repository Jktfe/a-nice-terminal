import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  compareDirectoryTrees,
  hasTreeDrift,
  parseLsRemoteHead,
  validateManifest
} from './superpowers-sync.mjs';

let tempRoots = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'superpowers-sync-test-'));
  tempRoots.push(dir);
  return dir;
}

function write(path, contents) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

afterEach(() => {
  for (const dir of tempRoots) rmSync(dir, { recursive: true, force: true });
  tempRoots = [];
});

describe('superpowers sync helpers', () => {
  it('parses a git ls-remote head line', () => {
    const sha = 'b62616fc12f6a007c6fd5118146821d748da0d33';
    expect(parseLsRemoteHead(`${sha}\trefs/heads/main\n`)).toBe(sha);
    expect(parseLsRemoteHead('not-a-sha\trefs/heads/main\n')).toBeNull();
  });

  it('reports missing, changed, and extra files between trees', () => {
    const root = tempDir();
    const source = join(root, 'source');
    const target = join(root, 'target');
    mkdirSync(source);
    mkdirSync(target);
    write(join(source, 'same.txt'), 'same');
    write(join(source, 'changed.txt'), 'new');
    write(join(source, 'missing.txt'), 'source-only');
    write(join(target, 'same.txt'), 'same');
    write(join(target, 'changed.txt'), 'old');
    write(join(target, 'extra.txt'), 'target-only');

    const result = compareDirectoryTrees(source, target);

    expect(result.sourceMissing).toBe(false);
    expect(result.missing).toEqual(['missing.txt']);
    expect(result.changed).toEqual(['changed.txt']);
    expect(result.extra).toEqual(['extra.txt']);
    expect(hasTreeDrift(result)).toBe(true);
  });

  it('validates the manifest shape before any network or write operation', () => {
    expect(() => validateManifest({
      schema: 1,
      source: {
        repo: 'https://github.com/obra/Superpowers.git',
        branch: 'main',
        pinnedCommit: 'b62616fc12f6a007c6fd5118146821d748da0d33'
      },
      localMirror: '.ant-runtime/superpowers/current',
      syncRoots: [{ name: 'skills', upstream: 'skills', local: 'skills' }]
    })).not.toThrow();

    expect(() => validateManifest({ schema: 1 })).toThrow(/source.repo/);
  });
});
