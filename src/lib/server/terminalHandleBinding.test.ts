import { beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { resetChatRoomStoreForTests } from './chatRoomStore';
import { upsertTerminal, getTerminalById } from './terminalsStore';
import { addMembership, getTerminalIdByHandle } from './roomMembershipsStore';
import { createTerminalRecord } from './terminalRecordsStore';
import { bindRoomHandleToLiveTerminal } from './terminalHandleBinding';
import { ensureSessionForTerminal } from './antSessionStore';
import { isMember as leaseIsMember, claimHandle } from './roomHandleLeaseClean';
import { resolveMember as cleanMembershipSession } from './membershipStore';

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
      // 2026-05-29 ISO normalisation: fixture strings must be parseable
      // ISO 8601 (or a parseable lstart) — the `'iso-...'` prefix in the
      // legacy fixture matches neither branch of the normaliser and
      // collapses to null, faking the broken-walker signature.
      pid_start: '2026-05-22T12:00:00.000Z',
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
      pid_start: '2026-05-22T13:00:00.000Z',
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
      pid_start: '2026-05-21T12:00:00.000Z',
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
      pid_start: '2026-05-22T13:00:00.000Z',
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

// Point 2 fix (Xeno windows-cli-auth-wedge follow-up #2, 2026-05-28).
// When the existing binding fails liveness AND a callerPidChain is
// supplied, prefer the caller's pidChain-resolved terminal over the
// legacy handle→record lookup — otherwise the caller's fresh register
// loses to whatever stale terminal_records row findTerminalRecordByHandle
// happens to surface first.
describe('bindRoomHandleToLiveTerminal — callerPidChain re-bind path', () => {
  const ROOM_ID = 'r_test_pidchain';
  const HANDLE = '@xenoshell';

  it('uses callerPidChain to re-bind to the caller\'s live terminal when existing binding is stale', () => {
    // 1. Stale binding from a broken-walker register (poisoned row)
    const stale = upsertTerminal({ pid: 0, pid_start: null, name: 'stale-poisoned' });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: stale.id });

    // 2. Another terminal_records row matching @xenoshell, but it's the
    //    SAME stale row — this is the case where findTerminalRecordByHandle
    //    would resolve straight back to the poisoned terminal.
    createTerminalRecord({ sessionId: stale.id, name: 'stale-poisoned', handle: HANDLE });

    // 3. Caller's own freshly-registered live terminal (different sessionId,
    //    real pidChain entry, no terminal_records→handle binding yet).
    const callerLive = upsertTerminal({
      pid: 4242,
      pid_start: '2026-05-28T20:00:00.000Z',
      name: 'caller-live'
    });

    const callerPidChain = [{ pid: 4242, pid_start: '2026-05-28T20:00:00.000Z' }];
    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE, callerPidChain);

    expect(result).toBe(callerLive.id);
    expect(result).not.toBe(stale.id);
    expect(getTerminalIdByHandle(ROOM_ID, HANDLE)).toBe(callerLive.id);
  });

  it('falls back to handle→record lookup when callerPidChain does not resolve to any live terminal', () => {
    const stale = upsertTerminal({ pid: 0, pid_start: null, name: 'stale' });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: stale.id });
    const fresh = upsertTerminal({
      pid: 3000,
      pid_start: '2026-05-28T19:00:00.000Z',
      name: 'handle-resolved-fresh'
    });
    createTerminalRecord({ sessionId: fresh.id, name: 'handle-resolved-fresh', handle: HANDLE });

    // pidChain that doesn't match any terminals row
    const unrelatedChain = [{ pid: 99_999, pid_start: '2026-05-28T18:00:00.000Z' }];
    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE, unrelatedChain);

    expect(result).toBe(fresh.id);
    expect(getTerminalIdByHandle(ROOM_ID, HANDLE)).toBe(fresh.id);
  });

  it('does NOT use pidChain when the existing binding is still live (preserves binding)', () => {
    const live = upsertTerminal({
      pid: 1000,
      pid_start: '2026-05-28T12:00:00.000Z',
      name: 'live-existing'
    });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: live.id });

    // Another caller's pidChain pointing at a different live terminal —
    // we should NOT re-bind, because the existing binding is fine.
    const other = upsertTerminal({
      pid: 5000,
      pid_start: '2026-05-28T13:00:00.000Z',
      name: 'other-live'
    });
    const otherChain = [{ pid: 5000, pid_start: '2026-05-28T13:00:00.000Z' }];

    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE, otherChain);
    expect(result).toBe(live.id);
    expect(result).not.toBe(other.id);
  });

  it('omitting callerPidChain (default empty) keeps the legacy code path working', () => {
    const stale = upsertTerminal({ pid: 0, pid_start: null, name: 'stale' });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: stale.id });
    const fresh = upsertTerminal({
      pid: 2000,
      pid_start: '2026-05-28T13:00:00.000Z',
      name: 'fresh-handle-only'
    });
    createTerminalRecord({ sessionId: fresh.id, name: 'fresh-handle-only', handle: HANDLE });

    // No third arg — old callers (browser path, MCP path) still work.
    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE);
    expect(result).toBe(fresh.id);
  });
});

// 2026-06-08 (@speedy 0djd8b8cjq): bind historically wrote ONLY the legacy
// terminal-keyed room_memberships, never the clean session-keyed surfaces the
// POST gate reads (room_handle_lease + room_membership). So `ant bind` reported
// "Bound" yet the agent still 403'd. These lock the self-heal: after bind, the
// POST gate's OWN read resolves the bound session, with no manual DB alignment.
describe('bindRoomHandleToLiveTerminal — self-heals the clean POST-gate surfaces', () => {
  const ROOM_ID = 'r_selfheal';
  const HANDLE = '@speedy';

  it('claims the clean lease so the POST gate sees the bound session (was: "bound but cannot post")', () => {
    const live = upsertTerminal({ pid: 7000, pid_start: '2026-06-08T12:00:00.000Z', name: 'live-speedy' });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: live.id });
    // The drift: legacy membership exists, but NO clean lease for the session.
    const session = ensureSessionForTerminal({ terminalId: live.id });
    expect(leaseIsMember(ROOM_ID, session.id)).toBe(false); // post gate would 403 here

    const result = bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE);
    expect(result).toBe(live.id);
    // After bind the POST gate's own read (roomHandleLeaseClean.isMember) resolves.
    expect(leaseIsMember(ROOM_ID, session.id)).toBe(true);
    // And the clean membership is bound to the same session (delivery surface).
    expect(cleanMembershipSession(ROOM_ID, HANDLE)).toBe(session.id);
  });

  it('re-keys the clean lease to the live session when a STALE session holds it (the @speedy multi-record case)', () => {
    // A dead session previously held clean @speedy (drifted clean lease).
    const live = upsertTerminal({ pid: 7100, pid_start: '2026-06-08T12:30:00.000Z', name: 'live-speedy-2' });
    addMembership({ room_id: ROOM_ID, handle: HANDLE, terminal_id: live.id });
    const liveSession = ensureSessionForTerminal({ terminalId: live.id });
    // Seed a stale clean holder (a session whose terminal does not exist → stale).
    claimHandle(ROOM_ID, HANDLE, 'dead-session-no-terminal');
    expect(leaseIsMember(ROOM_ID, 'dead-session-no-terminal')).toBe(true);

    bindRoomHandleToLiveTerminal(ROOM_ID, HANDLE);

    // Live session now holds the clean lease; post gate resolves it.
    expect(leaseIsMember(ROOM_ID, liveSession.id)).toBe(true);
  });
});
