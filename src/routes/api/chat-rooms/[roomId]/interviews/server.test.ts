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
import { resetInterviewStoreForTests, getActiveInterview } from '$lib/server/interviewStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-interview-start-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetInterviewStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callPost(roomId: string, body: object): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/interviews`;
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

function setup(roomName: string, callerPid: number, callerHandle: string, subjectHandle?: string) {
  const room = createChatRoom({ name: roomName, whoCreatedIt: '@you' });
  const term = upsertTerminal({ pid: callerPid, pid_start: `ps${callerPid}`, name: callerHandle });
  addMembership({ room_id: room.id, handle: callerHandle, terminal_id: term.id });
  if (subjectHandle) inviteAgentToRoom({ roomId: room.id, agentHandle: subjectHandle });
  return { room, pidChain: [{ pid: callerPid, pid_start: `ps${callerPid}` }] };
}

describe('POST /api/chat-rooms/:roomId/interviews', () => {
  it('201 + interview row + system message on happy path', async () => {
    const { room, pidChain } = setup('r1', 7001, '@interviewer', '@kimi');
    const response = await callPost(room.id, { subjectHandle: '@kimi', pidChain });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.interview.interviewer).toBe('@interviewer');
    expect(payload.interview.subject_handle).toBe('@kimi');
    expect(getActiveInterview(room.id)?.id).toBe(payload.interview.id);
    expect(listMessagesInRoom(room.id).some((m) => m.kind === 'system' && m.body.includes('started interview'))).toBe(true);
  });

  it('404 when room does not exist', async () => {
    const response = await callPost('phantom', { subjectHandle: '@kimi', pidChain: [{ pid: 1, pid_start: 'p' }] });
    expect(response.status).toBe(404);
  });

  it('403 when caller pidChain unresolved', async () => {
    const room = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const response = await callPost(room.id, { subjectHandle: '@kimi', pidChain: [{ pid: 99999, pid_start: 'fake' }] });
    expect(response.status).toBe(403);
  });

  it('404 when subject is not a room member', async () => {
    const { room, pidChain } = setup('r3', 7002, '@interviewer');
    const response = await callPost(room.id, { subjectHandle: '@stranger', pidChain });
    expect(response.status).toBe(404);
  });

  it('400 when self-interview (caller === subject)', async () => {
    const { room, pidChain } = setup('r4', 7003, '@interviewer');
    const response = await callPost(room.id, { subjectHandle: '@interviewer', pidChain });
    expect(response.status).toBe(400);
  });

  it('400 when subjectHandle missing', async () => {
    const { room, pidChain } = setup('r5', 7004, '@interviewer');
    const response = await callPost(room.id, { pidChain });
    expect(response.status).toBe(400);
  });

  it('409 when another interview is already active in same room', async () => {
    const { room, pidChain } = setup('r6', 7005, '@interviewer', '@a');
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });
    await callPost(room.id, { subjectHandle: '@a', pidChain });
    const response = await callPost(room.id, { subjectHandle: '@b', pidChain });
    expect(response.status).toBe(409);
  });

  it('subjectHandle without @-prefix is normalised', async () => {
    const { room, pidChain } = setup('r7', 7006, '@interviewer', '@kimi');
    const response = await callPost(room.id, { subjectHandle: 'kimi', pidChain });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.interview.subject_handle).toBe('@kimi');
  });
});
