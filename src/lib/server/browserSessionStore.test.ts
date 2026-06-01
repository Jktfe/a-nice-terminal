import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { upsertTerminal } from './terminalsStore';
import { addMembership } from './roomMembershipsStore';
import {
  createBrowserSession,
  resolveBrowserSessionSecret,
  revokeBrowserSessionsForMember,
  touchBrowserSessionLastSeen,
  resetBrowserSessionStoreForTests
} from './browserSessionStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetBrowserSessionStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetBrowserSessionStoreForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

function addActiveMember(roomId = 'room1', handle = '@you'): string {
  const terminal = upsertTerminal({ pid: 42, pid_start: 'pst', name: `${roomId}-${handle}` });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  return terminal.id;
}

function tableCount(tableName: string): number {
  const row = getIdentityDb().prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number };
  return row.count;
}

describe('createBrowserSession', () => {
  it('rejects non-member handles and writes no rows', () => {
    const result = createBrowserSession({ roomId: 'room1', authorHandle: '@missing' });
    expect(result).toBeNull();
    expect(tableCount('browser_sessions')).toBe(0);
    expect(getIdentityDb().prepare(`SELECT COUNT(*) AS count FROM terminals WHERE source = 'browser-session'`).get())
      .toMatchObject({ count: 0 });
  });

  it('rejects revoked memberships', () => {
    addActiveMember('room1', '@you');
    getIdentityDb().prepare(`UPDATE room_memberships SET revoked_at_ms = ? WHERE room_id = ? AND handle = ?`)
      .run(Date.now(), 'room1', '@you');
    expect(createBrowserSession({ roomId: 'room1', authorHandle: '@you' })).toBeNull();
  });

  it('returns a plaintext cookie secret once and stores only the hash', () => {
    addActiveMember();
    const result = createBrowserSession({ roomId: 'room1', authorHandle: 'you' });
    expect(result).not.toBeNull();
    expect(result?.browserSessionSecret.startsWith('bws_')).toBe(true);
    const row = getIdentityDb().prepare(`SELECT secret_hash FROM browser_sessions WHERE id = ?`)
      .get(result?.session.id) as { secret_hash: string };
    expect(row.secret_hash).not.toBe(result?.browserSessionSecret);
    expect(row.secret_hash.length).toBe(64);
  });

  it('writes browser session + synthetic terminal + internal membership in one tx', () => {
    const proofTerminalId = addActiveMember('room1', '@you');
    const result = createBrowserSession({
      roomId: 'room1',
      authorHandle: '@you',
      browserSessionId: 'bs_tx_shape',
      nowMs: 1_700_000_000_000
    });
    expect(result?.session.handle).toBe('@you');
    expect(result?.session.terminal_id).toBe('browser-bs_tx_shape');
    // 30-day TTL (bumped from 24h in 100f44b — JWPK msg 'I can't sign
    // in every day' fix). 1_700_000_000_000 + (30 * 86_400_000) =
    // 1_702_592_000_000.
    expect(result?.session.expires_at_ms).toBe(1_702_592_000_000);

    const terminal = getIdentityDb().prepare(`SELECT * FROM terminals WHERE id = ?`)
      .get('browser-bs_tx_shape') as Record<string, unknown>;
    expect(terminal).toMatchObject({
      pid: 0,
      pid_start: 'browser-session',
      source: 'browser-session',
      agent_kind: 'browser',
      pane_status: 'verified',
      // 30-day TTL — see expires_at_ms note above. 1_700_000_000 +
      // (30 * 86_400) = 1_702_592_000.
      expires_at: 1_702_592_000
    });

    const memberships = getIdentityDb().prepare(
      `SELECT handle, terminal_id FROM room_memberships WHERE room_id = ?`
    ).all('room1') as { handle: string; terminal_id: string }[];
    expect(memberships).toEqual(expect.arrayContaining([
      { handle: '@you', terminal_id: proofTerminalId },
      { handle: '@browser-bs_tx_shape', terminal_id: 'browser-bs_tx_shape' }
    ]));
  });

  it('rolls back all writes if the synthetic terminal insert fails', () => {
    addActiveMember('room1', '@you');
    getIdentityDb().prepare(`INSERT INTO terminals
      (id, pid, pid_start, name, source, meta, created_at, updated_at)
      VALUES ('browser-bs_collision', 0, 'x', 'collision', 'test', '{}', 1, 1)`).run();
    expect(() => createBrowserSession({
      roomId: 'room1',
      authorHandle: '@you',
      browserSessionId: 'bs_collision'
    })).toThrow();
    expect(getIdentityDb().prepare(`SELECT * FROM browser_sessions WHERE id = 'bs_collision'`).get()).toBeUndefined();
    expect(getIdentityDb().prepare(`SELECT * FROM room_memberships WHERE id = 'mem_bs_collision'`).get()).toBeUndefined();
  });
});

