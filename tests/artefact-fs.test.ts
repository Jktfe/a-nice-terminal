// Unit tests for src/lib/server/artefact-fs.ts. These lock in the contract
// that decks.ts (and Wave 2: sheets, docs) rely on. Behaviour is preserved
// from the previous in-decks.ts implementation; existing deck-files.test.ts
// is the integration sibling.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import {
  ALLOWED_HIDDEN_FILES,
  BLOCKED_SEGMENTS,
  assertInside,
  assertNoSymlinkSegments,
  assertSafeDeckSlug,
  cleanDeckPath,
} from '../src/lib/server/artefact-fs.js';

describe('artefact-fs — assertSafeDeckSlug', () => {
  it('accepts alphanumeric, dot, dash, underscore', () => {
    expect(assertSafeDeckSlug('hello-world.v2_3')).toBe('hello-world.v2_3');
  });

  it('rejects slug starting with non-alphanumeric', () => {
    expect(() => assertSafeDeckSlug('-leading')).toThrow(/Invalid deck slug/);
    expect(() => assertSafeDeckSlug('.dotfile')).toThrow(/Invalid deck slug/);
  });

  it('rejects slugs with disallowed characters', () => {
    expect(() => assertSafeDeckSlug('has space')).toThrow(/Invalid deck slug/);
    expect(() => assertSafeDeckSlug('has/slash')).toThrow(/Invalid deck slug/);
    expect(() => assertSafeDeckSlug('has..parent')).not.toThrow(); // dots are fine
  });

  it('rejects very long slugs', () => {
    expect(() => assertSafeDeckSlug('a'.repeat(200))).toThrow(/Invalid deck slug/);
  });
});

describe('artefact-fs — cleanDeckPath', () => {
  it('strips leading slashes and normalises backslashes', () => {
    expect(cleanDeckPath('//folder\\file.md')).toBe('folder/file.md');
  });

  it('rejects paths containing ..', () => {
    expect(() => cleanDeckPath('../escape')).toThrow(/Path traversal/);
    expect(() => cleanDeckPath('a/../escape')).toThrow(/Path traversal/);
    expect(() => cleanDeckPath('..')).toThrow(/Path traversal/);
  });

  it('rejects paths containing control bytes', () => {
    expect(() => cleanDeckPath('foo\x01bar')).toThrow(/invalid bytes/);
    expect(() => cleanDeckPath('foo\x00bar')).toThrow(/invalid bytes/);
  });

  it('rejects paths whose segments are in BLOCKED_SEGMENTS', () => {
    for (const blocked of BLOCKED_SEGMENTS) {
      expect(() => cleanDeckPath(`a/${blocked}/b`)).toThrow(/not editable/);
    }
  });

  it('drops empty and "." segments', () => {
    expect(cleanDeckPath('a//./b')).toBe('a/b');
  });
});

describe('artefact-fs — assertInside', () => {
  it('accepts a path equal to root', () => {
    expect(() => assertInside('/tmp/root', '/tmp/root')).not.toThrow();
  });

  it('accepts a path inside root', () => {
    expect(() => assertInside('/tmp/root', '/tmp/root/sub/file')).not.toThrow();
  });

  it('rejects a sibling path that shares a prefix', () => {
    expect(() => assertInside('/tmp/root', '/tmp/rootother')).toThrow(/escapes/);
  });

  it('rejects a parent escape', () => {
    expect(() => assertInside('/tmp/root', '/tmp/elsewhere')).toThrow(/escapes/);
  });
});

describe('artefact-fs — assertNoSymlinkSegments (filesystem-backed)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ant-artefact-fs-'));
    mkdirSync(join(dir, 'real'), { recursive: true });
    writeFileSync(join(dir, 'real', 'ok.txt'), 'content');
    symlinkSync(join(dir, 'real'), join(dir, 'link'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes a real path with no symlinks', () => {
    expect(() => assertNoSymlinkSegments(dir, 'real/ok.txt')).not.toThrow();
  });

  it('rejects a path that traverses a symlink', () => {
    expect(() => assertNoSymlinkSegments(dir, 'link/ok.txt')).toThrow(/symlinks are not editable/);
  });
});

describe('artefact-fs — exported constants', () => {
  it('BLOCKED_SEGMENTS contains the build-output directories', () => {
    expect(BLOCKED_SEGMENTS.has('.git')).toBe(true);
    expect(BLOCKED_SEGMENTS.has('node_modules')).toBe(true);
    expect(BLOCKED_SEGMENTS.has('.svelte-kit')).toBe(true);
    expect(BLOCKED_SEGMENTS.has('dist')).toBe(true);
  });

  it('ALLOWED_HIDDEN_FILES whitelists .env.example', () => {
    expect(ALLOWED_HIDDEN_FILES.has('.env.example')).toBe(true);
  });
});
