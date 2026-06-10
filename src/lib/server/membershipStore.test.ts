import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createSession } from './antSessionStore';
import { getTerminalIdByHandle, addMembership } from './roomMembershipsStore';
import { upsertTerminal } from './terminalsStore';
import { createAgent } from './v02AgentsStore';
import {
  addMembership as addV02Membership,
  listActiveMembershipsForRoom as listActiveV02MembershipsForRoom,
  removeMembership as removeV02Membership
} from './v02MembershipsStore';
import {
  claimHandle,
  isMember as leaseIsMember,
  listLeases,
  resolveMember as leaseResolveMember
} from './roomHandleLeaseClean';
import {
  addMember,
  rebindMemberSessionIfStale,
  removeMember,
  listMembers,
  resolveMember,
  isMember,
  isDurableMemberHandle
} from './membershipStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-membership-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

function createV02Room(roomId: string): string {
  getIdentityDb()
    .prepare(
      `INSERT INTO rooms (room_id, display_name, visibility, created_at_ms)
       VALUES (?, ?, 'private', ?)`
    )
    .run(roomId, roomId, Date.now());
  return roomId;
}

describe('membershipStore — (room_id, handle, session_id) is the WHOLE table', () => {
  it('addMember inserts and resolveMember returns the session', () => {
    addMember('roomX', '@alice', 'sessZ');
    expect(resolveMember('roomX', '@alice')).toBe('sessZ');
    expect(isMember('roomX', '@alice')).toBe(true);
  });

  it('resolveMember returns null for a non-member', () => {
    expect(resolveMember('roomX', '@nobody')).toBeNull();
    expect(isMember('roomX', '@nobody')).toBe(false);
  });

  it('addMember by the SAME session is idempotent — one row, no duplicate', () => {
    addMember('roomX', '@alice', 'sess1');
    const again = addMember('roomX', '@alice', 'sess1'); // same session re-add
    expect(again.session_id).toBe('sess1');
    expect(resolveMember('roomX', '@alice')).toBe('sess1');
    expect(listMembers('roomX')).toHaveLength(1); // no duplicate
  });

  // HIJACK FIX (PART 1): a held handle must NOT be silently stolen by a
  // different session. addMember from a second session is a no-op on the
  // incumbent's session_id — it does NOT overwrite the existing claim.
  it('addMember from a DIFFERENT session does NOT overwrite the incumbent (hijack fix)', () => {
    addMember('roomX', '@JWPK', 'sessOwner');
    const attempt = addMember('roomX', '@JWPK', 'sessAttacker'); // hijack attempt
    expect(attempt.session_id).toBe('sessOwner'); // incumbent unchanged
    expect(resolveMember('roomX', '@JWPK')).toBe('sessOwner');
    expect(listMembers('roomX')).toHaveLength(1); // still one row
  });

  // A NULL-session incumbent (legacy backfill row) is not an owned claim, so a
  // real session may fill it — that is not a hijack.
  it('addMember fills a NULL-session incumbent (backfill row is unowned)', () => {
    addMember('roomX', '@alice', null); // backfill, unowned
    const filled = addMember('roomX', '@alice', 'sessReal');
    expect(filled.session_id).toBe('sessReal');
    expect(resolveMember('roomX', '@alice')).toBe('sessReal');
    expect(listMembers('roomX')).toHaveLength(1);
  });

  it('register self-heal may rebind a proven-stale incumbent to the durable session', () => {
    addMember('roomX', '@alice', 'dead-terminal-id');
    const rebound = rebindMemberSessionIfStale(
      'roomX',
      '@alice',
      'durable-session',
      (current) => current === 'dead-terminal-id'
    );
    expect(rebound?.session_id).toBe('durable-session');
    expect(resolveMember('roomX', '@alice')).toBe('durable-session');
  });

  it('register self-heal does NOT rebind a live incumbent', () => {
    addMember('roomX', '@alice', 'live-owner-session');
    const attempted = rebindMemberSessionIfStale(
      'roomX',
      '@alice',
      'attacker-session',
      () => false
    );
    expect(attempted?.session_id).toBe('live-owner-session');
    expect(resolveMember('roomX', '@alice')).toBe('live-owner-session');
  });

  it('upsert preserves the original created_at_ms', () => {
    const first = addMember('roomX', '@alice', 'sess1');
    const again = addMember('roomX', '@alice', 'sess2');
    expect(again.created_at_ms).toBe(first.created_at_ms);
  });

  it('the same handle can be a member of different rooms independently', () => {
    addMember('roomX', '@alice', 'sessX');
    addMember('roomY', '@alice', 'sessY');
    expect(resolveMember('roomX', '@alice')).toBe('sessX');
    expect(resolveMember('roomY', '@alice')).toBe('sessY');
  });

  it('removeMember hard-deletes the row and reports whether one was removed', () => {
    addMember('roomX', '@alice', 'sessZ');
    expect(removeMember('roomX', '@alice')).toBe(true);
    expect(isMember('roomX', '@alice')).toBe(false);
    expect(resolveMember('roomX', '@alice')).toBeNull();
    expect(leaseIsMember('roomX', 'sessZ')).toBe(false);
    expect(removeMember('roomX', '@alice')).toBe(false); // already gone
  });

  it('listMembers returns a room members oldest-first', () => {
    addMember('roomX', '@a', 's1');
    addMember('roomX', '@b', 's2');
    addMember('roomY', '@c', 's3'); // other room, excluded
    expect(listMembers('roomX').map((m) => m.handle)).toEqual(['@a', '@b']);
  });

  it('listMembers keeps near-prefix browser handles because only @browser-bs_ is synthetic', () => {
    addMember('roomX', '@browser-bsXabc123', 'sess-near');
    expect(listMembers('roomX').map((m) => m.handle)).toEqual(['@browser-bsXabc123']);
  });

  it('addMember rejects synthetic browser-session handles before writing a clean row', () => {
    expect(() => addMember('roomX', '@browser-bs_abc123', 'browser-session-token')).toThrow(
      /synthetic browser-session handle/
    );
    expect(isMember('roomX', '@browser-bs_abc123')).toBe(false);
    expect(listMembers('roomX')).toHaveLength(0);
  });

  it('a member may have a NULL session (backfill case); isMember still true, resolveMember null', () => {
    addMember('roomX', '@alice', null);
    expect(isMember('roomX', '@alice')).toBe(true);
    expect(resolveMember('roomX', '@alice')).toBeNull();
    expect(listMembers('roomX')[0].session_id).toBeNull();
  });

  it('mirrors durable session terminal bindings into the legacy membership row', () => {
    const staleTerminal = upsertTerminal({ pid: 101, pid_start: 'pst', name: 'old' });
    const currentTerminal = upsertTerminal({ pid: 202, pid_start: 'pst', name: 'new' });
    const session = createSession({
      id: 'durable-session-token',
      kind: 'local-cli',
      label: '@agent',
      terminalId: currentTerminal.id
    });

    addMembership({ room_id: 'roomX', handle: '@agent', terminal_id: staleTerminal.id });
    addMember('roomX', '@agent', session.id);

    expect(resolveMember('roomX', '@agent')).toBe(session.id);
    expect(getTerminalIdByHandle('roomX', '@agent')).toBe(currentTerminal.id);
  });

  it('register self-heal mirrors a stale clean membership repair into legacy membership', () => {
    const staleTerminal = upsertTerminal({ pid: 101, pid_start: 'pst', name: 'old' });
    const currentTerminal = upsertTerminal({ pid: 202, pid_start: 'pst', name: 'new' });
    const session = createSession({
      id: 'durable-session-token',
      kind: 'local-cli',
      label: '@agent',
      terminalId: currentTerminal.id
    });

    addMembership({ room_id: 'roomX', handle: '@agent', terminal_id: staleTerminal.id });
    addMember('roomX', '@agent', 'dead-session-token');
    rebindMemberSessionIfStale('roomX', '@agent', session.id, (current) => current === 'dead-session-token');

    expect(resolveMember('roomX', '@agent')).toBe(session.id);
    expect(getTerminalIdByHandle('roomX', '@agent')).toBe(currentTerminal.id);
  });

  it('only the literal @browser-bs_ prefix is synthetic; near-prefix handles stay durable', () => {
    expect(isDurableMemberHandle('@browser-bs_abc123')).toBe(false);
    expect(isDurableMemberHandle('@browser-bsXabc123')).toBe(true);
    expect(isDurableMemberHandle('@browser-bs')).toBe(true);
  });
});

