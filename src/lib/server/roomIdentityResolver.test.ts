import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createSession } from './antSessionStore';
import { createRoomHandleLease, retireRoomHandleLease } from './roomHandleLeaseStore';
import {
  resolveHandleToSession,
  resolveCurrentOwner,
  isCurrentOwner
} from './roomIdentityResolver';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;
const ROOM = 'room-A2';

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-a2-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('roomIdentityResolver (A2) — @handle -> lease -> durable session', () => {
  it('resolves a handle to its current owning session (the join/post/route hot path)', () => {
    const s = createSession({ kind: 'local-cli', label: 'auto:speedy' });
    createRoomHandleLease({ roomId: ROOM, sessionId: s.id, handle: 'speedy', activeFromMs: 1000 });

    const resolved = resolveCurrentOwner(ROOM, 'speedy');
    expect(resolved).not.toBeNull();
    expect(resolved!.session.id).toBe(s.id);
    expect(resolved!.lease.sessionId).toBe(s.id);
    expect(resolved!.session.label).toBe('auto:speedy');
  });

  it('resolves the RIGHT owner at a point in time — the @name#1 history, one code path', () => {
    const a = createSession({ kind: 'local-cli', label: 'first-owner' });
    const b = createSession({ kind: 'local-cli', label: 'second-owner' });

    // @speedy held by A from t=1000, retired at t=2000, then held by B from t=2000.
    createRoomHandleLease({ roomId: ROOM, sessionId: a.id, handle: 'speedy', activeFromMs: 1000 });
    retireRoomHandleLease({ roomId: ROOM, sessionId: a.id, activeUntilMs: 2000 });
    createRoomHandleLease({ roomId: ROOM, sessionId: b.id, handle: 'speedy', activeFromMs: 2000 });

    // A post written at t=1500 must attribute to A, forever — even though B
    // owns @speedy now. That's the render-rule's backing query.
    expect(resolveHandleToSession(ROOM, 'speedy', 1500)!.session.id).toBe(a.id);
    // A post written at t=2500 attributes to B.
    expect(resolveHandleToSession(ROOM, 'speedy', 2500)!.session.id).toBe(b.id);
    // Current owner is B.
    expect(resolveCurrentOwner(ROOM, 'speedy')!.session.id).toBe(b.id);
  });

  it('isCurrentOwner gates posting on the durable session, not pid', () => {
    const a = createSession({ kind: 'local-cli', label: 'a' });
    const b = createSession({ kind: 'local-cli', label: 'b' });
    createRoomHandleLease({ roomId: ROOM, sessionId: a.id, handle: 'speedy', activeFromMs: 1 });

    expect(isCurrentOwner(ROOM, 'speedy', a.id)).toBe(true);
    expect(isCurrentOwner(ROOM, 'speedy', b.id)).toBe(false);
  });

  it('returns null when no one holds the handle (no throw)', () => {
    expect(resolveCurrentOwner(ROOM, 'nobody')).toBeNull();
    expect(isCurrentOwner(ROOM, 'nobody', 'whoever')).toBe(false);
  });
});
