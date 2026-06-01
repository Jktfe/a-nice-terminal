import { beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';

function event(id: string, search = '') {
  const url = new URL(`http://localhost/api/sessions/${id}/export${search}`);
  return { params: { id }, url, request: new Request(url) } as unknown as Parameters<typeof GET>[0];
}

async function callOrCaught<T extends (event: any) => any>(fn: T, input: Parameters<T>[0]): Promise<Response> {
  try {
    return (await fn(input)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('/api/sessions/:id/export', () => {
  beforeEach(() => {
    resetChatMessageStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('returns markdown export by default', async () => {
    const room = createChatRoom({ name: 'export route', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello route' });

    const response = await callOrCaught(GET, event(room.id));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    const text = await response.text();
    expect(text).toContain('# export route');
    expect(text).toContain('**@you**: hello route');
  });

  it('returns json export when format=json', async () => {
    const room = createChatRoom({ name: 'json route', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@agent', kind: 'agent', body: 'json body' });

    const response = await callOrCaught(GET, event(room.id, '?format=json'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.room.id).toBe(room.id);
    expect(body.messageCount).toBe(1);
    expect(body.messages[0].body).toBe('json body');
  });

  it('rejects unknown formats', async () => {
    const room = createChatRoom({ name: 'bad format', whoCreatedIt: '@you' });
    const response = await callOrCaught(GET, event(room.id, '?format=xml'));
    expect(response.status).toBe(400);
  });
});