// The load-bearing invariant for JWPK's "in a room but unbound" bug: delivery
// reads room_membership, the POST gate reads room_handle_lease — addMember must
// write BOTH so they cannot drift. These assert the POST gate's own read
// (roomHandleLeaseClean.isMember) directly.
describe('membershipStore — member ⟹ can post (membership write claims the clean lease)', () => {
  it('addMember with a session makes the POST gate see an active lease for that session', () => {
    addMember('roomP', '@poster', 'sess-poster');
    // The post gate (messages/+server.ts → isCleanMember) reads THIS:
    expect(leaseIsMember('roomP', 'sess-poster')).toBe(true);
    expect(leaseResolveMember('roomP', '@poster')).toBe('sess-poster');
  });

  it('addMember with a NULL session writes no lease (nothing to bind yet)', () => {
    addMember('roomP', '@pending', null);
    expect(isMember('roomP', '@pending')).toBe(true);
    expect(leaseResolveMember('roomP', '@pending')).toBe(null);
  });

  it('hijack guard holds in lockstep: a different session re-adding @x moves NEITHER membership nor lease', () => {
    addMember('roomP', '@x', 'incumbent-sess');
    expect(leaseResolveMember('roomP', '@x')).toBe('incumbent-sess');
    // A different live session tries to re-add @x — must not steal it.
    addMember('roomP', '@x', 'attacker-sess');
    expect(resolveMember('roomP', '@x')).toBe('incumbent-sess'); // membership unchanged
    expect(leaseResolveMember('roomP', '@x')).toBe('incumbent-sess'); // lease clean holder unchanged
  });

  it('removeMember retires every active lease for that handle before a reinvite', () => {
    addMember('roomP', '@x', 'session-a');
    expect(removeMember('roomP', '@x')).toBe(true);
    expect(claimHandle('roomP', '@x', 'session-b')).toBe('@x');

    const leases = listLeases('roomP').filter((lease) => lease.handle === '@x');
    expect(leases.filter((lease) => lease.active).map((lease) => lease.session_id)).toEqual([
      'session-b'
    ]);
    expect(leaseIsMember('roomP', 'session-a')).toBe(false);
    expect(leaseResolveMember('roomP', '@x')).toBe('session-b');
  });

  it('retired handle history cannot demote a different live clean holder through addMember', () => {
    addMember('roomP', '@x', 'session-a');
    expect(removeMember('roomP', '@x')).toBe(true);
    expect(claimHandle('roomP', '@x', 'session-b')).toBe('@x');

    addMember('roomP', '@x', 'session-a');

    expect(resolveMember('roomP', '@x')).toBe('session-a');
    expect(leaseResolveMember('roomP', '@x')).toBe('session-b');
    expect(leaseIsMember('roomP', 'session-b')).toBe(true);
  });

  it('rebindMemberSessionIfStale re-keys the lease to the live session when the incumbent is stale', () => {
    addMember('roomP', '@agent', 'dead-sess');
    expect(leaseResolveMember('roomP', '@agent')).toBe('dead-sess');
    rebindMemberSessionIfStale('roomP', '@agent', 'live-sess', (current) => current === 'dead-sess');
    expect(resolveMember('roomP', '@agent')).toBe('live-sess');
    expect(leaseIsMember('roomP', 'live-sess')).toBe(true); // post gate now resolves the live session
  });

  it('addMember does not reactivate an old v0.2 roster membership', () => {
    const roomId = createV02Room('roomP');
    const agent = createAgent({ primary_handle: '@agent', display_name: '@agent' });
    addV02Membership({ agent_id: agent.agent_id, room_id: roomId, member_kind: 'agent' });
    expect(removeV02Membership(agent.agent_id, roomId)).toBe(true);
    expect(listActiveV02MembershipsForRoom(roomId)).toEqual([]);

    addMember(roomId, '@agent', 'sess-agent');

    expect(listActiveV02MembershipsForRoom(roomId)).toEqual([]);
  });
});
