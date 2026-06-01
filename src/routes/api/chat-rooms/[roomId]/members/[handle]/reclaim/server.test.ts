import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, _evaluateReclaimAuth } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { getIdentityDb, resetIdentityDbForTests } from '$lib/server/db';
import { addMembership } from '$lib/server/roomMembershipsStore';
import {
  getTerminalById,
  setTerminalStatus,
  upsertTerminal
} from '$lib/server/terminalsStore';
import {
  appendHandleAlias,
  createTerminalRecord
} from '$lib/server/terminalRecordsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { listMessagesInRoom } from '$lib/server/chatMessageStore';

// Phase C2 tests use admin-bearer for the read-gate (mirrors the other
// chat-room route tests). Test cases that need to exercise the
// re-point branch upsertTerminal a second terminal and supply its
// pidChain via the POST body.
const ADMIN_TOKEN_FOR_TESTS = 'reclaim-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

let tmpDir: string;
const previousFreshDb = process.env.ANT_FRESH_DB_PATH;
const previousMemoryVaultPath = process.env.ANT_MEMORY_VAULT_PATH;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-reclaim-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = '/tmp/ant-memory-pack-test';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousFreshDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousFreshDb;
  if (previousMemoryVaultPath === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = previousMemoryVaultPath;
});

type AnyEvent = Parameters<typeof POST>[0];

function makeEvent(
  roomId: string,
  handle: string,
  body: Record<string, unknown> = {},
  withAuth = true
): AnyEvent {
  const encodedHandle = encodeURIComponent(handle);
  const url = new URL(
    `http://localhost/api/chat-rooms/${roomId}/members/${encodedHandle}/reclaim`
  );
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  return {
    request: new Request(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    params: { roomId, handle: encodedHandle },
    url
  } as unknown as AnyEvent;
}

async function run(event: AnyEvent): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    const res = (await POST(event)) as Response;
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch (thrown) {
    if (thrown instanceof Response) {
      return { status: thrown.status, body: await thrown.json().catch(() => ({})) };
    }
    const f = thrown as { status?: number; body?: Record<string, unknown> };
    if (typeof f?.status === 'number') return { status: f.status, body: f.body ?? {} };
    throw thrown;
  }
}

