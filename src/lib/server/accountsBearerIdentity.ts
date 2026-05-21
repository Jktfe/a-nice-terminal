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
  expiresAt?: unknown;
};

export type AccountsBearerIdentity = {
  email: string;
  handle: string;
  handles: string[];
  expiresAtMs?: number;
};

const DEFAULT_ACCOUNTS_BEARER_TIMEOUT_MS = 750;
const NEGATIVE_TOKEN_CACHE_MS = 30_000;
const negativeTokenCache = new Map<string, number>();

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

function handlesFromPayload(payload: AccountsMeResponse, fallbackHandle: string): string[] {
  const handles: string[] = [];
  addHandle(handles, fallbackHandle);
  addHandle(handles, payload.user?.handle);
  addHandle(handles, payload.handle);

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
  const cachedMissUntil = negativeTokenCache.get(token);
  if (cachedMissUntil !== undefined) {
    if (cachedMissUntil > Date.now()) return null;
    negativeTokenCache.delete(token);
  }

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
    ...(expiresAtMs !== undefined && { expiresAtMs })
  };
}

export function resetAccountsBearerIdentityCacheForTests(): void {
  negativeTokenCache.clear();
}