describe('resolve/touch/revoke browser sessions', () => {
  it('resolves active secrets to public handle + synthetic terminal id', () => {
    addActiveMember('room1', '@you');
    const result = createBrowserSession({ roomId: 'room1', authorHandle: '@you' });
    const resolved = resolveBrowserSessionSecret(result?.browserSessionSecret ?? '', 'room1');
    expect(resolved).toMatchObject({
      session_id: result?.session.id,
      room_id: 'room1',
      handle: '@you',
      terminal_id: result?.session.terminal_id
    });
    expect(resolveBrowserSessionSecret(result?.browserSessionSecret ?? '', 'other')).toBeNull();
  });

  it('does not resolve revoked or expired sessions', () => {
    addActiveMember('room1', '@you');
    const revoked = createBrowserSession({ roomId: 'room1', authorHandle: '@you' });
    revokeBrowserSessionsForMember('room1', '@you', 2_000);
    expect(resolveBrowserSessionSecret(revoked?.browserSessionSecret ?? '', 'room1')).toBeNull();

    const expired = createBrowserSession({
      roomId: 'room1', authorHandle: '@you', browserSessionId: 'bs_expired',
      // 31 days back — TTL is now 30d (100f44b); 2 days isn't expired any more.
      nowMs: Date.now() - 31 * 24 * 60 * 60 * 1000
    });
    expect(resolveBrowserSessionSecret(expired?.browserSessionSecret ?? '', 'room1')).toBeNull();
  });

  it('touchLastSeen rolls last_seen_at_ms and expires_at_ms forward by the configured TTL (30d)', () => {
    addActiveMember('room1', '@you');
    const result = createBrowserSession({ roomId: 'room1', authorHandle: '@you', nowMs: 1_000 });
    expect(touchBrowserSessionLastSeen(result?.session.id ?? '', 10_000)).toBe(true);
    const row = getIdentityDb().prepare(`SELECT last_seen_at_ms, expires_at_ms FROM browser_sessions WHERE id = ?`)
      .get(result?.session.id) as { last_seen_at_ms: number; expires_at_ms: number };
    expect(row.last_seen_at_ms).toBe(10_000);
    // 30-day TTL: 10_000 + (30 * 86_400_000) = 2_592_010_000.
    expect(row.expires_at_ms).toBe(2_592_010_000);
  });

  it('revokeBrowserSessionsForMember marks sessions and synthetic memberships revoked', () => {
    addActiveMember('room1', '@you');
    const result = createBrowserSession({ roomId: 'room1', authorHandle: '@you', browserSessionId: 'bs_revoke' });
    expect(revokeBrowserSessionsForMember('room1', 'you', 1234)).toBe(1);
    const session = getIdentityDb().prepare(`SELECT revoked_at_ms FROM browser_sessions WHERE id = ?`)
      .get(result?.session.id) as { revoked_at_ms: number };
    const membership = getIdentityDb().prepare(`SELECT revoked_at_ms FROM room_memberships WHERE id = ?`)
      .get('mem_bs_revoke') as { revoked_at_ms: number };
    expect(session.revoked_at_ms).toBe(1234);
    expect(membership.revoked_at_ms).toBe(1234);
  });

  it('touchLastSeen debounce: rapid repeat calls within 30s skip the DB write', () => {
    // Repro the auth-gate hot-path shape: many authed reads in a tight
    // window. Without the debounce, every read fires a 2-statement write
    // transaction (UPDATE browser_sessions + UPDATE terminals). With it,
    // only the first within each 30s window writes.
    addActiveMember('room1', '@you');
    const result = createBrowserSession({ roomId: 'room1', authorHandle: '@you', nowMs: 1_000 });
    const id = result?.session.id ?? '';

    // First touch at 5_000ms — writes.
    expect(touchBrowserSessionLastSeen(id, 5_000)).toBe(true);
    let row = getIdentityDb().prepare(`SELECT last_seen_at_ms FROM browser_sessions WHERE id = ?`)
      .get(id) as { last_seen_at_ms: number };
    expect(row.last_seen_at_ms).toBe(5_000);

    // 10s later — well within the 30s debounce window. Returns true
    // (presumed valid) but DOES NOT update last_seen_at_ms.
    expect(touchBrowserSessionLastSeen(id, 15_000)).toBe(true);
    row = getIdentityDb().prepare(`SELECT last_seen_at_ms FROM browser_sessions WHERE id = ?`)
      .get(id) as { last_seen_at_ms: number };
    expect(row.last_seen_at_ms).toBe(5_000); // unchanged

    // 31s after the first — past the debounce window. Writes again.
    expect(touchBrowserSessionLastSeen(id, 36_000)).toBe(true);
    row = getIdentityDb().prepare(`SELECT last_seen_at_ms FROM browser_sessions WHERE id = ?`)
      .get(id) as { last_seen_at_ms: number };
    expect(row.last_seen_at_ms).toBe(36_000);
  });

  it('touchLastSeen debounce: revoke clears the debounce so a re-issued session writes', () => {
    addActiveMember('room1', '@you');
    const result = createBrowserSession({ roomId: 'room1', authorHandle: '@you', browserSessionId: 'bs_touch_revoke' });
    const id = result?.session.id ?? '';

    expect(touchBrowserSessionLastSeen(id, 5_000)).toBe(true);
    // Revoke clears the in-memory cache for this session id.
    expect(revokeBrowserSessionsForMember('room1', '@you', 10_000)).toBe(1);
    // Re-issue under the same ID via a fresh createBrowserSession. (In
    // practice a new ID is generated; we simulate the "stale debounce
    // hit" guard by checking the cache was cleared.) The next touch
    // attempt should miss the row guard (revoked) and clear cache
    // again, returning false.
    expect(touchBrowserSessionLastSeen(id, 15_000)).toBe(false);
  });
});
