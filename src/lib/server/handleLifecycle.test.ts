import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { claimHandle, isMember } from './roomHandleLeaseClean';
import { bindHandle, getLiveBinding, getHandleRow } from './handleBindingsStore';
import { listLedger } from './identityLedgerStore';
import { retireHandle, deleteHandle } from './handleLifecycle';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-handle-lifecycle-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

function activeLeaseCount(handle: string): number {
  return (
    getIdentityDb()
      .prepare(`SELECT COUNT(*) AS n FROM room_handle_lease WHERE handle = ? AND active = 1`)
      .get(handle) as { n: number }
  ).n;
}

// ── Seed/query helpers for the deleteHandle anonymisation surface ──────────
let seq = 0;
function seedRoom(id: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO chat_rooms (id, name, summary, last_update, when_it_was_created, who_created_it, creation_order)
       VALUES (?, ?, '', '', '', '@seed', ?)`
    )
    .run(id, id, ++seq);
}
function seedMessage(id: string, roomId: string, handle: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO chat_messages (id, room_id, author_handle, author_display_name, kind, body, posted_at, post_order)
       VALUES (?, ?, ?, ?, 'agent', 'hi', '', ?)`
    )
    .run(id, roomId, handle, handle, ++seq);
}
function seedReaction(messageId: string, handle: string, emoji: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO message_reactions (message_id, reactor_handle, emoji, reacted_at) VALUES (?, ?, ?, '')`
    )
    .run(messageId, handle, emoji);
}
function seedMember(roomId: string, handle: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO chat_room_members (id, room_id, handle, display_name, joined_at, kind)
       VALUES (?, ?, ?, ?, '', 'agent')`
    )
    .run(`${roomId}:${handle}`, roomId, handle, handle);
}
function seedTerminal(id: string): void {
  getIdentityDb()
    .prepare(`INSERT INTO terminals (id, pid, name, created_at, updated_at) VALUES (?, 1, ?, 0, 0)`)
    .run(id, id);
}
function seedMembership(roomId: string, handle: string, terminalId: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at) VALUES (?, ?, ?, ?, 0)`
    )
    .run(`${roomId}:${handle}`, roomId, handle, terminalId);
}
function seedTerminalRecord(sessionId: string, handle: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO terminal_records (session_id, name, handle, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 0, 0)`
    )
    .run(sessionId, sessionId, handle);
}
function seedAgent(agentId: string, handle: string): void {
  getIdentityDb()
    .prepare(
      `INSERT INTO agents (agent_id, display_name, primary_handle, created_at_ms) VALUES (?, ?, ?, 0)`
    )
    .run(agentId, agentId, handle);
}
function colOf(table: string, col: string, idCol: string, id: string): string | null {
  const row = getIdentityDb()
    .prepare(`SELECT ${col} AS v FROM ${table} WHERE ${idCol} = ?`)
    .get(id) as { v: string | null } | undefined;
  return row ? row.v : null;
}
function authorHandleOf(id: string): string | null {
  return colOf('chat_messages', 'author_handle', 'id', id);
}
function displayNameOf(id: string): string | null {
  return colOf('chat_messages', 'author_display_name', 'id', id);
}
function countMessagesByAuthor(handle: string): number {
  return (
    getIdentityDb()
      .prepare(`SELECT COUNT(*) AS n FROM chat_messages WHERE author_handle = ?`)
      .get(handle) as { n: number }
  ).n;
}
function reactorsOf(messageId: string): string[] {
  return (
    getIdentityDb()
      .prepare(`SELECT reactor_handle FROM message_reactions WHERE message_id = ?`)
      .all(messageId) as Array<{ reactor_handle: string }>
  ).map((r) => r.reactor_handle);
}
function memberHandles(roomId: string): string[] {
  return (
    getIdentityDb()
      .prepare(`SELECT handle FROM chat_room_members WHERE room_id = ? ORDER BY handle`)
      .all(roomId) as Array<{ handle: string }>
  ).map((r) => r.handle);
}
function membershipHandles(roomId: string): string[] {
  return (
    getIdentityDb()
      .prepare(`SELECT handle FROM room_memberships WHERE room_id = ? ORDER BY handle`)
      .all(roomId) as Array<{ handle: string }>
  ).map((r) => r.handle);
}
function leaseBaseHandles(): string[] {
  return (
    getIdentityDb()
      .prepare(`SELECT DISTINCT handle FROM room_handle_lease`)
      .all() as Array<{ handle: string }>
  ).map((r) => r.handle);
}

