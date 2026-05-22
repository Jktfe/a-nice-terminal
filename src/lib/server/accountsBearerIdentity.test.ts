import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetAccountsBearerIdentityCacheForTests,
  resolveAccountsBearerIdentity
} from './accountsBearerIdentity';

beforeEach(() => {
  resetAccountsBearerIdentityCacheForTests();
  delete process.env.ANT_ACCOUNTS_BEARER_TIMEOUT_MS;
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAccountsBearerIdentityCacheForTests();
  delete process.env.ANT_ACCOUNTS_BEARER_TIMEOUT_MS;
});

describe('resolveAccountsBearerIdentity', () => {
  it('extracts orgId and handles from accounts /api/auth/me', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      user: {
        email: 'redacted@example.com',
        handle: '@jamesK'
      },
      orgId: 'org_newmodel_team',
      expiresAt: 1780000000000
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveAccountsBearerIdentity('team-token')).resolves.toMatchObject({
      email: 'redacted@example.com',
      handle: '@jamesK',
      handles: expect.arrayContaining(['@jamesK']),
      orgId: 'org_newmodel_team',
      expiresAtMs: 1780000000000
    });
  });

  it('returns null quickly when the accounts service does not respond', async () => {
    process.env.ANT_ACCOUNTS_BEARER_TIMEOUT_MS = '25';
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })
    ));

    const started = Date.now();
    const result = await resolveAccountsBearerIdentity('slow-token');
    const elapsed = Date.now() - started;

    expect(result).toBeNull();
    expect(elapsed).toBeLessThan(250);
  });

  it('negative-caches failed account bearer lookups', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveAccountsBearerIdentity('bad-token')).resolves.toBeNull();
    await expect(resolveAccountsBearerIdentity('bad-token')).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
