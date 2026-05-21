/**
 * Tests for the bindings.json reader.
 *
 * Each case configures ANT_ACCOUNT_DIR to a tmpdir, writes (or omits)
 * the bindings.json fixture, and asserts the resolver returns the
 * expected handle list or null.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listBoundHandles, readBindingsForCurrentUser } from './handleBindings';

let scratchDir: string;
let prevAccountDir: string | undefined;

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'ant-bindings-'));
  prevAccountDir = process.env.ANT_ACCOUNT_DIR;
  process.env.ANT_ACCOUNT_DIR = join(scratchDir, 'account');
});

afterEach(() => {
  try {
    rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  if (prevAccountDir === undefined) delete process.env.ANT_ACCOUNT_DIR;
  else process.env.ANT_ACCOUNT_DIR = prevAccountDir;
});

function writeBindings(
  accountId: string,
  deviceId: string,
  handles: string[],
  opts?: { updatedAtMs?: number; mtimeMs?: number }
): void {
  const dir = join(scratchDir, 'account', accountId, 'devices', deviceId);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'bindings.json');
  writeFileSync(
    file,
    JSON.stringify({
      deviceId,
      accountId,
      bindings: handles.map((h) => ({ handle: h, target: 'target' })),
      updatedAtMs: opts?.updatedAtMs ?? Date.now()
    })
  );
  if (opts?.mtimeMs !== undefined) {
    const ms = opts.mtimeMs / 1000;
    utimesSync(file, ms, ms);
  }
}

describe('readBindingsForCurrentUser', () => {
  it('returns null when ANT_ACCOUNT_DIR does not exist', () => {
    process.env.ANT_ACCOUNT_DIR = join(scratchDir, 'definitely-not-here');
    expect(readBindingsForCurrentUser()).toBeNull();
  });

  it('returns the parsed file when one bindings.json exists', () => {
    writeBindings('acct_a', 'dev_a', ['@james']);
    const result = readBindingsForCurrentUser();
    expect(result).not.toBeNull();
    expect(result!.deviceId).toBe('dev_a');
    expect(result!.accountId).toBe('acct_a');
    expect(result!.bindings).toEqual([{ handle: '@james', target: 'target' }]);
  });

  it('skips malformed JSON files', () => {
    const dir = join(scratchDir, 'account', 'acct_bad', 'devices', 'dev_bad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'bindings.json'), '{ this is not valid json');
    expect(readBindingsForCurrentUser()).toBeNull();
  });

  it('skips files with the wrong shape', () => {
    const dir = join(scratchDir, 'account', 'acct_bad', 'devices', 'dev_bad');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'bindings.json'),
      JSON.stringify({ deviceId: 'x', accountId: 'y' /* bindings missing */ })
    );
    expect(readBindingsForCurrentUser()).toBeNull();
  });

  it('picks the most-recently-modified bindings file across accounts', () => {
    writeBindings('acct_old', 'dev_old', ['@old'], { mtimeMs: 1_000_000 });
    writeBindings('acct_new', 'dev_new', ['@new'], { mtimeMs: 2_000_000 });
    const result = readBindingsForCurrentUser();
    expect(result?.deviceId).toBe('dev_new');
  });
});

describe('listBoundHandles', () => {
  it('returns null when no bindings file is readable', () => {
    expect(listBoundHandles()).toBeNull();
  });

  it('returns the deduplicated handle list', () => {
    writeBindings('acct_a', 'dev_a', ['@james', '@james', '@james-bot']);
    const handles = listBoundHandles();
    expect(handles).toEqual(['@james', '@james-bot']);
  });

  it('normalises bare handles (adds @ prefix)', () => {
    writeBindings('acct_a', 'dev_a', ['james', '@bot']);
    const handles = listBoundHandles();
    expect(handles).toEqual(['@james', '@bot']);
  });
});
