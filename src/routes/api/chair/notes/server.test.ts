import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  setDigestNote,
  resetChairDigestNoteStoreForTests
} from '$lib/server/chairDigestNoteStore';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'chair-notes-test-admin';

function eventForGet(headers?: HeadersInit) {
  const url = new URL('http://localhost/api/chair/notes');
  const request = new Request(url.toString(), { method: 'GET', headers });
  return { request, params: {}, url } as unknown as Parameters<typeof GET>[0];
}

function adminEventForGet() {
  return eventForGet({ authorization: `Bearer ${TEST_ADMIN_TOKEN}` });
}

async function runHandler(event: Parameters<typeof GET>[0]): Promise<Response> {
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

describe('GET /api/chair/notes', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetChatRoomStoreForTests();
    resetChairDigestNoteStoreForTests();
  });

  afterEach(() => {
    resetChairDigestNoteStoreForTests();
    resetChatRoomStoreForTests();
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('rejects anonymous note-list reads', async () => {
    const response = await runHandler(eventForGet());
    expect(response.status).toBe(401);
  });

  it('returns 200 with an empty list when no notes have been written', async () => {
    const response = await runHandler(adminEventForGet());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { notes: unknown[] };
    expect(body.notes).toEqual([]);
  });

  it('returns 200 with every note, newest first', async () => {
    const roomA = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const roomB = createChatRoom({ name: 'b', whoCreatedIt: '@you' });

    setDigestNote({ roomId: roomA.id, noteText: 'older' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    setDigestNote({ roomId: roomB.id, noteText: 'newer' });

    const response = await runHandler(adminEventForGet());
    const body = (await response.json()) as { notes: { noteText: string }[] };
    expect(body.notes).toHaveLength(2);
    expect(body.notes[0].noteText).toBe('newer');
    expect(body.notes[1].noteText).toBe('older');
  });
});
