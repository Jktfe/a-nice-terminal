import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PATCH } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetChatMessageStoreForTests, listMessagesInRoom } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { resetInterviewStoreForTests, startInterview, getActiveInterview } from '$lib/server/interviewStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-interview-end-'));
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

async function callPatch(interviewId: string, body: object): Promise<Response> {
  const url = `http://localhost/api/interviews/${interviewId}/end`;
  const request = new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const event = { request, params: { interviewId } } as unknown as Parameters<typeof PATCH>[0];
  try { return (await PATCH(event)) as Response; }
  catch (t) {
    if (t instanceof Response) return t;
    const f = t as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw t;
  }
}

function setupActiveInterview(roomName: string, interviewerPid: number, subjectPid: number, otherMemberPid?: number) {
  const room = createChatRoom({ name: roomName, whoCreatedIt: '@you' });
  const interviewerTerm = upsertTerminal({ pid: interviewerPid, pid_start: `ps${interviewerPid}`, name: '@interviewer' });
  const subjectTerm = upsertTerminal({ pid: subjectPid, pid_start: `ps${subjectPid}`, name: '@subject' });
  // room_memberships for identity-gate AND chat_room_members for display roster (interviewStore checks the latter)
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

describe('PATCH /api/interviews/:interviewId/end', () => {
  it('200 + changed=true + system message when interviewer ends (gate watchpoint test 1)', async () => {
    const { room, interview, interviewerPidChain } = setupActiveInterview('r1', 8001, 8002);
    const response = await callPatch(interview.id, { pidChain: interviewerPidChain });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.changed).toBe(true);
    expect(payload.interview.ended_at_ms).not.toBeNull();
    expect(getActiveInterview(room.id)).toBeNull();
    expect(listMessagesInRoom(room.id).some((m) => m.kind === 'system' && m.body.includes('ended'))).toBe(true);
  });

  it('200 + changed=true when SUBJECT ends (gate watchpoint test 2 — delta-1 lock)', async () => {
    const { interview, subjectPidChain } = setupActiveInterview('r2', 8003, 8004);
    const response = await callPatch(interview.id, { pidChain: subjectPidChain });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.changed).toBe(true);
  });

  it('403 when ORDINARY OTHER ROOM MEMBER tries to end (gate watchpoint test 3 — delta-1 authority lock)', async () => {
    const { interview, otherPidChain } = setupActiveInterview('r3', 8005, 8006, 8007);
    const response = await callPatch(interview.id, { pidChain: otherPidChain! });
    expect(response.status).toBe(403);
    const payload = await response.json();
    expect(payload.message).toMatch(/interviewer or the subject/);
  });

  it('403 when NON-MEMBER tries to end (gate watchpoint test 4)', async () => {
    const { interview } = setupActiveInterview('r4', 8008, 8009);
    const response = await callPatch(interview.id, { pidChain: [{ pid: 99999, pid_start: 'fake' }] });
    expect(response.status).toBe(403);
  });

  it('200 + changed=false when already-ended (gate watchpoint test 5 — idempotent)', async () => {
    const { interview, interviewerPidChain } = setupActiveInterview('r5', 8010, 8011);
    await callPatch(interview.id, { pidChain: interviewerPidChain });
    const second = await callPatch(interview.id, { pidChain: interviewerPidChain });
    expect(second.status).toBe(200);
    const payload = await second.json();
    expect(payload.changed).toBe(false);
  });

  it('404 when interview-id does not exist', async () => {
    const response = await callPatch('iv_nonexistent', { pidChain: [{ pid: 1, pid_start: 'p' }] });
    expect(response.status).toBe(404);
  });

  it('optional --reason persists as end_reason on the row', async () => {
    const { interview, interviewerPidChain } = setupActiveInterview('r7', 8012, 8013);
    const response = await callPatch(interview.id, { pidChain: interviewerPidChain, reason: 'context exhausted' });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.interview.end_reason).toBe('context exhausted');
  });
});
