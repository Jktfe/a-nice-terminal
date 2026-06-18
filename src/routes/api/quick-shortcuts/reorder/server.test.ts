/**
 * Endpoint tests for POST /api/quick-shortcuts/reorder.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import {
  createQuickShortcut,
  listQuickShortcuts,
  resetQuickShortcutsStoreForTests
} from '$lib/server/quickShortcutsStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { getIdentityDb } from '$lib/server/db';

function resetBrowserSessionFixtures(): void {
  const db = getIdentityDb();
  db.prepare('DELETE FROM browser_sessions').run();
  db.prepare('DELETE FROM room_memberships').run();
  db.prepare('DELETE FROM terminals').run();
  resetChatRoomStoreForTests();
}

function browserSessionCookieFor(handle: string): string {
  const room = createChatRoom({ name: `owner-${handle}`, whoCreatedIt: handle });
  const terminal = upsertTerminal({ pid: Math.floor(Math.random() * 10_000) + 1, pid_start: 'p', name: `term-${handle}` });
  addMembership({ room_id: room.id, handle, terminal_id: terminal.id });
  const session = createBrowserSession({ roomId: room.id, authorHandle: handle });
  if (!session) throw new Error(`Failed to create browser session for ${handle}`);
  return `ant_browser_session=${session.browserSessionSecret}`;
}

function eventFor(body?: string, cookie?: string) {
  const url = new URL('http://localhost/api/quick-shortcuts/reorder');
  const request = new Request(url.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body
  });
  return { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof POST>[0]) => unknown,
  event: Parameters<typeof POST>[0]
): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as {
      status?: number;
      body?: { message?: string };
    };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrownByHandler;
  }
}

const callPost = (body?: string, cookie?: string) => runHandler(POST, eventFor(body, cookie));

describe('/api/quick-shortcuts/reorder', () => {
  beforeEach(() => {
    resetQuickShortcutsStoreForTests();
    resetBrowserSessionFixtures();
  });

  it('reorders shortcuts in the requested sequence and returns 200', async () => {
    const a = createQuickShortcut({ label: 'a', text: 'a' });
    const b = createQuickShortcut({ label: 'b', text: 'b' });
    const c = createQuickShortcut({ label: 'c', text: 'c' });

    const response = await callPost(JSON.stringify({ ids: [c.id, a.id, b.id] }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { shortcuts: { id: string }[] };
    expect(payload.shortcuts.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
  });

  it('ignores unknown ids in the input', async () => {
    const a = createQuickShortcut({ label: 'a', text: 'a' });
    const b = createQuickShortcut({ label: 'b', text: 'b' });
    const response = await callPost(
      JSON.stringify({ ids: [b.id, 'unknown', a.id] })
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { shortcuts: { id: string }[] };
    expect(payload.shortcuts.map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('returns 400 for a non-JSON body', async () => {
    const url = new URL('http://localhost/api/quick-shortcuts/reorder');
    const request = new Request(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json'
    });
    const event = { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
    const response = await runHandler(POST, event);
    expect(response.status).toBe(400);
  });

  it('returns 400 when ids is missing', async () => {
    const response = await callPost(JSON.stringify({}));
    expect(response.status).toBe(400);
  });

  it('returns 400 when ids is not an array', async () => {
    const response = await callPost(JSON.stringify({ ids: 'not-an-array' }));
    expect(response.status).toBe(400);
  });

  it('returns 400 when ids contains a non-string entry', async () => {
    const a = createQuickShortcut({ label: 'a', text: 'a' });
    const response = await callPost(
      JSON.stringify({ ids: [a.id, 123] })
    );
    expect(response.status).toBe(400);
  });

  it('handles an empty ids array (no-op, returns current list)', async () => {
    const a = createQuickShortcut({ label: 'a', text: 'a' });
    const response = await callPost(JSON.stringify({ ids: [] }));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { shortcuts: { id: string }[] };
    expect(payload.shortcuts.map((s) => s.id)).toEqual([a.id]);
  });

  it('reorders only the browser-session owner bucket', async () => {
    const aliceA = createQuickShortcut({ ownerHandle: '@alice', label: 'alice-a', text: 'a' });
    const aliceB = createQuickShortcut({ ownerHandle: '@alice', label: 'alice-b', text: 'b' });
    const bobA = createQuickShortcut({ ownerHandle: '@bob', label: 'bob-a', text: 'a' });
    const bobB = createQuickShortcut({ ownerHandle: '@bob', label: 'bob-b', text: 'b' });

    const response = await callPost(
      JSON.stringify({ ids: [aliceB.id, aliceA.id, bobB.id] }),
      browserSessionCookieFor('@alice')
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { shortcuts: { id: string }[] };
    expect(payload.shortcuts.map((s) => s.id)).toEqual([aliceB.id, aliceA.id]);
    expect(listQuickShortcuts('@bob').map((s) => s.id)).toEqual([bobA.id, bobB.id]);
  });
});