describe('retireHandle — the RETIRE verb (JWPK ruling msg_as5tbdtaf9, 2026-06-12)', () => {
  it('retires every active room claim, tombstones the binding, and ledgers the act', () => {
    claimHandle('room-a', '@straggler', 'sess-1');
    claimHandle('room-b', '@straggler', 'sess-1');
    claimHandle('room-c', '@straggler', 'sess-1');
    bindHandle({ handle: '@straggler', pane: '%5', pid: 4242, pidStart: 'x', terminalId: 't_str' });
    expect(activeLeaseCount('@straggler')).toBe(3);
    expect(getLiveBinding('@straggler')).not.toBeNull();

    const res = retireHandle('@straggler', { reason: 'operator-retire', actor: '@JWPK' });

    expect(res.roomsRetired).toBe(3);
    expect(res.bindingTombstoned).toBe(true);
    expect(activeLeaseCount('@straggler')).toBe(0);
    expect(getLiveBinding('@straggler')).toBeNull();

    const retired = listLedger({}).filter(
      (e) => e.kind === 'handle.retired' && e.handle === '@straggler'
    );
    expect(retired).toHaveLength(1);
  });

  it('flips the handle lifecycle to RETIRED (and bind brings it back to ACTIVE)', () => {
    bindHandle({ handle: '@cycle', pane: '%7', pid: 700, pidStart: 'x', terminalId: 't_cycle' });
    expect(getHandleRow('@cycle')?.lifecycle).toBe('active');

    retireHandle('@cycle', { reason: 'operator-retire', actor: '@JWPK' });
    expect(getHandleRow('@cycle')?.lifecycle).toBe('retired');

    // Owner reclaim re-binds → active again (owner-gating of the claim path is a
    // later increment; this asserts the STATE transition).
    bindHandle({ handle: '@cycle', pane: '%7', pid: 701, pidStart: 'y', terminalId: 't_cycle' });
    expect(getHandleRow('@cycle')?.lifecycle).toBe('active');
  });

  it('is a safe summary when the handle holds nothing (idempotent re-retire)', () => {
    const res = retireHandle('@ghost', { reason: 'operator-retire', actor: '@JWPK' });
    expect(res.roomsRetired).toBe(0);
    expect(res.bindingTombstoned).toBe(false);
    expect(activeLeaseCount('@ghost')).toBe(0);
  });

  it('the retired handle stops being a posting identity (isMember false after retire)', () => {
    claimHandle('room-x', '@temp', 'sess-9');
    expect(isMember('room-x', 'sess-9')).toBe(true);

    retireHandle('@temp', { reason: 'operator-retire', actor: '@JWPK' });

    expect(isMember('room-x', 'sess-9')).toBe(false);
    expect(activeLeaseCount('@temp')).toBe(0);
  });

  it('accepts a bare (no-@) handle and canonicalises it', () => {
    claimHandle('room-q', '@bare', 'sess-2');
    const res = retireHandle('bare', { reason: 'operator-retire', actor: '@JWPK' });
    expect(res.handle).toBe('@bare');
    expect(res.roomsRetired).toBe(1);
    expect(activeLeaseCount('@bare')).toBe(0);
  });
});

