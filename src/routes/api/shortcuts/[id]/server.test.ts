/**
 * Endpoint tests for DELETE /api/shortcuts/:id.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { DELETE } from './+server';
import {
  addShortcut,
  findShortcutById,
  resetShortcutsStoreForTests
} from '$lib/server/shortcutsStore';

function eventFor(id: string) {
  const url = new URL(`http://localhost/api/shortcuts/${id}`);
  const request = new Request(url.toString(), { method: 'DELETE' });
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
    resetShortcutsStoreForTests();
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
