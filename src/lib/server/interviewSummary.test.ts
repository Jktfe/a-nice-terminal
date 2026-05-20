import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { startInterview, endInterview, resetInterviewStoreForTests } from './interviewStore';
import { postMessage, resetChatMessageStoreForTests } from './chatMessageStore';
import { buildInterviewSummary } from './interviewSummary';
import { randomUUID } from 'node:crypto';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

function addMember(roomId: string, handle: string) {
  getIdentityDb().prepare(
    `INSERT INTO chat_room_members
      (id, room_id, handle, display_name, display_color, display_icon, display_background_style, joined_at, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'human')`
  ).run(randomUUID(), roomId, handle, handle, null, null, null, Date.now());
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetInterviewStoreForTests();
  resetChatMessageStoreForTests();
});

afterEach(() => {
  resetChatMessageStoreForTests();
  resetInterviewStoreForTests();
  resetChatRoomStoreForTests();
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('interviewSummary', () => {
  it('returns null for unknown interview', () => {
    expect(buildInterviewSummary('missing')).toBeNull();
  });

  function setupRoom() {
    const room = createChatRoom({ name: 'Room 1', whoCreatedIt: '@you' });
    addMember(room.id, '@cli');
    return room;
  }

  it('builds summary for an active interview with messages', () => {
    const room = setupRoom();
    const iv = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@cli', nowMs: 1_000 });

    postMessage({ roomId: room.id, authorHandle: '@you', body: 'First message', discussion_id: iv.id });
    postMessage({ roomId: room.id, authorHandle: '@cli', body: 'Second message', discussion_id: iv.id });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'Third message', discussion_id: iv.id });

    const summary = buildInterviewSummary(iv.id)!;
    expect(summary.status).toBe('active');
    expect(summary.messageCountTotal).toBe(3);
    expect(summary.firstMessage!.summary).toBe('First message');
    expect(summary.lastMessage!.summary).toBe('Third message');
    expect(summary.middleMessage!.summary).toBe('Second message');
    expect(summary.messageCountByAuthor).toHaveLength(2);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('builds summary for ended interview', () => {
    const room = setupRoom();
    const iv = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@cli', nowMs: 1_000 });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'Hello', discussion_id: iv.id });
    endInterview(iv.id, 'done', 5_000);

    const summary = buildInterviewSummary(iv.id)!;
    expect(summary.status).toBe('ended');
    expect(summary.durationMs).toBe(4_000);
  });

  it('ignores messages outside the interview window', () => {
    const room = setupRoom();
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'Before' });

    const iv = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@cli', nowMs: 10_000 });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'During', discussion_id: iv.id });
    endInterview(iv.id, 'done', 20_000);

    postMessage({ roomId: room.id, authorHandle: '@you', body: 'After' });

    const summary = buildInterviewSummary(iv.id)!;
    expect(summary.messageCountTotal).toBe(1);
    expect(summary.firstMessage!.summary).toBe('During');
  });

  it('counts messages by author sorted desc', () => {
    const room = setupRoom();
    const iv = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@cli', nowMs: 1_000 });

    postMessage({ roomId: room.id, authorHandle: '@cli', body: '1', discussion_id: iv.id });
    postMessage({ roomId: room.id, authorHandle: '@cli', body: '2', discussion_id: iv.id });
    postMessage({ roomId: room.id, authorHandle: '@you', body: '3', discussion_id: iv.id });

    const summary = buildInterviewSummary(iv.id)!;
    expect(summary.messageCountByAuthor[0].authorHandle).toBe('@cli');
    expect(summary.messageCountByAuthor[0].count).toBe(2);
    expect(summary.messageCountByAuthor[1].authorHandle).toBe('@you');
    expect(summary.messageCountByAuthor[1].count).toBe(1);
  });

  it('summarises long bodies to 120 chars + ellipsis', () => {
    const room = setupRoom();
    const iv = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@cli', nowMs: 1_000 });
    const longBody = 'a'.repeat(200);
    postMessage({ roomId: room.id, authorHandle: '@you', body: longBody, discussion_id: iv.id });

    const summary = buildInterviewSummary(iv.id)!;
    expect(summary.firstMessage!.summary).toBe('a'.repeat(120) + '…');
  });

  it('returns null middle message for < 3 messages', () => {
    const room = setupRoom();
    const iv = startInterview({ roomId: room.id, interviewer: '@you', subjectHandle: '@cli', nowMs: 1_000 });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'One', discussion_id: iv.id });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'Two', discussion_id: iv.id });

    const summary = buildInterviewSummary(iv.id)!;
    expect(summary.middleMessage).toBeNull();
  });
});
