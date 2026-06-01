/**
 * /api/grants endpoint tests — Stage A grants_shim CLI surface (plan
 * milestone p3-stage-a-grant-cli of ant-substrate-v0.2-2026-05-29).
 *
 * Covers T4 + T5 of the PR spec at the HTTP layer:
 *   T4 grant insert → lookupActiveGrant finds the row.
 *   T5 grant + revoke → lookupActiveGrant returns null.
 * Plus 400/401 contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST, DELETE } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  lookupActiveGrant,
  resetGrantsShimForTests
} from '$lib/server/grantsShimStore';
import { createChatRoom } from '$lib/server/chatRoomStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN = 'admin-token-for-grants-tests';

type AnyHandler = (event: unknown) => unknown;

function eventFor(
  method: 'POST' | 'DELETE',
  init: RequestInit
): unknown {
  const url = new URL('http://localhost/api/grants');
  const request = new Request(url.toString(), { method, ...init });
  return { request, params: {}, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: unknown };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrown;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-grants-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  resetIdentityDbForTests();
  resetGrantsShimForTests();
});

afterEach(() => {
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
  if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('/api/grants — POST', () => {
  it('T4: admin-bearer POST writes a grants_shim row + lookup succeeds', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const body = (await response.json()) as { grant?: { grantId?: string } };
    expect(body.grant?.grantId).toMatch(/^gr_/);
    const found = lookupActiveGrant({
      granteeHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: 'orsz2321qb'
    });
    expect(found).not.toBeNull();
    expect(found?.grantedByHandle).toBe('@admin');
  });

  it('rejects when no caller identity resolves (401)', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('rejects malformed body (400) — missing granteeHandle', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects invalid targetKind (400)', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'mystery',
        targetId: 'r1'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('rejects invalid scope (400)', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        scope: 'forever'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(400);
  });

  it('honours scope=always-for-room on the wire', async () => {
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1',
        scope: 'always-for-room'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const found = lookupActiveGrant({
      granteeHandle: '@x',
      action: 'chat.post',
      targetKind: 'room',
      targetId: 'r1'
    });
    expect(found?.scope).toBe('always-for-room');
  });
});

describe('/api/grants — DELETE', () => {
  it('T5: DELETE revokes an active grant + lookup returns null', async () => {
    // Seed via POST.
    await runHandler(
      POST as AnyHandler,
      eventFor('POST', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          granteeHandle: '@speedyc',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'orsz2321qb'
        })
      })
    );
    expect(
      lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      })
    ).not.toBeNull();
    // Now revoke.
    const response = await runHandler(
      DELETE as AnyHandler,
      eventFor('DELETE', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          granteeHandle: '@speedyc',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'orsz2321qb'
        })
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(1);
    expect(
      lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'orsz2321qb'
      })
    ).toBeNull();
  });

  it('returns revokedCount=0 when no active grant exists', async () => {
    const response = await runHandler(
      DELETE as AnyHandler,
      eventFor('DELETE', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          granteeHandle: '@nobody',
          action: 'chat.post',
          targetKind: 'room',
          targetId: 'r1'
        })
      })
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revokedCount: number };
    expect(body.revokedCount).toBe(0);
  });

  it('rejects unauthenticated revoke (401)', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const event = eventFor('DELETE', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'r1'
      })
    });
    const response = await runHandler(DELETE as AnyHandler, event);
    expect(response.status).toBe(401);
  });
});

describe('/api/grants — approver gate (security fix 2026-05-29)', () => {
  // Three properties to lock in:
  //   (A) authenticated non-approver is rejected with 403 + structured payload
  //   (B) authenticated approver (room owner) is accepted with 201
  //   (C) DELETE applies the same gate

  function seedRoomWithOwner(roomName: string, ownerHandle: string) {
    const room = createChatRoom({ name: roomName, whoCreatedIt: ownerHandle });
    return room;
  }

  function seedTerminalAndMembership(roomId: string, handle: string, pid: number) {
    const terminal = upsertTerminal({
      pid,
      pid_start: `2026-05-29T20:00:0${pid % 10}.000Z`,
      name: `term-${pid}`,
      ttlSeconds: 60 * 60
    });
    // Sec-iter6 Fix #2 (2026-05-30): /api/grants caller-handle resolution
    // now reads terminal_records.handle (authoritative) rather than
    // memberships[0].handle (attacker-controllable). Tests must seed
    // BOTH the legacy membership row (for the existing approver-list
    // shape) AND the terminal_records row (so the new gate resolves the
    // caller's declared handle). Mirrors the iter-1 Fix #1 migration
    // pattern in /api/permission-requests tests.
    createTerminalRecord({
      sessionId: terminal.id,
      name: `term-${pid}`,
      handle
    });
    addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
    return { terminal, pidChainEntry: { pid, pid_start: `2026-05-29T20:00:0${pid % 10}.000Z` } };
  }

  it('rejects authenticated non-approver POST with 403 + structured payload (privilege escalation prevention)', async () => {
    const room = seedRoomWithOwner('locked-down', '@jwpk');
    // @speedyc is authenticated (has a terminal + membership) but is NOT
    // the room owner — must not be able to issue grants on this room.
    const { pidChainEntry } = seedTerminalAndMembership(room.id, '@speedyc', 88701);

    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@rando',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        pidChain: [pidChainEntry]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { permission_denied?: { reason?: string; approvers?: Array<{ handle: string }> } };
    expect(body.permission_denied?.reason).toBe('not_room_owner');
    expect(body.permission_denied?.approvers?.some(a => a.handle === '@jwpk')).toBe(true);
    // Grant must NOT have landed.
    expect(
      lookupActiveGrant({
        granteeHandle: '@rando',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id
      })
    ).toBeNull();
  });

  it('accepts authenticated room-owner POST with 201', async () => {
    const room = seedRoomWithOwner('owner-can-grant', '@jwpk');
    // Now @jwpk authenticates via pidChain (they're the owner).
    const { pidChainEntry } = seedTerminalAndMembership(room.id, '@jwpk', 88702);

    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        pidChain: [pidChainEntry]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    expect(
      lookupActiveGrant({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id
      })
    ).not.toBeNull();
  });

  it('admin-bearer bypasses the approver gate (break-glass primitive)', async () => {
    // No room seeded — admin can grant against any target_id, including
    // one that wouldn't resolve any approvers via the normal path.
    const event = eventFor('POST', {
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TEST_ADMIN}`
      },
      body: JSON.stringify({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: 'rm_does_not_exist'
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
  });

  it('applies the same gate to DELETE (non-approver cannot revoke)', async () => {
    const room = seedRoomWithOwner('delete-gate', '@jwpk');
    // Admin seeds an active grant first.
    await runHandler(
      POST as AnyHandler,
      eventFor('POST', {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${TEST_ADMIN}`
        },
        body: JSON.stringify({
          granteeHandle: '@rando',
          action: 'chat.post',
          targetKind: 'room',
          targetId: room.id
        })
      })
    );
    // Non-approver attempts to revoke.
    const { pidChainEntry } = seedTerminalAndMembership(room.id, '@speedyc', 88703);
    const response = await runHandler(
      DELETE as AnyHandler,
      eventFor('DELETE', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          granteeHandle: '@rando',
          action: 'chat.post',
          targetKind: 'room',
          targetId: room.id,
          pidChain: [pidChainEntry]
        })
      })
    );
    expect(response.status).toBe(403);
    // Grant must still be active.
    expect(
      lookupActiveGrant({
        granteeHandle: '@rando',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id
      })
    ).not.toBeNull();
  });

  it('rejects non-admin system-scoped POST with 403', async () => {
    // System-scoped grants are admin-bearer only by design. Even a
    // legitimately authenticated agent gets 403 with reason=not_org_admin.
    const room = seedRoomWithOwner('sys-blocker', '@jwpk');
    const { pidChainEntry } = seedTerminalAndMembership(room.id, '@speedyc', 88704);
    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@speedyc',
        action: 'system.reclaim',
        targetKind: 'system',
        targetId: 'global',
        pidChain: [pidChainEntry]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { permission_denied?: { reason?: string } };
    expect(body.permission_denied?.reason).toBe('not_org_admin');
  });
});

/**
 * Sec-iter6 Fix #2 (2026-05-30) — /api/grants caller-identity migration
 * from `memberships[0].handle` to authoritative `terminal_records.handle`.
 *
 * Closes the last piece of the iter-5 HIGH exploit chain at the grants
 * endpoint. Pre-iter6, an attacker who landed a `(roomX, @victim)`
 * membership row on their own terminal — the iter-5 chain step that
 * Fix #1 + Fix #3 now block at the wire AND structurally — could call
 * `/api/grants` and have caller-identity resolve to `@victim`, passing
 * the approver-set gate for any target where `@victim` was an approver.
 *
 * These tests confirm the new gate uses ONLY the authoritative
 * `terminal_records.handle`, so even a planted membership row cannot
 * impersonate the victim at the grants approver check.
 */
