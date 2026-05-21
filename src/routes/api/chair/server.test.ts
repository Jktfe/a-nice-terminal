/**
 * Endpoint tests for GET /api/chair.
 *
 * Focused on contract: empty-store returns an empty digest array, populated
 * stores yield a digest row per room, and each row carries the full set of
 * digest fields. The store layer has deeper unit coverage in
 * chairStore.test.ts; this file only asserts the wire shape.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';

async function callGet(): Promise<Response> {
  const request = new Request('http://localhost/api/chair');
  const event = {
    request,
    params: {},
    url: new URL('http://localhost/api/chair')
  } as unknown as Parameters<typeof GET>[0];
  return (await GET(event)) as Response;
}

describe('GET /api/chair', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatMessageStoreForTests();
  });

  it('returns 200 with an empty chairDigest array when no rooms exist', async () => {
    const response = await callGet();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.chairDigest).toEqual([]);
  });

  it('returns one digest row per room', async () => {
    createChatRoom({ name: 'alpha', whoCreatedIt: '@you' });
    createChatRoom({ name: 'beta', whoCreatedIt: '@you' });
    const response = await callGet();
    const body = await response.json();
    expect(body.chairDigest).toHaveLength(2);
  });

  it('each row carries the full set of digest fields', async () => {
    createChatRoom({ name: 'fields', whoCreatedIt: '@you' });
    const response = await callGet();
    const body = await response.json();
    for (const digestRow of body.chairDigest) {
      expect(typeof digestRow.roomId).toBe('string');
      expect(typeof digestRow.roomName).toBe('string');
      expect(typeof digestRow.memberCount).toBe('number');
      expect(typeof digestRow.messageCountTotal).toBe('number');
      expect(typeof digestRow.messageCountHuman).toBe('number');
      expect(typeof digestRow.messageCountAgent).toBe('number');
      expect(typeof digestRow.messageCountSystem).toBe('number');
      // lastMessagePostedAt / lastMessageSummary / lastBreakPostedAt /
      // needsAttentionReason are nullable, so they appear in the object even
      // when null.
      expect('lastMessagePostedAt' in digestRow).toBe(true);
      expect('lastMessageSummary' in digestRow).toBe(true);
      expect('lastBreakPostedAt' in digestRow).toBe(true);
      expect('needsAttentionReason' in digestRow).toBe(true);
    }
  });
});
