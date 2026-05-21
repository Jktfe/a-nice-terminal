import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  startInterview,
  endInterview,
  getActiveInterview,
  getInterviewById,
  listInterviewsForRoom,
  resetInterviewStoreForTests,
  InterviewSubjectNotMemberError,
  InterviewSelfInterviewError,
  InterviewAlreadyActiveError
} from './interviewStore';
import { createChatRoom, inviteAgentToRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { resetIdentityDbForTests } from './db';

beforeEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetInterviewStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
});

describe('interviewStore.startInterview', () => {
  it('happy path: creates row, sets current_interview_id, returns row with ended_at_ms NULL', () => {
    const room = createChatRoom({ name: 'r1', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const result = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@kimi', nowMs: 100 });
    expect(result.id).toMatch(/^iv_/);
    expect(result.interviewer).toBe('@you');
    expect(result.subject_handle).toBe('@kimi');
    expect(result.ended_at_ms).toBeNull();
    const active = getActiveInterview(room.id);
    expect(active?.id).toBe(result.id);
  });

  it('throws InterviewSubjectNotMemberError when subject is not a room member', () => {
    const room = createChatRoom({ name: 'r2', whoCreatedIt: '@you' });
    expect(() =>
      startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@stranger' })
    ).toThrow(InterviewSubjectNotMemberError);
    expect(getActiveInterview(room.id)).toBeNull();
  });

  it('throws InterviewSelfInterviewError when interviewer === subject', () => {
    const room = createChatRoom({ name: 'r3', whoCreatedIt: '@you' });
    expect(() =>
      startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@you' })
    ).toThrow(InterviewSelfInterviewError);
  });

  it('throws InterviewAlreadyActiveError when another active interview exists in same room', () => {
    const room = createChatRoom({ name: 'r4', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });
    startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@a', nowMs: 100 });
    expect(() =>
      startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@b', nowMs: 200 })
    ).toThrow(InterviewAlreadyActiveError);
  });

  it('throws plain Error on unknown room', () => {
    expect(() =>
      startInterview({ roomId: 'phantom', interviewer: '@you', subjectHandle: '@x' })
    ).toThrow(/No room found/);
  });
});

describe('interviewStore.endInterview', () => {
  it('happy path: sets ended_at_ms + clears current_interview_id', () => {
    const room = createChatRoom({ name: 'r5', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const started = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@kimi', nowMs: 100 });
    const result = endInterview(started.id, 'wrap-up', 200);
    expect(result.changed).toBe(true);
    expect(result.interview.ended_at_ms).toBe(200);
    expect(result.interview.end_reason).toBe('wrap-up');
    expect(getActiveInterview(room.id)).toBeNull();
  });

  it('idempotent on already-ended interview: changed=false', () => {
    const room = createChatRoom({ name: 'r6', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@k' });
    const started = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@k' });
    endInterview(started.id);
    const second = endInterview(started.id);
    expect(second.changed).toBe(false);
  });

  it('throws plain Error on unknown interview id', () => {
    expect(() => endInterview('iv_nonexistent')).toThrow(/No interview found/);
  });

  it('starting a new interview after end is allowed (no-active-in-room cleared)', () => {
    const room = createChatRoom({ name: 'r7', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });
    const first = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@a', nowMs: 100 });
    endInterview(first.id);
    const second = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@b', nowMs: 200 });
    expect(second.id).not.toBe(first.id);
    expect(getActiveInterview(room.id)?.id).toBe(second.id);
  });

  it('listInterviewsForRoom returns newest-first ordered by started_at_ms', () => {
    const room = createChatRoom({ name: 'r8', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@b' });
    const first = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@a', nowMs: 100 });
    endInterview(first.id);
    const second = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@b', nowMs: 200 });
    const list = listInterviewsForRoom(room.id);
    expect(list.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('interview rows cascade-delete when room is removed', () => {
    const room = createChatRoom({ name: 'doomed', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const started = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@kimi' });
    expect(getInterviewById(started.id)).toBeTruthy();
    resetChatRoomStoreForTests();
    expect(getInterviewById(started.id)).toBeNull();
  });
});
