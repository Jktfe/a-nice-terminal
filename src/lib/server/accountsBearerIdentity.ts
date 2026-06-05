import { accountsBaseUrl } from './accountsProxy';
import {
  cacheExternalToken,
  userShapeForEmail
} from './antchatAuthStore';

type AccountsMeResponse = {
  user?: {
    email?: unknown;
    handle?: unknown;
    handles?: unknown;
  };
  email?: unknown;
  handle?: unknown;
  handles?: unknown;
  orgId?: unknown;
  expiresAt?: unknown;
};

export type AccountsBearerIdentity = {
  email: string;
  handle: string;
  handles: string[];
  orgId?: string;
  expiresAtMs?: number;
};

const DEFAULT_ACCOUNTS_BEARER_TIMEOUT_MS = 3_000;
const NEGATIVE_TOKEN_CACHE_MS = 30_000;
const negativeTokenCache = new Map<string, number>();

/**
 * In-flight dedup map. When a request arrives with token X and a fetch to
 * accounts.antonline.dev is already in flight for the same X, we await
 * the same Promise instead of firing a duplicate fetch.
 *
 * Why: a browser tab loading the dashboard fires several /api/* requests
 * in parallel with the same bearer cookie. Without dedup, each gate call
 * fires its own fetch → N× the latency budget for the SAME identity
 * resolution. The negative cache only kicks in AFTER the first miss
 * completes, so the in-flight burst doesn't get the benefit. Dedup closes
 * that gap.
 *
 * Static-analysis derived (no trace data yet). Banked in
 * project_auth_gate_latency_investigation_2026_05_24.md — this is a safe
 * optimisation even if it's not the root cause: an in-flight Promise can
 * only resolve once per token, and downstream consumers are read-only.
 */
const inFlightResolutions = new Map<string, Promise<AccountsBearerIdentity | null>>();

function accountsBearerTimeoutMs(): number {
  const parsed = Number(process.env.ANT_ACCOUNTS_BEARER_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_ACCOUNTS_BEARER_TIMEOUT_MS;
}

function normalizeHandle(rawHandle: string): string {
  const trimmed = rawHandle.trim();
  if (trimmed.length === 0) return trimmed;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function addHandle(out: string[], rawHandle: unknown): void {
  if (typeof rawHandle !== 'string') return;
  const handle = normalizeHandle(rawHandle);
  if (handle.length === 0) return;
  if (!out.includes(handle)) out.push(handle);
}

function extractEmail(payload: AccountsMeResponse): string | null {
  if (typeof payload.user?.email === 'string') return payload.user.email;
  if (typeof payload.email === 'string') return payload.email;
  return null;
}

function extractExpiresAtMs(payload: AccountsMeResponse): number | undefined {
  if (typeof payload.expiresAt === 'number' && Number.isFinite(payload.expiresAt)) {
    return payload.expiresAt;
  }
  return undefined;
}

function extractOrgId(payload: AccountsMeResponse): string | undefined {
  return typeof payload.orgId === 'string' && payload.orgId.trim().length > 0
    ? payload.orgId.trim()
    : undefined;
}

function handlesFromPayload(payload: AccountsMeResponse, fallbackHandle: string): string[] {
  const handles: string[] = [];
  addHandle(handles, payload.user?.handle);
  addHandle(handles, payload.handle);
  addHandle(handles, fallbackHandle);

  const payloadHandles = Array.isArray(payload.user?.handles)
    ? payload.user.handles
    : Array.isArray(payload.handles)
      ? payload.handles
      : [];
  for (const handle of payloadHandles) addHandle(handles, handle);
  return handles;
}

export async function resolveAccountsBearerIdentity(
  token: string
): Promise<AccountsBearerIdentity | null> {
  // Negative cache is checked first so we don't even hit the in-flight map
  // for known-miss tokens. Cheap path returns immediately.
  const cachedMissUntil = negativeTokenCache.get(token);
  if (cachedMissUntil !== undefined) {
    if (cachedMissUntil > Date.now()) return null;
    negativeTokenCache.delete(token);
  }

  // In-flight dedup: if a fetch for this token is already running, await it
  // instead of firing a parallel one. The Promise resolves once and shares
  // the result with all callers. Cleared from the map in the finally block.
  const existing = inFlightResolutions.get(token);
  if (existing) return existing;

  const resolution = performAccountsBearerLookup(token);
  inFlightResolutions.set(token, resolution);
  try {
    return await resolution;
  } finally {
    inFlightResolutions.delete(token);
  }
}

async function performAccountsBearerLookup(
  token: string
): Promise<AccountsBearerIdentity | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), accountsBearerTimeoutMs());
  let response: Response;
  try {
    response = await fetch(`${accountsBaseUrl()}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal
    });
  } catch {
    negativeTokenCache.set(token, Date.now() + NEGATIVE_TOKEN_CACHE_MS);
    return null;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    negativeTokenCache.set(token, Date.now() + NEGATIVE_TOKEN_CACHE_MS);
    return null;
  }

  const payload = (await response.json().catch(() => null)) as AccountsMeResponse | null;
  if (!payload || typeof payload !== 'object') return null;

  const email = extractEmail(payload);
  if (!email) return null;

  const fallbackHandle = userShapeForEmail(email).handle;
  const handles = handlesFromPayload(payload, fallbackHandle);
  const handle = handles[0] ?? fallbackHandle;
  const orgId = extractOrgId(payload);
  const expiresAtMs = extractExpiresAtMs(payload);

  cacheExternalToken({
    token,
    email,
    expiresAtMs
  });

  return {
    email,
    handle,
    handles,
    ...(orgId !== undefined && { orgId }),
    ...(expiresAtMs !== undefined && { expiresAtMs })
  };
}

export function resetAccountsBearerIdentityCacheForTests(): void {
  negativeTokenCache.clear();
  inFlightResolutions.clear();
}
