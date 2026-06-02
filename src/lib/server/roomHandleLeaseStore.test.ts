import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  allocateHandle,
  createRoomHandleLease,
  deriveAvailableRoomHandle,
  findRoomHandleOwnerAtTime,
  retireRoomHandleLease,
  renderRoomHandleSnapshot
} from './roomHandleLeaseStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-handle-lease-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  getIdentityDb();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
});

describe('roomHandleLeaseStore', () => {
  it('enforces one active owner for a room handle', () => {
    createRoomHandleLease({
      roomId: 'room-a',
      sessionId: 'session-1',
      handle: '@fast',
      activeFromMs: 100
    });

    expect(() => createRoomHandleLease({
      roomId: 'room-a',
      sessionId: 'session-2',
      handle: '@fast',
      activeFromMs: 101
    })).toThrow(/active room handle/i);
  });

  it('enforces one active handle per session in a room', () => {
    createRoomHandleLease({
      roomId: 'room-a',
      sessionId: 'session-1',
      handle: '@fast',
      activeFromMs: 100
    });

    expect(() => createRoomHandleLease({
      roomId: 'room-a',
      sessionId: 'session-1',
      handle: '@fast2',
      activeFromMs: 101
    })).toThrow(/session already has an active room handle/i);

    expect(createRoomHandleLease({
      roomId: 'room-b',
      sessionId: 'session-1',
      handle: '@fast',
      activeFromMs: 102
    }).roomId).toBe('room-b');
  });

  it('retiring a handle frees it for reuse and gives the old owner a suffix', () => {
    const oldLease = createRoomHandleLease({
      roomId: 'room-a',
      sessionId: 'session-1',
      handle: '@fast',
      activeFromMs: 100
    });

    const retired = retireRoomHandleLease({
      roomId: 'room-a',
      sessionId: 'session-1',
      activeUntilMs: 200
    });
    const newLease = createRoomHandleLease({
      roomId: 'room-a',
      sessionId: 'session-2',
      handle: '@fast',
      activeFromMs: 201
    });

    expect(retired?.leaseId).toBe(oldLease.leaseId);
    expect(retired?.retiredSuffix).toBe(1);
    expect(renderRoomHandleSnapshot(retired)).toBe('@fast#1');
    expect(renderRoomHandleSnapshot(newLease)).toBe('@fast');
  });

  it('increments retired suffixes for repeated handle reuse in one room', () => {
    const first = createRoomHandleLease({ roomId: 'room-a', sessionId: 's1', handle: '@fast', activeFromMs: 100 });
    const firstRetired = retireRoomHandleLease({ roomId: 'room-a', sessionId: 's1', activeUntilMs: 110 });
    const second = createRoomHandleLease({ roomId: 'room-a', sessionId: 's2', handle: '@fast', activeFromMs: 120 });
    const secondRetired = retireRoomHandleLease({ roomId: 'room-a', sessionId: 's2', activeUntilMs: 130 });

    expect(first.leaseId).not.toBe(second.leaseId);
    expect(renderRoomHandleSnapshot(firstRetired)).toBe('@fast#1');
    expect(renderRoomHandleSnapshot(secondRetired)).toBe('@fast#2');
  });

  it('derives an available room handle by appending an integer when the default is taken', () => {
    createRoomHandleLease({ roomId: 'room-a', sessionId: 's1', handle: '@macxeno', activeFromMs: 100 });
    createRoomHandleLease({ roomId: 'room-a', sessionId: 's2', handle: '@macxeno2', activeFromMs: 101 });

    expect(deriveAvailableRoomHandle({
      roomId: 'room-a',
      preferredHandle: 'macxeno',
      fallbackSessionId: 'session-3'
    })).toBe('@macxeno3');
  });

  it('falls back to session id when no preferred handle is available', () => {
    expect(deriveAvailableRoomHandle({
      roomId: 'room-a',
      preferredHandle: '',
      fallbackSessionId: 'terminal 42'
    })).toBe('@terminal-42');
  });

  it('allocates a unique active lease from a preferred room handle', () => {
    createRoomHandleLease({ roomId: 'room-a', sessionId: 's1', handle: '@macxeno', activeFromMs: 100 });

    const lease = allocateHandle({
      roomId: 'room-a',
      sessionId: 'session-2',
      preferredHandle: 'macxeno',
      fallbackSessionId: 'session-2',
      activeFromMs: 120,
      createdFrom: 'auto-join-on-post'
    });

    expect(lease.handle).toBe('@macxeno2');
    expect(lease.sessionId).toBe('session-2');
    expect(lease.createdFrom).toBe('auto-join-on-post');
  });

  it('resolves the historical owner of a reused handle at message time', () => {
    const oldLease = createRoomHandleLease({ roomId: 'room-a', sessionId: 's1', handle: '@fast', activeFromMs: 100 });
    retireRoomHandleLease({ roomId: 'room-a', sessionId: 's1', activeUntilMs: 200 });
    const newLease = createRoomHandleLease({ roomId: 'room-a', sessionId: 's2', handle: '@fast', activeFromMs: 201 });

    const oldOwner = findRoomHandleOwnerAtTime({ roomId: 'room-a', handle: '@fast', atMs: 150 });
    const newOwner = findRoomHandleOwnerAtTime({ roomId: 'room-a', handle: '@fast', atMs: 220 });

    expect(oldOwner?.leaseId).toBe(oldLease.leaseId);
    expect(renderRoomHandleSnapshot(oldOwner)).toBe('@fast#1');
    expect(newOwner?.leaseId).toBe(newLease.leaseId);
    expect(renderRoomHandleSnapshot(newOwner)).toBe('@fast');
  });
});
