/**
 * Tests for openUsageProxy — cache + soft-fail behaviour. JWPK
 * msg_300r0u8dlx 2026-05-28.
 *
 * The daemon is stubbed via globalThis.fetch override so these tests
 * don't depend on the real :6736 daemon being up. Each test resets
 * the in-memory cache so behaviour is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchUsage,
  resetOpenUsageCacheForTests
} from './openUsageProxy';

const VALID_PAYLOAD = [
  {
    providerId: 'claude',
    displayName: 'Claude',
    plan: 'Max 20x',
    lines: [
      {
        type: 'progress',
        label: 'Session',
        used: 24,
        limit: 100,
        format: { kind: 'percent' },
        resetsAt: '2026-05-28T12:50:01.135Z',
        periodDurationMs: 18_000_000,
        color: null
      }
    ],
    fetchedAt: '2026-05-28T12:07:46.391857Z'
  }
];

function mockFetch(impl: (input: string, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(impl as typeof fetch);
}

describe('fetchUsage', () => {
  beforeEach(() => {
    resetOpenUsageCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed providers + daemonReachable=true on success', async () => {
    mockFetch(async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
    const payload = await fetchUsage();
    expect(payload.daemonReachable).toBe(true);
    expect(payload.providers).toHaveLength(1);
    expect(payload.providers[0].providerId).toBe('claude');
    expect(payload.proxyFetchedAt).toBeTruthy();
  });

  it('serves from cache on the second call within TTL without re-fetching', async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
    await fetchUsage({ cacheTtlMs: 30_000 });
    await fetchUsage({ cacheTtlMs: 30_000 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-fetches when bypassCache is true', async () => {
    const spy = mockFetch(async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
    await fetchUsage();
    await fetchUsage({ bypassCache: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns empty payload with daemonReachable=false when daemon refused on first call', async () => {
    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const payload = await fetchUsage();
    expect(payload.daemonReachable).toBe(false);
    expect(payload.providers).toEqual([]);
    expect(payload.proxyFetchedAt).toBeNull();
  });

  it('returns stale cache with daemonReachable=false when daemon errors after a success', async () => {
    let attempt = 0;
    mockFetch(async () => {
      attempt += 1;
      if (attempt === 1) return new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 });
      throw new TypeError('fetch failed');
    });
    const first = await fetchUsage();
    expect(first.daemonReachable).toBe(true);
    const second = await fetchUsage({ bypassCache: true });
    expect(second.daemonReachable).toBe(false);
    // Stale providers still surfaced so the UI doesn't blink to empty.
    expect(second.providers).toHaveLength(1);
    expect(second.providers[0].providerId).toBe('claude');
  });

  it('treats malformed daemon payload as a fetch failure (soft-fail to empty)', async () => {
    mockFetch(async () => new Response(JSON.stringify({ not: 'an array' }), { status: 200 }));
    const payload = await fetchUsage();
    expect(payload.daemonReachable).toBe(false);
    expect(payload.providers).toEqual([]);
  });

  it('treats HTTP 500 from daemon as a fetch failure', async () => {
    mockFetch(async () => new Response('internal error', { status: 500 }));
    const payload = await fetchUsage();
    expect(payload.daemonReachable).toBe(false);
    expect(payload.providers).toEqual([]);
  });
});