describe('/api/grants — sec-iter6 Fix #2 authoritative caller-identity', () => {
  function seedTerminalRecord(handle: string | null, pid: number, name: string) {
    const terminal = upsertTerminal({
      pid,
      pid_start: `2026-05-30T13:00:0${pid % 10}.000Z`,
      name,
      ttlSeconds: 60 * 60
    });
    createTerminalRecord({ sessionId: terminal.id, name, handle });
    return { terminal, pidChainEntry: { pid, pid_start: `2026-05-30T13:00:0${pid % 10}.000Z` } };
  }

  it('attacker with PLANTED @victim membership row on their terminal still cannot grant as @victim', async () => {
    // Setup: @jwpk owns the room (the only approver).
    const room = createChatRoom({ name: 'planted-membership', whoCreatedIt: '@jwpk' });
    // Attacker terminal: authoritative terminal_records.handle is @attacker.
    const { terminal: attackerTerminal, pidChainEntry: attackerPid } = seedTerminalRecord(
      '@attacker', 91001, 'attacker-term'
    );
    // The iter-5 chain step (pre-Fix #1): attacker plants a (room.id, @victim)
    // membership row on their OWN terminal. Pre-iter6 this rebound any
    // existing @victim row to attackerTerminal; iter-6 Fix #1 + Fix #3
    // block the wire path, but we simulate the END STATE here to prove
    // Fix #2 closes the residual surface — direct addMembership is what
    // a future regression in any addMembership caller could land.
    //
    // NOTE: @jwpk is the room owner — putting @jwpk in the attacker's
    // membership row simulates the worst-case spoof (owner-of-approver-set).
    addMembership({ room_id: room.id, handle: '@jwpk', terminal_id: attackerTerminal.id });

    // Attacker attempts to grant against the room. Pre-Fix #2 caller-
    // identity would resolve to @jwpk (via memberships[0]) and pass.
    // Post-Fix #2 caller-identity resolves to @attacker (the
    // authoritative terminal_records.handle), and the approver gate
    // returns 403.
    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@attacker',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        pidChain: [attackerPid]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(403);
    const body = (await response.json()) as { permission_denied?: { reason?: string; approvers?: Array<{ handle: string }> } };
    expect(body.permission_denied?.reason).toBe('not_room_owner');
    // The grant must NOT have landed.
    expect(
      lookupActiveGrant({
        granteeHandle: '@attacker',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id
      })
    ).toBeNull();
  });

  it('caller with NULL terminal_records.handle 401s (fail-closed) instead of falling back to memberships', async () => {
    // Pre-iter6 a caller with no terminal_records.handle would fall
    // back to memberships[0].handle (or @<terminal.name>). Post-iter6
    // they 401 with the explicit "run ant register --handle" recovery
    // hint — same fail-closed shape as /api/permission-requests.
    const room = createChatRoom({ name: 'null-handle-blocker', whoCreatedIt: '@jwpk' });
    const { terminal, pidChainEntry } = seedTerminalRecord(null, 91002, 'unregistered-term');
    // Seed a membership row that would have been the old fallback.
    addMembership({ room_id: room.id, handle: '@some-membership-handle', terminal_id: terminal.id });

    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@x',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        pidChain: [pidChainEntry]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(401);
  });

  it('authoritative caller-handle is what lands in granted_by_handle on the issued grant', async () => {
    const room = createChatRoom({ name: 'audit-trail', whoCreatedIt: '@jwpk' });
    const { pidChainEntry } = seedTerminalRecord('@jwpk', 91003, 'jwpk-term');
    const event = eventFor('POST', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        granteeHandle: '@speedyc',
        action: 'chat.post',
        targetKind: 'room',
        targetId: room.id,
        pidChain: [pidChainEntry]
      })
    });
    const response = await runHandler(POST as AnyHandler, event);
    expect(response.status).toBe(201);
    const found = lookupActiveGrant({
      granteeHandle: '@speedyc',
      action: 'chat.post',
      targetKind: 'room',
      targetId: room.id
    });
    expect(found?.grantedByHandle).toBe('@jwpk');
  });
});
