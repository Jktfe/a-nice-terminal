/**
 * fileRefsStore — store-level vitest coverage for the file-refs / "flag"
 * subsystem (JWPK 2026-05-16).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addFileRef,
  getFileRef,
  listFileRefsByPath,
  listFileRefsForScope,
  removeFileRef,
  resetFileRefsStoreForTests
} from './fileRefsStore';

describe('fileRefsStore', () => {
  beforeEach(() => {
    resetFileRefsStoreForTests();
  });

  it('addFileRef returns a populated ref with a uuid id and matching fields', () => {
    const ref = addFileRef({
      filePath: './src/lib/server/fileRefsStore.ts',
      scope: 'terminal',
      scopeTarget: 't_codex_abc123',
      label: 'store',
      description: 'main store file',
      flaggedBy: '@cli'
    });
    expect(ref.id.length).toBeGreaterThan(0);
    expect(ref.filePath).toBe('./src/lib/server/fileRefsStore.ts');
    expect(ref.scope).toBe('terminal');
    expect(ref.scopeTarget).toBe('t_codex_abc123');
    expect(ref.label).toBe('store');
    expect(ref.description).toBe('main store file');
    expect(ref.flaggedBy).toBe('@cli');
    expect(ref.flaggedAtMs).toBeGreaterThan(0);
  });

  it('addFileRef rejects an empty file_path', () => {
    expect(() =>
      addFileRef({ filePath: '   ', scope: 'global' })
    ).toThrow(/file_path/);
  });

  it('addFileRef requires scope_target for terminal and chatroom scopes', () => {
    expect(() =>
      addFileRef({ filePath: './x.ts', scope: 'terminal', scopeTarget: '' })
    ).toThrow(/scope_target/);
    expect(() =>
      addFileRef({ filePath: './x.ts', scope: 'chatroom', scopeTarget: null })
    ).toThrow(/scope_target/);
  });

  it('addFileRef allows global scope without scope_target', () => {
    const ref = addFileRef({ filePath: './CHANGELOG.md', scope: 'global' });
    expect(ref.scope).toBe('global');
    expect(ref.scopeTarget).toBeNull();
  });

  it('listFileRefsForScope filters by scope+target and orders newest first', () => {
    const older = addFileRef({
      filePath: 'a.ts',
      scope: 'terminal',
      scopeTarget: 't_one',
      nowMs: 1000
    });
    const newer = addFileRef({
      filePath: 'b.ts',
      scope: 'terminal',
      scopeTarget: 't_one',
      nowMs: 2000
    });
    addFileRef({
      filePath: 'c.ts',
      scope: 'terminal',
      scopeTarget: 't_two',
      nowMs: 3000
    });
    const forTerminalOne = listFileRefsForScope('terminal', 't_one');
    expect(forTerminalOne.map((r) => r.id)).toEqual([newer.id, older.id]);
    const forTerminalTwo = listFileRefsForScope('terminal', 't_two');
    expect(forTerminalTwo).toHaveLength(1);
    expect(forTerminalTwo[0].filePath).toBe('c.ts');
  });

  it('listFileRefsForScope global ignores scope_target argument', () => {
    addFileRef({ filePath: 'g1.md', scope: 'global', nowMs: 1000 });
    addFileRef({ filePath: 'g2.md', scope: 'global', nowMs: 2000 });
    const refs = listFileRefsForScope('global');
    expect(refs).toHaveLength(2);
    expect(refs[0].filePath).toBe('g2.md');
  });

  it('listFileRefsByPath returns every ref pointing at the given path', () => {
    addFileRef({ filePath: 'shared.ts', scope: 'terminal', scopeTarget: 't_one', nowMs: 1000 });
    addFileRef({ filePath: 'shared.ts', scope: 'chatroom', scopeTarget: 'room_a', nowMs: 2000 });
    addFileRef({ filePath: 'other.ts', scope: 'global', nowMs: 3000 });
    const refs = listFileRefsByPath('shared.ts');
    expect(refs).toHaveLength(2);
    expect(new Set(refs.map((r) => r.scope))).toEqual(new Set(['terminal', 'chatroom']));
  });

  it('removeFileRef deletes the row and returns true; second remove returns false', () => {
    const ref = addFileRef({ filePath: 'x.ts', scope: 'global' });
    expect(removeFileRef(ref.id)).toBe(true);
    expect(getFileRef(ref.id)).toBeUndefined();
    expect(removeFileRef(ref.id)).toBe(false);
  });

  it('getFileRef returns undefined for unknown ids', () => {
    expect(getFileRef('does-not-exist')).toBeUndefined();
  });
});