describe('POST /api/chat-rooms/:roomId/members/:handle/reclaim', () => {
  it('returns 401 when caller is unauthenticated', async () => {
    const room = createChatRoom({ name: 'reclaim-noauth', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const res = await run(makeEvent(room.id, '@agent', {}, false));
    expect(res.status).toBe(401);
  });

  it('returns 404 when handle is not a member of the room', async () => {
    const room = createChatRoom({ name: 'reclaim-stranger', whoCreatedIt: '@you' });
    // No membership for @stranger.
    const res = await run(makeEvent(room.id, '@stranger'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when the bound terminal id is stale (defensive guard)', async () => {
    // FK ON DELETE CASCADE makes a "dangling membership" impossible in
    // normal usage — deleting the terminal removes the membership too.
    // We assert the defensive 404 by inserting the membership with FKs
    // toggled off, then turning FKs back on. The route should still
    // 404 on lookupTerminalById returning null.
    const room = createChatRoom({ name: 'reclaim-stale-fk', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const db = getIdentityDb();
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.prepare(
        `INSERT INTO room_memberships (id, room_id, handle, terminal_id, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run('stale-row', room.id, '@agent', 'no-such-terminal', Math.floor(Date.now() / 1000));
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    const res = await run(makeEvent(room.id, '@agent'));
    expect(res.status).toBe(404);
  });

  it('returns 200 + alreadyLive when the bound terminal is already live (idempotent)', async () => {
    const room = createChatRoom({ name: 'reclaim-already', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const term = upsertTerminal({
      pid: 800_001,
      pid_start: 'reclaim-already',
      name: 'reclaim-already-term'
    });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: term.id });
    // term.status defaults to 'live' from db.ts.
    const res = await run(makeEvent(room.id, '@agent'));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.alreadyLive).toBe(true);
    expect(res.body.terminalId).toBe(term.id);
  });

  it('returns 409 when the bound terminal is deleted (not recoverable)', async () => {
    const room = createChatRoom({ name: 'reclaim-deleted', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const term = upsertTerminal({
      pid: 800_002,
      pid_start: 'reclaim-deleted',
      name: 'reclaim-deleted-term'
    });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: term.id });
    setTerminalStatus(term.id, 'deleted');
    const res = await run(makeEvent(room.id, '@agent'));
    expect(res.status).toBe(409);
  });

  it('flips an archived bound terminal back to live (no pidChain re-point)', async () => {
    const room = createChatRoom({ name: 'reclaim-flip', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const term = upsertTerminal({
      pid: 800_003,
      pid_start: 'reclaim-flip',
      name: 'reclaim-flip-term'
    });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: term.id });
    setTerminalStatus(term.id, 'archived');

    const res = await run(makeEvent(room.id, '@agent'));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.terminalId).toBe(term.id);
    expect(getTerminalById(term.id)?.status).toBe('live');
  });

  it('re-points membership when caller pidChain resolves to a different live terminal', async () => {
    const room = createChatRoom({ name: 'reclaim-repoint', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    // The OLD terminal currently bound, now archived.
    const oldTerm = upsertTerminal({
      pid: 800_010,
      pid_start: 'reclaim-old',
      name: 'reclaim-old-term'
    });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: oldTerm.id });
    setTerminalStatus(oldTerm.id, 'archived');

    // Caller is now on a different live terminal — pidChain resolves to
    // this newer one. The route should re-point the membership at it
    // and flip the new terminal status to live too.
    const newTerm = upsertTerminal({
      pid: 800_011,
      pid_start: 'reclaim-new',
      name: 'reclaim-new-term'
    });

    const res = await run(
      makeEvent(room.id, '@agent', {
        pidChain: [{ pid: newTerm.pid, pid_start: newTerm.pid_start }]
      })
    );
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.terminalId).toBe(newTerm.id);
    expect(res.body.repointed).toBe(true);
    expect(getTerminalById(newTerm.id)?.status).toBe('live');
    // Old terminal remains archived — reclaim doesn't touch it on a
    // re-point because the membership no longer points at it.
    expect(getTerminalById(oldTerm.id)?.status).toBe('archived');
  });
});

// =====================================================================
// Authorization-gate tests (2026-05-30 security review HIGH finding).
// These exercise the non-admin paths — admin-bearer tests above already
// cover the "admin bypass" leg.
// =====================================================================

describe('POST /api/chat-rooms/:roomId/members/:handle/reclaim — auth gate', () => {
  it('records authReason="admin-bearer" on the admin-bypass path', async () => {
    const room = createChatRoom({ name: 'reclaim-admin-reason', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const term = upsertTerminal({
      pid: 800_100,
      pid_start: 'reclaim-admin-reason',
      name: 'reclaim-admin-reason-term'
    });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: term.id });
    setTerminalStatus(term.id, 'archived');

    const res = await run(makeEvent(room.id, '@agent'));
    expect(res.status).toBe(200);
    expect(res.body.authReason).toBe('admin-bearer');
  });

  it('rejects non-admin non-owner without alias history with 403 + structured payload', async () => {
    // The HIGH finding. Non-admin caller in a room they read-can access
    // attempts to reclaim someone else's archived handle. Server must
    // reject with 403 carrying the Stage A permission_denied block, NOT
    // silently rebind.
    const room = createChatRoom({ name: 'reclaim-attacker', whoCreatedIt: '@jwpk' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@victim' });

    // Victim's terminal — bound, then archived (e.g. via Phase A3 sweep).
    const victimTerm = upsertTerminal({
      pid: 800_200,
      pid_start: 'reclaim-attacker-victim',
      name: 'reclaim-attacker-victim-term'
    });
    addMembership({ room_id: room.id, handle: '@victim', terminal_id: victimTerm.id });
    setTerminalStatus(victimTerm.id, 'archived');

    // Attacker is in the room as a separate member with a separate live
    // terminal. They have no admin-bearer (we'll authenticate via
    // browser-session) and no alias history for @victim.
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@attacker' });
    const attackerTerm = upsertTerminal({
      pid: 800_201,
      pid_start: 'reclaim-attacker-shell',
      name: 'reclaim-attacker-shell-term'
    });
    addMembership({ room_id: room.id, handle: '@attacker', terminal_id: attackerTerm.id });
    const session = createBrowserSession({ roomId: room.id, authorHandle: '@attacker' });
    expect(session).not.toBeNull();
    const cookie = `ant_browser_session=${session!.browserSessionSecret}`;

    const encodedHandle = encodeURIComponent('@victim');
    const url = new URL(
      `http://localhost/api/chat-rooms/${room.id}/members/${encodedHandle}/reclaim`
    );
    const event = {
      request: new Request(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          pidChain: [{ pid: attackerTerm.pid, pid_start: attackerTerm.pid_start }]
        })
      }),
      params: { roomId: room.id, handle: encodedHandle },
      url
    } as unknown as AnyEvent;

    const res = await run(event);
    expect(res.status).toBe(403);
    expect((res.body as { permission_denied?: { reason: string } }).permission_denied?.reason).toBe(
      'not_room_owner'
    );

    // Critical: the membership row must NOT have been re-pointed.
    const stillBound = getTerminalById(victimTerm.id);
    expect(stillBound).not.toBeNull();
    // victimTerm stays archived; attackerTerm stays as-is. Status
    // unchanged on either side.
    expect(stillBound?.status).toBe('archived');
  });

  it('allows the self-reclaim-alias path when caller terminal records the target handle in handle_aliases', async () => {
    // The "I previously held this handle, now I want it back" path.
    // Non-admin, non-owner, but the caller's terminal record carries
    // the target handle in its alias list (e.g. they renamed away and
    // now want it back).
    const room = createChatRoom({ name: 'reclaim-self-alias', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@oldname' });

    const oldTerm = upsertTerminal({
      pid: 800_300,
      pid_start: 'reclaim-self-old',
      name: 'reclaim-self-old-term'
    });
    addMembership({ room_id: room.id, handle: '@oldname', terminal_id: oldTerm.id });
    setTerminalStatus(oldTerm.id, 'archived');

    // Caller's new terminal — different from the bound one — with a
    // terminal_record listing @oldname as a previously-held alias.
    const newTerm = upsertTerminal({
      pid: 800_301,
      pid_start: 'reclaim-self-new',
      name: 'reclaim-self-new-term'
    });
    createTerminalRecord({
      sessionId: newTerm.id,
      name: 'reclaim-self-new-record',
      handle: '@newname'
    });
    appendHandleAlias(newTerm.id, '@oldname');
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@newname' });
    addMembership({ room_id: room.id, handle: '@newname', terminal_id: newTerm.id });
    const session = createBrowserSession({ roomId: room.id, authorHandle: '@newname' });
    expect(session).not.toBeNull();
    const cookie = `ant_browser_session=${session!.browserSessionSecret}`;

    const encodedHandle = encodeURIComponent('@oldname');
    const url = new URL(
      `http://localhost/api/chat-rooms/${room.id}/members/${encodedHandle}/reclaim`
    );
    const event = {
      request: new Request(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          pidChain: [{ pid: newTerm.pid, pid_start: newTerm.pid_start }]
        })
      }),
      params: { roomId: room.id, handle: encodedHandle },
      url
    } as unknown as AnyEvent;

    const res = await run(event);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.repointed).toBe(true);
    expect(res.body.authReason).toBe('self-reclaim-alias');
    expect(res.body.terminalId).toBe(newTerm.id);
  });

  it('posts a system message in the room on every successful reclaim', async () => {
    const room = createChatRoom({ name: 'reclaim-audit', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@agent' });
    const term = upsertTerminal({
      pid: 800_400,
      pid_start: 'reclaim-audit',
      name: 'reclaim-audit-term'
    });
    addMembership({ room_id: room.id, handle: '@agent', terminal_id: term.id });
    setTerminalStatus(term.id, 'archived');

    const before = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    const res = await run(makeEvent(room.id, '@agent'));
    expect(res.status).toBe(200);

    const systemMessages = listMessagesInRoom(room.id).filter((m) => m.kind === 'system');
    expect(systemMessages.length).toBeGreaterThan(before);
    const last = systemMessages[systemMessages.length - 1];
    expect(last.body).toContain('reclaimed @agent');
    expect(last.body).toContain('auth=admin-bearer');
  });
});

// =====================================================================
// Pure-function tests for _evaluateReclaimAuth. The route's
// authorisation logic should be easy to inspect in isolation.
// =====================================================================

describe('_evaluateReclaimAuth', () => {
  it('returns admin-bearer when access.isAdminBearer is true', () => {
    const outcome = _evaluateReclaimAuth({
      access: { isAdminBearer: true, handles: [] },
      roomOwnerHandle: '@owner',
      callerTerminal: null,
      targetHandle: '@anyone'
    });
    expect(outcome.allowed).toBe(true);
    if (outcome.allowed) expect(outcome.reason).toBe('admin-bearer');
  });

  it('returns room-owner when access.handles covers the room owner', () => {
    const outcome = _evaluateReclaimAuth({
      access: { isAdminBearer: false, handles: ['@owner'] },
      roomOwnerHandle: '@owner',
      callerTerminal: null,
      targetHandle: '@anyone'
    });
    expect(outcome.allowed).toBe(true);
    if (outcome.allowed) expect(outcome.reason).toBe('room-owner');
  });

  it('returns disallowed when caller is in the room but neither admin nor owner nor alias', async () => {
    const term = upsertTerminal({
      pid: 800_500,
      pid_start: 'eval-disallow',
      name: 'eval-disallow-term'
    });
    createTerminalRecord({
      sessionId: term.id,
      name: 'eval-disallow-record',
      handle: '@other'
    });
    // No alias for @victim.
    const outcome = _evaluateReclaimAuth({
      access: { isAdminBearer: false, handles: ['@other'] },
      roomOwnerHandle: '@owner',
      callerTerminal: term,
      targetHandle: '@victim'
    });
    expect(outcome.allowed).toBe(false);
  });
});
