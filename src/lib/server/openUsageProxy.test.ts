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
import type { UsageProvider } from '$lib/usage/types';

// Local providers (qwen/ollama probes, JWPK 2026-06-10) are stubbed so
// these tests stay deterministic: no fs reads of ~/.qwen, no HTTP to
// :11434. Tests opt in by pushing into testLocalProviders.
const localProviderTestState = vi.hoisted(() => ({
  providers: [] as unknown[]
}));

vi.mock('./localUsage/localProviders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./localUsage/localProviders')>();
  return {
    ...actual,
    collectLocalUsageProviders: vi.fn(
      async () => localProviderTestState.providers as UsageProvider[]
    )
  };
});

function fakeLocalProvider(providerId: string): UsageProvider {
  return {
    providerId,
    displayName: providerId,
    plan: 'Local',
    lines: [
      { type: 'text', label: 'Today', value: '1.2K tokens · 3 calls', color: null, subtitle: null }
    ],
    fetchedAt: '2026-06-10T09:00:00.000Z'
  };
}

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
    localProviderTestState.providers = [];
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

  // --- ANT-local providers (qwen + ollama, JWPK 2026-06-10) ---

  it('appends local providers after the daemon providers', async () => {
    localProviderTestState.providers = [fakeLocalProvider('qwen'), fakeLocalProvider('ollama')];
    mockFetch(async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
    const payload = await fetchUsage();
    expect(payload.daemonReachable).toBe(true);
    expect(payload.providers.map((p) => p.providerId)).toEqual(['claude', 'qwen', 'ollama']);
  });

  it('prefers the daemon provider when ids clash', async () => {
    localProviderTestState.providers = [fakeLocalProvider('claude'), fakeLocalProvider('qwen')];
    mockFetch(async () => new Response(JSON.stringify(VALID_PAYLOAD), { status: 200 }));
    const payload = await fetchUsage();
    const claudeProviders = payload.providers.filter((p) => p.providerId === 'claude');
    expect(claudeProviders).toHaveLength(1);
    // Daemon copy survives — it carries the plan from upstream.
    expect(claudeProviders[0].plan).toBe('Max 20x');
    expect(payload.providers.map((p) => p.providerId)).toEqual(['claude', 'qwen']);
  });

  it('serves local providers alone when the daemon was never reachable', async () => {
    localProviderTestState.providers = [fakeLocalProvider('ollama')];
    mockFetch(async () => {
      throw new TypeError('fetch failed');
    });
    const payload = await fetchUsage();
    expect(payload.daemonReachable).toBe(false);
    expect(payload.proxyFetchedAt).toBeNull();
    expect(payload.providers.map((p) => p.providerId)).toEqual(['ollama']);
  });
});
