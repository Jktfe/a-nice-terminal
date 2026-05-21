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
import {
  resetInterviewStoreForTests,
  startInterview,
  endInterview
} from '$lib/server/interviewStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-interview-messages-'));
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

async function callPost(interviewId: string, body: object): Promise<Response> {
  const url = `http://localhost/api/interviews/${interviewId}/messages`;
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const event = { request, params: { interviewId } } as unknown as Parameters<typeof POST>[0];
  try { return (await POST(event)) as Response; }
  catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const fail = thrown as { status?: number; body?: { message?: string } };
    if (typeof fail?.status === 'number') return new Response(JSON.stringify(fail.body ?? {}), { status: fail.status });
    throw thrown;
  }
}

function setupActiveInterview(roomName: string, interviewerPid: number, subjectPid: number, otherMemberPid?: number) {
  const room = createChatRoom({ name: roomName, whoCreatedIt: '@you' });
  const interviewerTerm = upsertTerminal({ pid: interviewerPid, pid_start: `ps${interviewerPid}`, name: '@interviewer' });
  const subjectTerm = upsertTerminal({ pid: subjectPid, pid_start: `ps${subjectPid}`, name: '@subject' });
  addMembership({ room_id: room.id, handle: '@interviewer', terminal_id: interviewerTerm.id });
  addMembership({ room_id: room.id, handle: '@subject', terminal_id: subjectTerm.id });
  inviteAgentToRoom({ roomId: room.id, agentHandle: '@interviewer' });
  inviteAgentToRoom({ roomId: room.id, agentHandle: '@subject' });
  let otherPidChain: { pid: number; pid_start: string }[] | null = null;
  if (otherMemberPid) {
    const otherTerm = upsertTerminal({ pid: otherMemberPid, pid_start: `ps${otherMemberPid}`, name: '@other' });
    addMembership({ room_id: room.id, handle: '@other', terminal_id: otherTerm.id });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@other' });
    otherPidChain = [{ pid: otherMemberPid, pid_start: `ps${otherMemberPid}` }];
  }
  const interview = startInterview({ roomId: room.id, interviewer: '@interviewer', subjectHandle: '@subject' });
  return {
    room,
    interview,
    interviewerPidChain: [{ pid: interviewerPid, pid_start: `ps${interviewerPid}` }],
    subjectPidChain: [{ pid: subjectPid, pid_start: `ps${subjectPid}` }],
    otherPidChain
  };
}

describe('POST /api/interviews/:interviewId/messages', () => {
  it('201 + posts message tagged with discussion_id=interviewId when interviewer sends', async () => {
    const { room, interview, interviewerPidChain } = setupActiveInterview('r1', 7001, 7002);
    const response = await callPost(interview.id, { pidChain: interviewerPidChain, body: 'first question' });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.body).toBe('first question');
    expect(payload.message.authorHandle).toBe('@interviewer');
    expect(payload.message.discussion_id).toBe(interview.id);
    expect(listMessagesInRoom(room.id).some((m) => m.id === payload.message.id)).toBe(true);
  });

  it('201 when SUBJECT sends — subject is allowed to drive the interview', async () => {
    const { interview, subjectPidChain } = setupActiveInterview('r2', 7003, 7004);
    const response = await callPost(interview.id, { pidChain: subjectPidChain, body: 'my answer' });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@subject');
  });

  it('403 when ORDINARY OTHER ROOM MEMBER tries to send', async () => {
    const { interview, otherPidChain } = setupActiveInterview('r3', 7005, 7006, 7007);
    const response = await callPost(interview.id, { pidChain: otherPidChain!, body: 'eavesdrop' });
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.message).toMatch(/interviewer or the subject/);
  });

  it('409 when interview has already ended', async () => {
    const { interview, interviewerPidChain } = setupActiveInterview('r4', 7008, 7009);
    endInterview(interview.id, 'wrap');
    const response = await callPost(interview.id, { pidChain: interviewerPidChain, body: 'too late' });
    expect(response.status).toBe(409);
  });

  it('404 when interview-id does not exist', async () => {
    const response = await callPost('iv_nonexistent', { pidChain: [{ pid: 1, pid_start: 'p' }], body: 'hi' });
    expect(response.status).toBe(404);
  });

  it('400 when body is not a string', async () => {
    const { interview, interviewerPidChain } = setupActiveInterview('r5', 7010, 7011);
    const response = await callPost(interview.id, { pidChain: interviewerPidChain, body: 42 });
    expect(response.status).toBe(400);
  });

  it('attribution is server-resolved — client authorHandle is ignored', async () => {
    const { interview, interviewerPidChain } = setupActiveInterview('r6', 7012, 7013);
    const response = await callPost(interview.id, {
      pidChain: interviewerPidChain,
      body: 'who am I',
      authorHandle: '@imposter'
    });
    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.message.authorHandle).toBe('@interviewer');
  });
});
