/**
 * Endpoint tests for GET/POST /api/shortcuts.
 * Style mirrors /api/quick-shortcuts/server.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import {
  addShortcut,
  resetShortcutsStoreForTests
} from '$lib/server/shortcutsStore';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'shortcuts-route-test-admin';

function eventFor(method: 'GET' | 'POST', url: URL, body?: string, authenticated = true) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authenticated) headers.authorization = `Bearer ${TEST_ADMIN_TOKEN}`;
  const request = new Request(url.toString(), {
    method,
    headers,
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

const callGet = (query: string, authenticated = true) => {
  const url = new URL(`http://localhost/api/shortcuts?${query}`);
  return runHandler(GET, eventFor('GET', url, undefined, authenticated));
};
const callPost = (body?: string, authenticated = true) => {
  const url = new URL('http://localhost/api/shortcuts');
  return runHandler(POST, eventFor('POST', url, body, authenticated));
};

describe('/api/shortcuts', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetShortcutsStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  describe('GET', () => {
    it('rejects anonymous reads', async () => {
      const response = await callGet('scope=global', false);
      expect(response.status).toBe(401);
    });

    it('returns scoped shortcuts ordered by orderIndex ASC', async () => {
      const a = addShortcut({ scope: 'terminal', scopeTarget: 't_abc', label: 'a', command: 'a' });
      const b = addShortcut({ scope: 'terminal', scopeTarget: 't_abc', label: 'b', command: 'b' });
      addShortcut({ scope: 'terminal', scopeTarget: 't_other', label: 'noise', command: 'noise' });

      const response = await callGet('scope=terminal&target=t_abc');
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { shortcuts: { id: string }[] };
      expect(payload.shortcuts.map((row) => row.id)).toEqual([a.id, b.id]);
    });

    it('returns global shortcuts when scope=global, ignoring target', async () => {
      const g = addShortcut({ scope: 'global', label: 'help', command: '/help' });
      const response = await callGet('scope=global');
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { shortcuts: { id: string }[] };
      expect(payload.shortcuts.map((row) => row.id)).toEqual([g.id]);
    });

    it('rejects an unknown scope with 400', async () => {
      const response = await callGet('scope=other&target=x');
      expect(response.status).toBe(400);
    });

    it('rejects scope=terminal without target with 400', async () => {
      const response = await callGet('scope=terminal');
      expect(response.status).toBe(400);
    });
  });

  describe('POST', () => {
    it('rejects anonymous writes before creating a shortcut', async () => {
      const response = await callPost(
        JSON.stringify({ scope: 'global', label: 'help', command: '/help' }),
        false
      );
      expect(response.status).toBe(401);
    });

    it('creates a chatroom-scoped shortcut and returns 201 with the new row', async () => {
      const response = await callPost(
        JSON.stringify({
          scope: 'chatroom',
          scope_target: 'room_x',
          label: 'sync',
          command: 'sync now'
        })
      );
      expect(response.status).toBe(201);
      const payload = (await response.json()) as {
        shortcut: {
          id: string;
          scope: string;
          scopeTarget: string | null;
          label: string;
          command: string;
        };
      };
      expect(payload.shortcut.scope).toBe('chatroom');
      expect(payload.shortcut.scopeTarget).toBe('room_x');
      expect(payload.shortcut.label).toBe('sync');
      expect(payload.shortcut.command).toBe('sync now');
      expect(payload.shortcut.id.length).toBeGreaterThan(0);
    });

    it('creates a global shortcut (no scope_target) and returns 201', async () => {
      const response = await callPost(
        JSON.stringify({ scope: 'global', label: 'help', command: '/help' })
      );
      expect(response.status).toBe(201);
      const payload = (await response.json()) as {
        shortcut: { scope: string; scopeTarget: string | null };
      };
      expect(payload.shortcut.scope).toBe('global');
      expect(payload.shortcut.scopeTarget).toBeNull();
    });

    it('returns 400 when label is missing on POST', async () => {
      const response = await callPost(
        JSON.stringify({ scope: 'terminal', scope_target: 't_abc', command: 'x' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when scope_target is missing for a scoped POST', async () => {
      const response = await callPost(
        JSON.stringify({ scope: 'terminal', label: 'x', command: 'x' })
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 for a non-JSON body', async () => {
      const url = new URL('http://localhost/api/shortcuts');
      const request = new Request(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
        body: 'not json'
      });
      const event = { request, params: {}, url } as unknown as Parameters<typeof POST>[0];
      const response = await runHandler(POST, event);
      expect(response.status).toBe(400);
    });
  });
});