describe('deleteHandle — the DELETE verb (anonymise to [A#]/[A-#], free the name)', () => {
  it('anonymises every chat post by the handle to [A{n}] (handle + display), across rooms', () => {
    seedRoom('r1');
    seedRoom('r2');
    seedMessage('m1', 'r1', '@gone');
    seedMessage('m2', 'r2', '@gone');
    seedMessage('m3', 'r1', '@keeper');

    const res = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });
    const label = `[A${res.anonId}]`;

    expect(authorHandleOf('m1')).toBe(label);
    expect(displayNameOf('m1')).toBe(label);
    expect(authorHandleOf('m2')).toBe(label);
    expect(authorHandleOf('m3')).toBe('@keeper');
    expect(countMessagesByAuthor('@gone')).toBe(0);
    expect(res.chatPostsAnonymised).toBe(2);
  });

  it('reuses one [A{n}] across a handle and assigns the next number to the next handle', () => {
    seedRoom('r1');
    seedMessage('a1', 'r1', '@first');
    seedMessage('a2', 'r1', '@first');
    seedMessage('b1', 'r1', '@second');

    const first = deleteHandle('@first', { reason: 'cleanup', actor: '@JWPK' });
    const second = deleteHandle('@second', { reason: 'cleanup', actor: '@JWPK' });

    expect(authorHandleOf('a1')).toBe(`[A${first.anonId}]`);
    expect(authorHandleOf('a2')).toBe(`[A${first.anonId}]`);
    expect(second.anonId).toBe(first.anonId + 1);
    expect(authorHandleOf('b1')).toBe(`[A${second.anonId}]`);
  });

  it('anonymises the handle reactions to [A{n}] and leaves others alone', () => {
    seedRoom('r1');
    seedMessage('m1', 'r1', '@keeper');
    seedReaction('m1', '@gone', '👍');
    seedReaction('m1', '@keeper', '🎉');

    const res = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });

    expect(reactorsOf('m1').sort()).toEqual([`[A${res.anonId}]`, '@keeper'].sort());
    expect(res.reactionsAnonymised).toBe(1);
  });

  it('removes the handle from member + membership lists and suffixes leases to [A-{n}]', () => {
    seedRoom('r1');
    seedMember('r1', '@gone');
    seedMember('r1', '@keeper');
    seedTerminal('t1');
    seedMembership('r1', '@gone', 't1');
    claimHandle('r1', '@gone', 'sess-gone');

    const res = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });

    expect(memberHandles('r1')).toEqual(['@keeper']);
    expect(membershipHandles('r1')).toEqual([]);
    expect(activeLeaseCount('@gone')).toBe(0);
    expect(leaseBaseHandles()).toContain(`[A-${res.anonId}]`);
  });

  it('frees the name: lifecycle=deleted, binding tombstoned, and a fresh bind re-activates', () => {
    bindHandle({ handle: '@gone', pane: '%1', pid: 1, pidStart: 'x', terminalId: 't_gone' });
    expect(getHandleRow('@gone')?.lifecycle).toBe('active');

    const res = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });
    expect(getHandleRow('@gone')?.lifecycle).toBe('deleted');
    expect(res.bindingTombstoned).toBe(true);

    bindHandle({ handle: '@gone', pane: '%2', pid: 2, pidStart: 'y', terminalId: 't_new' });
    expect(getHandleRow('@gone')?.lifecycle).toBe('active');
  });

  it('NULLs terminal_records.handle and marks matching agents deleted', () => {
    seedTerminalRecord('s1', '@gone');
    seedAgent('ag1', '@gone');

    const res = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });

    expect(colOf('terminal_records', 'handle', 'session_id', 's1')).toBeNull();
    expect(colOf('agents', 'status', 'agent_id', 'ag1')).toBe('deleted');
    expect(res.terminalRecordsNulled).toBe(1);
    expect(res.agentsMarkedDeleted).toBe(1);
  });

  it('writes exactly one handle.deleted ledger row carrying the anon_id', () => {
    seedRoom('r1');
    seedMessage('m1', 'r1', '@gone');

    const res = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });

    const rows = listLedger({}).filter((e) => e.kind === 'handle.deleted' && e.handle === '@gone');
    expect(rows).toHaveLength(1);
    expect(rows[0].detail?.anon_id).toBe(res.anonId);
  });

  it('is idempotent — re-delete reuses the anon_id and adds no second ledger row', () => {
    seedRoom('r1');
    seedMessage('m1', 'r1', '@gone');

    const first = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });
    const second = deleteHandle('@gone', { reason: 'cleanup', actor: '@JWPK' });

    expect(second.anonId).toBe(first.anonId);
    expect(authorHandleOf('m1')).toBe(`[A${first.anonId}]`);
    const rows = listLedger({}).filter((e) => e.kind === 'handle.deleted' && e.handle === '@gone');
    expect(rows).toHaveLength(1);
  });

  it('accepts a bare (no-@) handle and canonicalises it', () => {
    seedRoom('r1');
    seedMessage('m1', 'r1', '@bare');

    const res = deleteHandle('bare', { reason: 'cleanup', actor: '@JWPK' });

    expect(res.handle).toBe('@bare');
    expect(authorHandleOf('m1')).toBe(`[A${res.anonId}]`);
  });
});
