import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetChatMessageStoreForTests, listMessagesInRoom } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { getRoomChair, resetChairHandoffStoreForTests } from '$lib/server/chairHandoffStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-chair-handoff-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetChairHandoffStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callPost(roomId: string, body: object): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/chair/handoff`;
  const request = new Request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const event = { request, params: { roomId } } as unknown as Parameters<typeof POST>[0];
  try { return (await POST(event)) as Response; }
  catch (t) {
    if (t instanceof Response) return t;
    const f = t as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw t;
  }
}

function setupRoomWithMemberCaller(roomName: string, callerPid: number, targetHandle?: string) {
  const room = createChatRoom({ name: roomName, whoCreatedIt: '@you' });
  const callerTerm = upsertTerminal({ pid: callerPid, pid_start: `ps${callerPid}`, name: '@caller' });
  addMembership({ room_id: room.id, handle: '@caller', terminal_id: callerTerm.id });
  if (targetHandle) inviteAgentToRoom({ roomId: room.id, agentHandle: targetHandle });
  return { room, pidChain: [{ pid: callerPid, pid_start: `ps${callerPid}` }] };
}

describe('POST /api/chat-rooms/:roomId/chair/handoff', () => {
  it('200 + currentChairHandle + changed=true + system message on initial handoff', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r1', 5001, '@codex');
    const response = await callPost(room.id, { toHandle: '@codex', pidChain });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.currentChairHandle).toBe('@codex');
    expect(payload.changed).toBe(true);
    expect(getRoomChair(room.id)).toBe('@codex');
    const systemMessages = listMessagesInRoom(room.id).filter((m) => m.kind === 'system');
    expect(systemMessages.some((m) => m.body.includes('chair') && m.body.includes('@codex'))).toBe(true);
  });

  it('200 + changed=false + NO new system message on idempotent re-handoff to same chair', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r2', 5002, '@codex');
    await callPost(room.id, { toHandle: '@codex', pidChain });
    const beforeCount = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    const response = await callPost(room.id, { toHandle: '@codex', pidChain });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.changed).toBe(false);
    const afterCount = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    expect(afterCount).toBe(beforeCount);
  });

  it('403 on unresolved caller pidChain', async () => {
    const room = createChatRoom({ name: 'r3', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const response = await callPost(room.id, { toHandle: '@codex', pidChain: [{ pid: 99999, pid_start: 'fake' }] });
    expect(response.status).toBe(403);
  });

  it('404 when target toHandle is not a room member', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r4', 5003);
    const response = await callPost(room.id, { toHandle: '@stranger', pidChain });
    expect(response.status).toBe(404);
    const payload = await response.json();
    expect(payload.message).toMatch(/not a member/);
  });

  it('404 when room does not exist', async () => {
    const response = await callPost('phantom', { toHandle: '@codex', pidChain: [{ pid: 1, pid_start: 'p' }] });
    expect(response.status).toBe(404);
  });

  it('400 when toHandle missing', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r5', 5004);
    const response = await callPost(room.id, { pidChain });
    expect(response.status).toBe(400);
  });

  it('toHandle without @-prefix is normalised before lookup', async () => {
    const { room, pidChain } = setupRoomWithMemberCaller('r6', 5005, '@codex');
    const response = await callPost(room.id, { toHandle: 'codex', pidChain });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.currentChairHandle).toBe('@codex');
  });
});
