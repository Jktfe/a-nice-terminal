/**
 * Endpoint tests for DELETE /api/shortcuts/:id.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE } from './+server';
import {
  addShortcut,
  findShortcutById,
  resetShortcutsStoreForTests
} from '$lib/server/shortcutsStore';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'shortcut-delete-route-test-admin';

function eventFor(id: string, authenticated = true) {
  const url = new URL(`http://localhost/api/shortcuts/${id}`);
  const headers = authenticated ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  const request = new Request(url.toString(), { method: 'DELETE', headers });
  return { request, params: { id }, url } as unknown as Parameters<typeof DELETE>[0];
}

async function runHandler(
  handler: (event: Parameters<typeof DELETE>[0]) => unknown,
  event: Parameters<typeof DELETE>[0]
): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), {
        status: httpFailure.status
      });
    }
    throw thrownByHandler;
  }
}

describe('/api/shortcuts/:id DELETE', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
    resetShortcutsStoreForTests();
  });

  afterEach(() => {
    if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
  });

  it('rejects anonymous deletes before mutation', async () => {
    const existing = addShortcut({ scope: 'terminal', scopeTarget: 't1', label: 'x', command: 'x' });
    const response = await runHandler(DELETE, eventFor(existing.id, false));
    expect(response.status).toBe(401);
    expect(findShortcutById(existing.id)).toBeDefined();
  });

  it('removes a terminal-scoped shortcut and returns 204', async () => {
    const existing = addShortcut({ scope: 'terminal', scopeTarget: 't1', label: 'x', command: 'x' });
    const response = await runHandler(DELETE, eventFor(existing.id));
    expect(response.status).toBe(204);
    expect(findShortcutById(existing.id)).toBeUndefined();
  });

  it('removes a global shortcut and returns 204', async () => {
    const existing = addShortcut({ scope: 'global', label: 'g', command: 'g' });
    const response = await runHandler(DELETE, eventFor(existing.id));
    expect(response.status).toBe(204);
    expect(findShortcutById(existing.id)).toBeUndefined();
  });

  it('returns 404 for an unknown id', async () => {
    const response = await runHandler(DELETE, eventFor('does-not-exist'));
    expect(response.status).toBe(404);
  });

  it('returns 404 on the second delete of the same shortcut', async () => {
    const existing = addShortcut({ scope: 'chatroom', scopeTarget: 'room_x', label: 'a', command: 'a' });
    const first = await runHandler(DELETE, eventFor(existing.id));
    expect(first.status).toBe(204);
    const second = await runHandler(DELETE, eventFor(existing.id));
    expect(second.status).toBe(404);
  });
});
