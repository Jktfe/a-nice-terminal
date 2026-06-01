import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  resetChatMessageStoreForTests,
  postMessage
} from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  resetInterviewStoreForTests,
  startInterview,
  endInterview
} from '$lib/server/interviewStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-interview-summary-'));
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

async function callGet(interviewId: string): Promise<Response> {
  const event = { params: { interviewId } } as unknown as Parameters<typeof GET>[0];
  try { return (await GET(event)) as Response; }
  catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const fail = thrown as { status?: number; body?: { message?: string } };
    if (typeof fail?.status === 'number') return new Response(JSON.stringify(fail.body ?? {}), { status: fail.status });
    throw thrown;
  }
}

function setupRoomWithInterview(roomName: string) {
  const room = createChatRoom({ name: roomName, whoCreatedIt: '@you' });
  inviteAgentToRoom({ roomId: room.id, agentHandle: '@interviewer' });
  inviteAgentToRoom({ roomId: room.id, agentHandle: '@subject' });
  const interview = startInterview({ roomId: room.id, interviewer: '@interviewer', subjectHandle: '@subject' });
  return { room, interview };
}

describe('GET /api/interviews/:interviewId/summary', () => {
  it('200 + envelope { summary } with status=active and zero messages on a fresh interview', async () => {
    const { interview } = setupRoomWithInterview('s1');
    const response = await callGet(interview.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.summary.interview.id).toBe(interview.id);
    expect(payload.summary.status).toBe('active');
    expect(payload.summary.messageCountTotal).toBe(0);
    expect(payload.summary.firstMessage).toBeNull();
    expect(payload.summary.lastMessage).toBeNull();
  });

  it('counts only messages tagged with discussion_id=interviewId or posted in the window', async () => {
    const { room, interview } = setupRoomWithInterview('s2');
    // tagged-into-interview message
    postMessage({ roomId: room.id, authorHandle: '@interviewer', body: 'opener', discussion_id: interview.id });
    postMessage({ roomId: room.id, authorHandle: '@subject', body: 'answer one', discussion_id: interview.id });
    postMessage({ roomId: room.id, authorHandle: '@interviewer', body: 'follow up', discussion_id: interview.id });
    const response = await callGet(interview.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.summary.messageCountTotal).toBe(3);
    expect(payload.summary.firstMessage.summary).toBe('opener');
    expect(payload.summary.lastMessage.summary).toBe('follow up');
    expect(payload.summary.middleMessage.summary).toBe('answer one');
  });

  it('per-author counts are aggregated and sorted high-to-low', async () => {
    const { room, interview } = setupRoomWithInterview('s3');
    postMessage({ roomId: room.id, authorHandle: '@interviewer', body: 'q1', discussion_id: interview.id });
    postMessage({ roomId: room.id, authorHandle: '@interviewer', body: 'q2', discussion_id: interview.id });
    postMessage({ roomId: room.id, authorHandle: '@subject', body: 'a1', discussion_id: interview.id });
    const response = await callGet(interview.id);
    const payload = await response.json();
    expect(payload.summary.messageCountByAuthor[0]).toEqual({ authorHandle: '@interviewer', count: 2 });
    expect(payload.summary.messageCountByAuthor[1]).toEqual({ authorHandle: '@subject', count: 1 });
  });

  it('status flips to ended + durationMs reflects elapsed wall-clock once interview is ended', async () => {
    const { interview } = setupRoomWithInterview('s4');
    endInterview(interview.id, 'wrap-up');
    const response = await callGet(interview.id);
    const payload = await response.json();
    expect(payload.summary.status).toBe('ended');
    expect(payload.summary.interview.end_reason).toBe('wrap-up');
    expect(payload.summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('404 when interview-id does not exist', async () => {
    const response = await callGet('iv_nonexistent');
    expect(response.status).toBe(404);
  });

  it('long message bodies truncate at 120 chars with an ellipsis in the preview summary', async () => {
    const { room, interview } = setupRoomWithInterview('s5');
    const longBody = 'x'.repeat(200);
    postMessage({ roomId: room.id, authorHandle: '@interviewer', body: longBody, discussion_id: interview.id });
    const response = await callGet(interview.id);
    const payload = await response.json();
    expect(payload.summary.firstMessage.summary.length).toBeLessThanOrEqual(121);
    expect(payload.summary.firstMessage.summary.endsWith('…')).toBe(true);
  });
});
