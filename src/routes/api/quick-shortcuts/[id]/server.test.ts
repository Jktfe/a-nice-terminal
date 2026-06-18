/**
 * Endpoint tests for PATCH/DELETE /api/quick-shortcuts/:id.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PATCH, DELETE } from './+server';
import {
  createQuickShortcut,
  findQuickShortcutById,
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

function eventFor(method: 'PATCH' | 'DELETE', id: string, body?: string, cookie?: string) {
  const url = new URL(`http://localhost/api/quick-shortcuts/${id}`);
  const request = new Request(url.toString(), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {})
    },
    body
  });
  return { request, params: { id }, url } as unknown as Parameters<typeof PATCH>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof PATCH>[0]) => unknown,
  event: Parameters<typeof PATCH>[0]
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

const callPatch = (id: string, body?: string, cookie?: string) =>
  runHandler(PATCH, eventFor('PATCH', id, body, cookie));
const callDelete = (id: string, cookie?: string) => runHandler(DELETE, eventFor('DELETE', id, undefined, cookie));

describe('/api/quick-shortcuts/:id', () => {
  beforeEach(() => {
    resetQuickShortcutsStoreForTests();
    resetBrowserSessionFixtures();
  });

  describe('PATCH', () => {
    it('updates label only and returns 200 with the updated row', async () => {
      const existing = createQuickShortcut({ label: 'old', text: 'cmd' });
      const response = await callPatch(existing.id, JSON.stringify({ label: 'new' }));
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { shortcut: { label: string; text: string } };
      expect(payload.shortcut.label).toBe('new');
      expect(payload.shortcut.text).toBe('cmd');
    });

    it('updates text and autoEnter together', async () => {
      const existing = createQuickShortcut({ label: 'l', text: 't' });
      const response = await callPatch(
        existing.id,
        JSON.stringify({ text: 'new-text', autoEnter: false })
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        shortcut: { text: string; autoEnter: boolean };
      };
      expect(payload.shortcut.text).toBe('new-text');
      expect(payload.shortcut.autoEnter).toBe(false);
    });

    it('returns 404 for an unknown id', async () => {
      const response = await callPatch(
        'does-not-exist',
        JSON.stringify({ label: 'x' })
      );
      expect(response.status).toBe(404);
    });

    it('does not update another browser-session owner shortcut', async () => {
      const existing = createQuickShortcut({ ownerHandle: '@alice', label: 'old', text: 'cmd' });
      const response = await callPatch(
        existing.id,
        JSON.stringify({ label: 'new' }),
        browserSessionCookieFor('@bob')
      );
      expect(response.status).toBe(404);
      expect(findQuickShortcutById(existing.id, '@alice')?.label).toBe('old');
    });

    it('returns 400 when label is not a string', async () => {
      const existing = createQuickShortcut({ label: 'l', text: 't' });
      const response = await callPatch(
        existing.id,
        JSON.stringify({ label: 123 })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when text trims to empty', async () => {
      const existing = createQuickShortcut({ label: 'l', text: 't' });
      const response = await callPatch(
        existing.id,
        JSON.stringify({ text: '   ' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when autoEnter is not boolean', async () => {
      const existing = createQuickShortcut({ label: 'l', text: 't' });
      const response = await callPatch(
        existing.id,
        JSON.stringify({ autoEnter: 'yes' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 for a non-JSON body', async () => {
      const existing = createQuickShortcut({ label: 'l', text: 't' });
      const url = new URL(`http://localhost/api/quick-shortcuts/${existing.id}`);
      const request = new Request(url.toString(), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: 'not json'
      });
      const event = {
        request,
        params: { id: existing.id },
        url
      } as unknown as Parameters<typeof PATCH>[0];
      const response = await runHandler(PATCH, event);
      expect(response.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('removes the shortcut and returns 204', async () => {
      const existing = createQuickShortcut({ label: 'l', text: 't' });
      const response = await callDelete(existing.id);
      expect(response.status).toBe(204);
      expect(findQuickShortcutById(existing.id)).toBeUndefined();
    });

    it('returns 404 for an unknown id', async () => {
      const response = await callDelete('does-not-exist');
      expect(response.status).toBe(404);
    });

    it('does not delete another browser-session owner shortcut', async () => {
      const existing = createQuickShortcut({ ownerHandle: '@alice', label: 'l', text: 't' });
      const response = await callDelete(existing.id, browserSessionCookieFor('@bob'));
      expect(response.status).toBe(404);
      expect(findQuickShortcutById(existing.id, '@alice')).toBeDefined();
    });
  });
});
