import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  resetChatAttachmentStoreForTests,
  shareFileInRoom
} from '$lib/server/chatAttachmentStore';

const tinyBase64 = Buffer.from('hello world').toString('base64');

async function callGet(roomId: string, attachmentId: string): Promise<Response> {
  const url = `http://localhost/api/chat-rooms/${roomId}/attachments/${attachmentId}`;
  const event = {
    request: new Request(url),
    params: { roomId, attachmentId },
    url: new URL(url)
  } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('GET /api/chat-rooms/:roomId/attachments/:attachmentId', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatAttachmentStoreForTests();
  });

  it('returns the file bytes with the right headers', async () => {
    const room = createChatRoom({ name: 'with-file', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const file = shareFileInRoom({
      roomId: room.id,
      filename: 'notes.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@a'
    });

    const response = await callGet(room.id, file.id);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain');
    const disposition = response.headers.get('content-disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('notes.txt');
    const buffer = await response.arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe('hello world');
  });

  it('returns 404 when the room is unknown', async () => {
    const response = await callGet('does_not_exist', 'file_x');
    expect(response.status).toBe(404);
  });

  it('returns 404 when the attachment is unknown', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const response = await callGet(room.id, 'file_does_not_exist');
    expect(response.status).toBe(404);
  });

  it('returns 404 when the attachment lives in a different room', async () => {
    const roomA = createChatRoom({ name: 'A', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'B', whoCreatedIt: '@you' });
    const fileInA = shareFileInRoom({
      roomId: roomA.id,
      filename: 'secret.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    const response = await callGet(roomB.id, fileInA.id);
    expect(response.status).toBe(404);
  });

  it('URL-encodes the filename so unicode names round-trip cleanly', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const file = shareFileInRoom({
      roomId: room.id,
      filename: 'café-notes.txt',
      mimeType: 'text/plain',
      contentsBase64: tinyBase64,
      uploadedByHandle: '@you'
    });
    const response = await callGet(room.id, file.id);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('filename*=UTF-8');
    expect(disposition).toContain(encodeURIComponent('café-notes.txt'));
  });
});
