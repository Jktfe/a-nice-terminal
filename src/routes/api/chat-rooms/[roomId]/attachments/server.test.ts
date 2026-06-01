import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  listFilesSharedInRoom,
  resetChatAttachmentStoreForTests
} from '$lib/server/chatAttachmentStore';

// LAUNCH-BLOCKER CVE FIX D (2026-05-20): attachments POST now requires
// chatRoomAuthGate. Tests supply admin Bearer by default.
const ADMIN_TOKEN_FOR_TESTS = 'attachments-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

const tinyBase64 = Buffer.from('hello world').toString('base64');

type PostOptions = {
  roomId: string;
  body?: string;
  withAuth?: boolean;
};

async function callPost(options: PostOptions): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.withAuth !== false) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const request = new Request(
    `http://localhost/api/chat-rooms/${options.roomId}/attachments`,
    { method: 'POST', headers, body: options.body }
  );
  const event = {
    request,
    params: { roomId: options.roomId },
    url: new URL(`http://localhost/api/chat-rooms/${options.roomId}/attachments`)
  } as unknown as Parameters<typeof POST>[0];
  try {
    return (await POST(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

async function callGet(roomId: string): Promise<Response> {
  const request = new Request(`http://localhost/api/chat-rooms/${roomId}/attachments`);
  const event = {
    request,
    params: { roomId },
    url: new URL(`http://localhost/api/chat-rooms/${roomId}/attachments`)
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

describe('POST + GET /api/chat-rooms/:roomId/attachments', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChatAttachmentStoreForTests();
  });

  it('POST stores a file and GET lists it without contents', async () => {
    const room = createChatRoom({ name: 'with-files', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const postResponse = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'notes.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@kimi'
      })
    });
    expect(postResponse.status).toBe(201);
    const postBody = await postResponse.json();
    expect(postBody.sharedFile.filename).toBe('notes.txt');
    expect(postBody.sharedFile.contentsBase64).toBeUndefined();

    const getResponse = await callGet(room.id);
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.sharedFiles).toHaveLength(1);
    expect(getBody.sharedFiles[0].filename).toBe('notes.txt');
    expect(getBody.sharedFiles[0].contentsBase64).toBeUndefined();
  });

  it('POST returns 404 when the room is unknown', async () => {
    const response = await callPost({
      roomId: 'does_not_exist',
      body: JSON.stringify({
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@you'
      })
    });
    expect(response.status).toBe(404);
  });

  it('GET returns 404 when the room is unknown', async () => {
    const response = await callGet('does_not_exist');
    expect(response.status).toBe(404);
  });

  it('POST rejects a non-member uploader before checking other fields', async () => {
    const room = createChatRoom({ name: 'membership', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@stranger'
      })
    });
    expect(response.status).toBe(404);
    expect(listFilesSharedInRoom(room.id)).toEqual([]);
  });

  it('POST accepts a padded uploadedByHandle by trimming it before the member check', async () => {
    const room = createChatRoom({ name: 'padded-handle', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@codex' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '   @codex   '
      })
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.sharedFile.uploadedByHandle).toBe('@codex');
  });

  it('POST rejects contentsBase64 with invalid characters (after membership check)', async () => {
    const room = createChatRoom({ name: 'bad-base64', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.bin',
        mimeType: 'application/octet-stream',
        contentsBase64: '!!!!',
        uploadedByHandle: '@a'
      })
    });
    expect(response.status).toBe(400);
  });

  it('POST rejects contentsBase64 whose length is not a multiple of 4', async () => {
    const room = createChatRoom({ name: 'pad-length', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.bin',
        mimeType: 'application/octet-stream',
        contentsBase64: 'AQI',
        uploadedByHandle: '@a'
      })
    });
    expect(response.status).toBe(400);
  });

  it('POST normalises a bare handle to @handle', async () => {
    const room = createChatRoom({ name: 'normalise', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@bob' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: 'bob'
      })
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.sharedFile.uploadedByHandle).toBe('@bob');
  });

  it('POST returns 400 when uploadedByHandle is missing', async () => {
    const room = createChatRoom({ name: 'no-handle', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64
      })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when filename is missing (after membership check)', async () => {
    const room = createChatRoom({ name: 'no-filename', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@a'
      })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when mimeType is missing (after membership check)', async () => {
    const room = createChatRoom({ name: 'no-mime', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.txt',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@a'
      })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when contentsBase64 is missing or empty', async () => {
    const room = createChatRoom({ name: 'no-bytes', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'a.txt',
        mimeType: 'text/plain',
        contentsBase64: '',
        uploadedByHandle: '@a'
      })
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is malformed JSON', async () => {
    const room = createChatRoom({ name: 'malformed', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: '{ broken' });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is a JSON array', async () => {
    const room = createChatRoom({ name: 'array', whoCreatedIt: '@you' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify(['nope'])
    });
    expect(response.status).toBe(400);
  });

  it('POST returns 400 when body is empty', async () => {
    const room = createChatRoom({ name: 'empty', whoCreatedIt: '@you' });
    const response = await callPost({ roomId: room.id, body: '' });
    expect(response.status).toBe(400);
  });

  it('GET returns files newest first across uploads', async () => {
    const room = createChatRoom({ name: 'ordered', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@a' });
    await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'first.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@a'
      })
    });
    await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'second.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@a'
      })
    });
    const getResponse = await callGet(room.id);
    const getBody = await getResponse.json();
    expect(getBody.sharedFiles.map((file: { filename: string }) => file.filename)).toEqual([
      'second.txt',
      'first.txt'
    ]);
  });

  // LAUNCH-BLOCKER CVE FIX D (2026-05-20)
  it('POST returns 401 when no auth header is provided', async () => {
    const room = createChatRoom({ name: 'unauth-attach', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@kimi' });
    const response = await callPost({
      roomId: room.id,
      body: JSON.stringify({
        filename: 'no.txt',
        mimeType: 'text/plain',
        contentsBase64: tinyBase64,
        uploadedByHandle: '@kimi'
      }),
      withAuth: false
    });
    expect(response.status).toBe(401);
    expect(listFilesSharedInRoom(room.id)).toEqual([]);
  });
});
