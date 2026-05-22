import { beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { resetChatRoomStoreForTests } from './chatRoomStore';
import { upsertTerminal, getTerminalById } from './terminalsStore';
import { addMembership, getTerminalIdByHandle } from './roomMembershipsStore';
import { createTerminalRecord } from './terminalRecordsStore';
import { bindRoomHandleToLiveTerminal } from './terminalHandleBinding';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

// 0.1.8 slice B (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// the early-return on existing-binding only fires when the existing
// terminal still looks alive. Yesterday's xenocc-windows wedge was
// caused by a broken-walker register from 0.1.5 leaving a pid_start:
// null row pinned to room_memberships; subsequent registers with the
// fixed walker no-op'd because the binding "already existed". These
// tests lock the liveness check.
describe('bindRoomHandleToLiveTerminal — liveness check', () => {
  const ROOM_ID = 'r_test_room';
  const HANDLE = '@testagent';

  it('returns existing terminal id when the binding is live', () => {
    const live = upsertTerminal({
      pid: 1000,
      pid_start: 'iso-2026-05-22T12:00:00',
      name: 'live-terminal'
    });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: live.id });

    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE);
    expect(result).toBe(live.id);
  });

  it('re-binds when the existing terminal has pid_start: null (broken-walker signature)', () => {
    const stale = upsertTerminal({
      pid: 0,
      pid_start: null,
      name: 'stale-broken-walker'
    });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: stale.id });
    // Fresh terminal_record from a working-walker re-register
    const fresh = upsertTerminal({
      pid: 2000,
      pid_start: 'iso-2026-05-22T13:00:00',
      name: 'fresh-terminal'
    });
    createTerminalRecord({ sessionId: fresh.id, name: 'fresh-terminal', handle: HANDLE });

    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE);
    expect(result).toBe(fresh.id);
    expect(result).not.toBe(stale.id);
    // membership row rewritten to point at the fresh terminal
    expect(getTerminalIdByHandle(ROOM_ID, HANDLE)).toBe(fresh.id);
  });

  it('re-binds when the existing terminal has expired (expires_at past now)', () => {
    const expired = upsertTerminal({
      pid: 1000,
      pid_start: 'iso-2026-05-21T12:00:00',
      name: 'expired-terminal',
      ttlSeconds: 60
    });
    // TTLs are clamped to >= MIN_TTL_SECONDS at the public surface, so
    // we drag expires_at into the past via raw SQL — only way to
    // simulate true expiry inside the test window.
    const pastSeconds = Math.floor(Date.now() / 1000) - 60;
    getIdentityDb().prepare(`UPDATE terminals SET expires_at = ? WHERE id = ?`).run(pastSeconds, expired.id);
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: expired.id });
    expect(getTerminalById(expired.id)?.expires_at).toBe(pastSeconds);

    const fresh = upsertTerminal({
      pid: 2000,
      pid_start: 'iso-2026-05-22T13:00:00',
      name: 'fresh-terminal'
    });
    createTerminalRecord({ sessionId: fresh.id, name: 'fresh-terminal', handle: HANDLE });

    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE);
    expect(result).toBe(fresh.id);
    expect(getTerminalIdByHandle(ROOM_ID, HANDLE)).toBe(fresh.id);
  });

  it('returns null when binding is stale and NO fresh terminal_record exists for the handle', () => {
    const stale = upsertTerminal({
      pid: 0,
      pid_start: null,
      name: 'stale-broken-walker'
    });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: stale.id });
    // No createTerminalRecord call — nothing to re-bind to.

    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE);
    expect(result).toBeNull();
  });
});
