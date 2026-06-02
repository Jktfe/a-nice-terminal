import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { getContextState, markContextSeen, CONTEXT_GAP_MS } from './roomSessionContextStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;
const ROOM = 'r';
const SESS = 's';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-ctx-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('roomSessionContextStore — inject context only when needed', () => {
  it('first contact needs onboarding', () => {
    const s = getContextState(ROOM, SESS, 1_000);
    expect(s.joinedBeforeMs).toBeNull();
    expect(s.needsOnboarding).toBe(true);
  });

  it('immediately after a visit, no onboarding needed', () => {
    markContextSeen(ROOM, SESS, 1_000);
    const s = getContextState(ROOM, SESS, 1_500);
    expect(s.joinedBeforeMs).toBe(1_000);
    expect(s.lastReadAtMs).toBe(1_000);
    expect(s.needsOnboarding).toBe(false);
  });

  it('needs onboarding again after the gap', () => {
    markContextSeen(ROOM, SESS, 1_000);
    const after = getContextState(ROOM, SESS, 1_000 + CONTEXT_GAP_MS + 1);
    expect(after.needsOnboarding).toBe(true);
    expect(after.joinedBeforeMs).toBe(1_000); // still remembers first contact
  });

  it('markContextSeen advances last_read but keeps joined_before (first contact)', () => {
    markContextSeen(ROOM, SESS, 1_000);
    const s = markContextSeen(ROOM, SESS, 5_000);
    expect(s.joinedBeforeMs).toBe(1_000);
    expect(s.lastReadAtMs).toBe(5_000);
    expect(s.needsOnboarding).toBe(false);
  });

  it('is read-only safe — getContextState does not record a visit', () => {
    getContextState(ROOM, SESS, 1_000);
    expect(getContextState(ROOM, SESS, 2_000).joinedBeforeMs).toBeNull(); // still never joined
  });
});
