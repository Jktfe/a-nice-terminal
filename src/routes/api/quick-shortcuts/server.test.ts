/**
 * Endpoint tests for GET/POST /api/quick-shortcuts.
 *
 * Style mirrors members/server.test.ts: eventFor + runHandler helpers,
 * resetQuickShortcutsStoreForTests in beforeEach.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  createQuickShortcut,
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

function eventFor(method: 'GET' | 'POST', body?: string, cookie?: string) {
  const url = new URL('http://localhost/api/quick-shortcuts');
  const request = new Request(url.toString(), {
    method,
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

const callGet = (cookie?: string) => runHandler(GET, eventFor('GET', undefined, cookie));
const callPost = (body?: string) => runHandler(POST, eventFor('POST', body));

describe('/api/quick-shortcuts', () => {
  beforeEach(() => {
    resetQuickShortcutsStoreForTests();
    resetBrowserSessionFixtures();
  });

  describe('GET', () => {
    it('returns an empty list when no shortcuts exist', async () => {
      const response = await callGet();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { shortcuts: unknown[] };
      expect(payload.shortcuts).toEqual([]);
    });

    it('returns existing shortcuts ordered by orderIndex ASC', async () => {
      const a = createQuickShortcut({ label: 'a', text: 'a' });
      const b = createQuickShortcut({ label: 'b', text: 'b' });
      const response = await callGet();
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        shortcuts: { id: string }[];
      };
      expect(payload.shortcuts.map((s) => s.id)).toEqual([a.id, b.id]);
    });

    it('returns only shortcuts owned by the browser-session handle', async () => {
      const mine = createQuickShortcut({ ownerHandle: '@alice', label: 'mine', text: 'mine' });
      createQuickShortcut({ ownerHandle: '@bob', label: 'theirs', text: 'theirs' });
      const response = await callGet(browserSessionCookieFor('@alice'));
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        shortcuts: { id: string; ownerHandle: string }[];
      };
      expect(payload.shortcuts).toEqual([
        expect.objectContaining({ id: mine.id, ownerHandle: '@alice' })
      ]);
    });
  });

  describe('POST', () => {
    it('creates a shortcut and returns 201 with the new row', async () => {
      const response = await callPost(
        JSON.stringify({ label: 'exit', text: 'exit' })
      );
      expect(response.status).toBe(201);
      const payload = (await response.json()) as {
        shortcut: {
          id: string;
          label: string;
          text: string;
          autoEnter: boolean;
          orderIndex: number;
        };
      };
      expect(payload.shortcut.label).toBe('exit');
      expect(payload.shortcut.text).toBe('exit');
      expect(payload.shortcut.autoEnter).toBe(true);
      expect(payload.shortcut.id.length).toBeGreaterThan(0);
    });

    it('honours explicit autoEnter false', async () => {
      const response = await callPost(
        JSON.stringify({ label: 'paste', text: 'hello', autoEnter: false })
      );
      expect(response.status).toBe(201);
      const payload = (await response.json()) as {
        shortcut: { autoEnter: boolean };
      };
      expect(payload.shortcut.autoEnter).toBe(false);
    });

    it('returns 400 for a non-JSON body', async () => {
      const url = new URL('http://localhost/api/quick-shortcuts');
      const request = new Request(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json'
      });
      const event = { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
      const response = await runHandler(POST, event);
      expect(response.status).toBe(400);
    });

    it('returns 400 when label is missing', async () => {
      const response = await callPost(JSON.stringify({ text: 'x' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when text is missing', async () => {
      const response = await callPost(JSON.stringify({ label: 'x' }));
      expect(response.status).toBe(400);
    });

    it('returns 400 when label trims to empty', async () => {
      const response = await callPost(
        JSON.stringify({ label: '   ', text: 'x' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when text trims to empty', async () => {
      const response = await callPost(
        JSON.stringify({ label: 'x', text: '   ' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when label is not a string', async () => {
      const response = await callPost(
        JSON.stringify({ label: 123, text: 'x' })
      );
      expect(response.status).toBe(400);
    });
  });
});
