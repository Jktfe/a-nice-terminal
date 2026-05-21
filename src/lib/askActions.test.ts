import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { submitAnswerFor, submitDismissFor } from './askActions';

const realFetch = globalThis.fetch;

function mockFetchOnce(body: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  globalThis.fetch = vi.fn(async () => {
    return {
      ok: body.ok,
      status: body.status ?? (body.ok ? 200 : 400),
      statusText: body.ok ? 'OK' : 'Bad Request',
      json: body.json ?? (async () => ({}))
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('askActions', () => {
  it('submitAnswerFor resolves on 200 OK and does not throw', async () => {
    mockFetchOnce({ ok: true });
    await expect(
      submitAnswerFor({ askId: 'ask_1', actorHandle: '@you', answer: 'yes' })
    ).resolves.toBeUndefined();
  });

  it('submitAnswerFor throws Error with parsed { message } from non-OK body', async () => {
    mockFetchOnce({
      ok: false,
      status: 404,
      json: async () => ({ message: 'Ask not found.' })
    });
    await expect(
      submitAnswerFor({ askId: 'ask_unknown', actorHandle: '@you', answer: 'x' })
    ).rejects.toThrow('Ask not found.');
  });

  it('submitDismissFor resolves on 200 OK', async () => {
    mockFetchOnce({ ok: true });
    await expect(
      submitDismissFor({ askId: 'ask_1', actorHandle: '@you' })
    ).resolves.toBeUndefined();
  });

  it('submitDismissFor throws Error with parsed message on non-OK', async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Cannot dismiss an answered ask.' })
    });
    await expect(
      submitDismissFor({ askId: 'ask_resolved', actorHandle: '@you' })
    ).rejects.toThrow('Cannot dismiss an answered ask.');
  });
});
