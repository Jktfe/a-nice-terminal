import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  setDigestNote,
  resetChairDigestNoteStoreForTests
} from '$lib/server/chairDigestNoteStore';

function eventForGet() {
  const url = new URL('http://localhost/api/chair/notes');
  const request = new Request(url.toString(), { method: 'GET' });
  return { request, params: {}, url } as unknown as Parameters<typeof GET>[0];
}

async function runHandler(event: Parameters<typeof GET>[0]): Promise<Response> {
  return (await GET(event)) as Response;
}

describe('GET /api/chair/notes', () => {
  beforeEach(() => {
    resetChatRoomStoreForTests();
    resetChairDigestNoteStoreForTests();
  });

  it('returns 200 with an empty list when no notes have been written', async () => {
    const response = await runHandler(eventForGet());
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

    const response = await runHandler(eventForGet());
    const body = (await response.json()) as { notes: { noteText: string }[] };
    expect(body.notes).toHaveLength(2);
    expect(body.notes[0].noteText).toBe('newer');
    expect(body.notes[1].noteText).toBe('older');
  });
});
