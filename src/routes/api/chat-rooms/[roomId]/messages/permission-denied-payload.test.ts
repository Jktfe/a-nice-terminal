/**
 * Integration tests for the Stage A 403 PermissionDenied payload at the
 * chat-room messages endpoint (plan milestone p3-stage-a-403-payload of
 * ant-substrate-v0.2-2026-05-29).
 *
 * Covers T1 of the PR spec — send to a room without identity → 403 with
 * reason='identity_unresolved' + room_owner in approvers + the
 * approve_command string we promise the CLI renders.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import { resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { resetAntchatAuthTokensForTests } from '$lib/server/antchatAuthStore';
import { resetAskStoreForTests } from '$lib/server/askStore';
import { resetMessageReactionStoreForTests } from '$lib/server/messageReactionStore';
import {
  isPermissionDeniedPayload,
  type PermissionDeniedPayload
} from '$lib/server/permissionDeniedPayload';

async function callPost(roomId: string, body: unknown): Promise<Response> {
  const request = new Request(
    `http://localhost/api/chat-rooms/${roomId}/messages`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }
  );
  const event = {
    request,
    params: { roomId },
    url: new URL(`http://localhost/api/chat-rooms/${roomId}/messages`)
  } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: unknown };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), {
        status: failure.status
      });
    }
    throw thrown;
  }
}

beforeEach(() => {
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetAntchatAuthTokensForTests();
  resetAskStoreForTests();
  resetMessageReactionStoreForTests();
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
});

describe('Stage A 403 PermissionDenied payload — chat messages POST', () => {
  it('T1: unauthenticated send returns the structured permission_denied block', async () => {
    const room = createChatRoom({ name: 'speed matters', whoCreatedIt: '@jwpk' });
    const response = await callPost(room.id, { body: 'hello' });
    expect(response.status).toBe(403);
    const body = (await response.json()) as unknown;
    expect(isPermissionDeniedPayload(body)).toBe(true);
    const payload = body as PermissionDeniedPayload;
    expect(payload.permission_denied.action).toBe('chat.post');
    expect(payload.permission_denied.target_kind).toBe('room');
    expect(payload.permission_denied.target_id).toBe(room.id);
    expect(payload.permission_denied.target_display_name).toBe('speed matters');
    expect(payload.permission_denied.reason).toBe('identity_unresolved');
    expect(payload.permission_denied.approvers).toHaveLength(1);
    expect(payload.permission_denied.approvers[0].handle).toBe('@jwpk');
    expect(payload.permission_denied.approvers[0].role).toBe('room_owner');
    expect(payload.permission_denied.approvers[0].preferred).toBe(true);
    // T6 string-equal check.
    expect(payload.permission_denied.approve_command).toBe(
      `ant grant @you chat.post --room ${room.id}`
    );
  });
});
