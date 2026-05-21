/**
 * Shared CLI read-auth helpers for room-scoped GETs.
 *
 * Server read routes now fail closed. Agents normally have a handle in
 * ~/.ant/config.json or ANT_HANDLE, so a CLI can mint the same
 * browser-session cookie the write path already uses, then retry the GET.
 */
import { processIdentityChain } from './ant-cli-identity-chain.mjs';

export function resolveAntCliHandleForRoom(runtime, roomId, explicitHandle) {
  if (typeof explicitHandle === 'string' && explicitHandle.trim().length > 0) {
    const trimmed = explicitHandle.trim();
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  }
  try {
    const config = runtime.config ?? {};
    const roomToken = config.tokens?.[roomId];
    if (roomToken && typeof roomToken.handle === 'string') return roomToken.handle;
    if (typeof config.handle === 'string') return config.handle;
  } catch {
    /* config absent */
  }
  const envHandle = process.env.ANT_HANDLE;
  if (typeof envHandle === 'string' && envHandle.trim().length > 0) {
    const trimmed = envHandle.trim();
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  }
  return null;
}

export async function mintAntCliBrowserSessionCookie(runtime, roomId, explicitHandle) {
  const handle = resolveAntCliHandleForRoom(runtime, roomId, explicitHandle);
  if (!handle) return null;
  const url = `${runtime.serverUrl}/api/chat-rooms/${encodeURIComponent(roomId)}/browser-session`;
  const response = await runtime.fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: runtime.serverUrl
    },
    body: JSON.stringify({ authorHandle: handle, pidChain: processIdentityChain() })
  });
  if (!response.ok) return null;
  return extractAntBrowserSessionCookie(response);
}

export async function fetchRoomJsonWithBrowserSessionFallback(
  runtime,
  roomId,
  path,
  explicitHandle
) {
  const url = appendPidChainQuery(`${runtime.serverUrl}${path}`);
  const first = await runtime.fetchImpl(url);
  if (first.ok) return first.json();
  if (first.status !== 401) throw await makeGetFailure(url, first);

  const cookie = await mintAntCliBrowserSessionCookie(runtime, roomId, explicitHandle);
  if (!cookie) throw await makeGetFailure(url, first);

  const retry = await runtime.fetchImpl(url, {
    headers: {
      cookie,
      origin: runtime.serverUrl
    }
  });
  if (!retry.ok) throw await makeGetFailure(url, retry);
  return retry.json();
}

function appendPidChainQuery(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.searchParams.has('pidChain')) {
    url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  }
  return url.toString();
}

function extractAntBrowserSessionCookie(response) {
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean);
  for (const raw of cookies) {
    const match = /^(ant_browser_session=[^;]+)/.exec(raw);
    if (match) return match[1];
  }
  return null;
}

async function makeGetFailure(url, response) {
  const bodyText = await response.text().catch(() => '');
  return new Error(`GET ${url} returned ${response.status}: ${bodyText.slice(0, 200)}`);
}
