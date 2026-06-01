import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, PUT } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { listLinkedChatPermissions } from '$lib/server/linkedChatPermissionStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-linkedchat-route-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

function pidChain(pid: number, pid_start: string) {
  return [{ pid, pid_start }];
}

function makeTerminal(handleName: string, pid: number) {
  return upsertTerminal({ pid, pid_start: `start-${pid}`, name: `term-${handleName}` });
}

function setupLinkedRoom() {
  const room = createChatRoom({ name: 'linkedchat-room', whoCreatedIt: '@owner' });
  const target = makeTerminal('target', 9101);
  const owner = makeTerminal('owner', 9102);
  const other = makeTerminal('other', 9103);
  addMembership({ room_id: room.id, handle: '@target', terminal_id: target.id });
  addMembership({ room_id: room.id, handle: '@owner', terminal_id: owner.id });
  addMembership({ room_id: room.id, handle: '@other', terminal_id: other.id });
  return {
    room,
    target,
    owner,
    other,
    targetPidChain: pidChain(9101, 'start-9101'),
    ownerPidChain: pidChain(9102, 'start-9102'),
    otherPidChain: pidChain(9103, 'start-9103')
  };
}

async function callGet(terminalId: string, chain?: unknown): Promise<Response> {
  const url = new URL(`http://localhost/api/terminals/${terminalId}/linkedchat`);
  if (chain !== undefined) url.searchParams.set('pidChain', JSON.stringify(chain));
  const event = { request: new Request(url), params: { terminalId }, url } as unknown as Parameters<typeof GET>[0];
  return capture(() => GET(event));
}

async function callPut(terminalId: string, body: Record<string, unknown>): Promise<Response> {
  const url = new URL(`http://localhost/api/terminals/${terminalId}/linkedchat`);
  const request = new Request(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { terminalId }, url } as unknown as Parameters<typeof PUT>[0];
  return capture(() => PUT(event));
}

async function capture(run: () => unknown): Promise<Response> {
  try {
    return (await run()) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

describe('M3.3a T2 /api/terminals/:terminalId/linkedchat', () => {
  it('requires pidChain for GET/list so terminal-scoped permission rows are not public', async () => {
    const { target } = setupLinkedRoom();
    const response = await callGet(target.id);
    expect(response.status).toBe(403);
  });

  it('allows the target terminal itself to set an allow row', async () => {
    const { target, targetPidChain } = setupLinkedRoom();
    const response = await callPut(target.id, {
      subjectHandle: '@viewer',
      state: 'allow',
      reason: 'self-admin',
      pidChain: targetPidChain
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.permission.subject_handle).toBe('@viewer');
    expect(payload.permission.state).toBe('allow');
    expect(payload.permission.set_by).toBe('@target');
  });

  it('allows the room creator to set a deny row for a terminal in that room', async () => {
    const { target, ownerPidChain } = setupLinkedRoom();
    const response = await callPut(target.id, {
      subjectHandle: 'viewer',
      state: 'deny',
      pidChain: ownerPidChain
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.permission.subject_handle).toBe('@viewer');
    expect(payload.permission.state).toBe('deny');
    expect(payload.permission.set_by).toBe('@owner');
  });

  it('rejects an ordinary other room member', async () => {
    const { target, otherPidChain } = setupLinkedRoom();
    const response = await callPut(target.id, {
      subjectHandle: '@viewer',
      state: 'allow',
      pidChain: otherPidChain
    });
    expect(response.status).toBe(403);
    expect(listLinkedChatPermissions(target.id)).toEqual([]);
  });

  it('rejects an unresolved pidChain', async () => {
    const { target } = setupLinkedRoom();
    const response = await callPut(target.id, {
      subjectHandle: '@viewer',
      state: 'allow',
      pidChain: pidChain(9999, 'missing')
    });
    expect(response.status).toBe(403);
  });

  it('does not let ownership in an unrelated room administer this terminal', async () => {
    const { target } = setupLinkedRoom();
    const unrelatedRoom = createChatRoom({ name: 'unrelated', whoCreatedIt: '@other-owner' });
    const otherOwner = makeTerminal('other-owner', 9201);
    addMembership({ room_id: unrelatedRoom.id, handle: '@other-owner', terminal_id: otherOwner.id });

    const response = await callPut(target.id, {
      subjectHandle: '@viewer',
      state: 'allow',
      pidChain: pidChain(9201, 'start-9201')
    });
    expect(response.status).toBe(403);
    expect(listLinkedChatPermissions(target.id)).toEqual([]);
  });

  it('returns 400 for invalid state and 404 for unknown terminal', async () => {
    const { target, ownerPidChain } = setupLinkedRoom();
    expect((await callPut(target.id, { subjectHandle: '@viewer', state: 'maybe', pidChain: ownerPidChain })).status).toBe(400);
    expect((await callPut('missing-terminal', { subjectHandle: '@viewer', state: 'allow', pidChain: ownerPidChain })).status).toBe(404);
  });

  it('lists permissions for an authorised admin', async () => {
    const { target, ownerPidChain } = setupLinkedRoom();
    await callPut(target.id, { subjectHandle: '@viewer', state: 'allow', pidChain: ownerPidChain });

    const response = await callGet(target.id, ownerPidChain);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.terminal_id).toBe(target.id);
    expect(payload.permissions.map((row: { subject_handle: string }) => row.subject_handle)).toEqual(['@viewer']);
  });
});
