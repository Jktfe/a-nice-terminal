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

function eventFor(method: 'PATCH' | 'DELETE', id: string, body?: string) {
  const url = new URL(`http://localhost/api/quick-shortcuts/${id}`);
  const request = new Request(url.toString(), {
    method,
    headers: { 'content-type': 'application/json' },
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

const callPatch = (id: string, body?: string) =>
  runHandler(PATCH, eventFor('PATCH', id, body));
const callDelete = (id: string) => runHandler(DELETE, eventFor('DELETE', id));

describe('/api/quick-shortcuts/:id', () => {
  beforeEach(() => {
    resetQuickShortcutsStoreForTests();
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
  });
});
