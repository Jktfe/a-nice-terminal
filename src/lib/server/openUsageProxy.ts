/**
 * openUsageProxy — single point of contact for the open-usage daemon at
 * `http://127.0.0.1:6736/v1/usage`. JWPK msg_300r0u8dlx + msg_4rbn05cztw
 * antV4 2026-05-28.
 *
 * Three responsibilities:
 *   1. Fetch + parse the daemon payload into the typed UsagePayload
 *      shape from $lib/usage/types.
 *   2. Cache the last successful payload in process memory for
 *      DEFAULT_CACHE_TTL_MS so /api/usage burst-reads don't hammer
 *      the daemon (which is itself rate-limited upstream).
 *   3. Soft-fail when the daemon is unreachable: return the cached
 *      payload with `daemonReachable: false` so the UI can fall back
 *      gracefully rather than 500. If we've NEVER reached the daemon,
 *      we return an empty-providers payload (still daemonReachable
 *      false) so the strip simply hides itself.
 *
 * Per [[cli-integration-matrix-directive]] the server staying up must
 * never depend on a third-party daemon being available. Every fetch is
 * wrapped with a short timeout (no AbortController.signal.timeout to
 * keep Node 22 + Bun parity) and any throw is swallowed into the
 * cached-or-empty fallback.
 */
import {
  type UsagePayload,
  type UsageProvider
} from '$lib/usage/types';
import { collectLocalUsageProviders, mergeProviders } from './localUsage/localProviders';

const DAEMON_URL = process.env.ANT_OPEN_USAGE_URL ?? 'http://127.0.0.1:6736/v1/usage';
const DEFAULT_CACHE_TTL_MS = 30_000;
const DEFAULT_FETCH_TIMEOUT_MS = 1_500;

type CacheSlot = {
  payload: UsagePayload;
  cachedAtMs: number;
};

const CACHE_GLOBAL_KEY = '__antOpenUsageCache';

function getCacheSlot(): { value: CacheSlot | null } {
  const slot = globalThis as Record<string, unknown>;
  if (!slot[CACHE_GLOBAL_KEY]) {
    slot[CACHE_GLOBAL_KEY] = { value: null };
  }
  return slot[CACHE_GLOBAL_KEY] as { value: CacheSlot | null };
}

function emptyPayload(): UsagePayload {
  return { providers: [], proxyFetchedAt: null, daemonReachable: false };
}

/** Validate the daemon's bare-array response shape into UsageProvider[].
 *  Returns null when the payload doesn't match the expected shape so
 *  the caller can treat it as a fetch failure rather than crash on a
 *  daemon upgrade that breaks the contract. */
function parseProvidersResponse(raw: unknown): UsageProvider[] | null {
  if (!Array.isArray(raw)) return null;
  const providers: UsageProvider[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return null;
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.providerId !== 'string') return null;
    if (typeof candidate.displayName !== 'string') return null;
    if (!Array.isArray(candidate.lines)) return null;
    if (typeof candidate.fetchedAt !== 'string') return null;
    providers.push({
      providerId: candidate.providerId,
      displayName: candidate.displayName,
      plan: typeof candidate.plan === 'string' ? candidate.plan : null,
      lines: candidate.lines as UsageProvider['lines'],
      fetchedAt: candidate.fetchedAt
    });
  }
  return providers;
}

/** Inner fetch with timeout. Throws on any failure so the outer
 *  fetchUsageOnce can collapse it into a cached-fallback. */
async function fetchDaemonOnce(timeoutMs: number): Promise<UsageProvider[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(DAEMON_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`open-usage daemon returned HTTP ${response.status}`);
    }
    const raw = await response.json();
    const providers = parseProvidersResponse(raw);
    if (providers === null) {
      throw new Error('open-usage daemon payload did not match expected shape');
    }
    return providers;
  } finally {
    clearTimeout(timer);
  }
}

export type FetchUsageOptions = {
  /** Force a network fetch even if a fresh cache entry exists. */
  bypassCache?: boolean;
  /** Override the cache TTL (ms). Defaults to DEFAULT_CACHE_TTL_MS. */
  cacheTtlMs?: number;
  /** Override the per-fetch timeout (ms). Defaults to 1.5 sec. */
  fetchTimeoutMs?: number;
};

/**
 * Public entry point: return the latest UsagePayload, fetching when
 * the cache is stale (or empty / bypassed) and falling back to the
 * cached entry (or empty payload) when the daemon errors.
 */
export async function fetchUsage(options: FetchUsageOptions = {}): Promise<UsagePayload> {
  const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const slot = getCacheSlot();
  const now = Date.now();
  if (!options.bypassCache && slot.value && now - slot.value.cachedAtMs < ttl) {
    return slot.value.payload;
  }
  try {
    const providers = await fetchDaemonOnce(options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
    const payload: UsagePayload = {
      // JWPK 2026-06-10: ANT-local providers (qwen, ollama) ride along
      // with every daemon payload. Daemon wins on id clash so a future
      // upstream plugin supersedes our local probe automatically.
      providers: mergeProviders(providers, await collectLocalUsageProviders(now)),
      proxyFetchedAt: new Date(now).toISOString(),
      daemonReachable: true
    };
    slot.value = { payload, cachedAtMs: now };
    return payload;
  } catch {
    if (slot.value) {
      // Soft-fail: serve the last known good payload with
      // daemonReachable flipped to false so the UI can show a
      // stale-cache indicator. Local providers are already baked into
      // the cached payload, so the strip keeps them too.
      const stale = slot.value.payload;
      return { ...stale, daemonReachable: false };
    }
    // Daemon never reached: local providers still stand on their own —
    // a machine without open-usage installed still gets qwen + ollama
    // stats rather than an empty strip.
    const localProviders = await collectLocalUsageProviders(now);
    if (localProviders.length === 0) return emptyPayload();
    return {
      providers: localProviders,
      proxyFetchedAt: null,
      daemonReachable: false
    };
  }
}

/** Test-only: clear the in-memory cache between tests so each one
 *  starts from a known empty state. */
export function resetOpenUsageCacheForTests(): void {
  const slot = getCacheSlot();
  slot.value = null;
}
