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
        email: 'james@newmodel.vc',
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
      email: 'james@newmodel.vc',
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

  it('dedupes concurrent calls for the same token to a single fetch', async () => {
    // Resolver fires N parallel calls with the same bearer; without dedup,
    // each would trigger its own fetch (the negative cache only catches
    // SERIAL repeats, not parallel ones). The in-flight dedup map ensures
    // only one fetch lands at accounts.antonline.dev per token in flight.
    let resolveFetch: ((value: Response) => void) | null = null;
    const fetchMock = vi.fn(() =>
      new Promise<Response>((resolveResponse) => {
        resolveFetch = resolveResponse;
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const calls = [
      resolveAccountsBearerIdentity('parallel-token'),
      resolveAccountsBearerIdentity('parallel-token'),
      resolveAccountsBearerIdentity('parallel-token'),
      resolveAccountsBearerIdentity('parallel-token')
    ];

    // Give the microtask queue a chance to flush so each call has registered
    // with the in-flight map BEFORE we resolve the fetch.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch!(new Response(JSON.stringify({
      user: { email: 'pal@example.com', handle: '@pal' }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const results = await Promise.all(calls);
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result).toMatchObject({ email: 'pal@example.com', handle: '@pal' });
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight map after resolution so a new fetch fires on next call', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      user: { email: 'serial@example.com', handle: '@serial' }
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await resolveAccountsBearerIdentity('serial-token');
    // Same call after resolution should NOT be deduped against the prior
    // (resolved) promise — that would be a memory leak. The positive cache
    // is the external token store; in-flight dedup is only for concurrent
    // mid-flight requests.
    await resolveAccountsBearerIdentity('serial-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
