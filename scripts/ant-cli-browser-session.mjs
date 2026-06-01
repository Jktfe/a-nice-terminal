/**
 * Shared CLI read-auth helpers for room-scoped GETs.
 *
 * Server read routes now fail closed. Agents normally have a handle in
 * ~/.ant/config.json or ANT_HANDLE, so a CLI can mint the same
 * browser-session cookie the write path already uses, then retry the GET.
 */
import { processIdentityChain } from './ant-cli-identity-chain.mjs';
import { resolveRoomServerUrl } from './ant-cli-shared-resolve.mjs';

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
  // Slice H follow-up (2026-05-22): mint against the per-room server,
  // not the runtime default. Necessary so chat-tail's 401-then-mint
  // fallback hits the same server that serves the room's writes.
  const base = resolveRoomServerUrl(runtime, roomId);
  const url = `${base}/api/chat-rooms/${encodeURIComponent(roomId)}/browser-session`;
  const response = await runtime.fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: base
    },
    body: JSON.stringify({ authorHandle: handle, pidChain: processIdentityChain() })
  });
  if (!response.ok) return null;
  return extractAntBrowserSessionCookie(response);
}

// 0.1.9 (Xeno router 502 root-cause fix 2026-05-23): when a per-room
// invite token is in ~/.ant/config.json, send Authorization: Bearer
// instead of pidChain-in-URL. The 9-deep pidChain query string was
// ~1500 bytes URL-encoded and crossed an upstream proxy limit somewhere
// in the TLS-termination chain (Tailscale most likely), returning 502
// before requests reached the SvelteKit server. Slice C already lit up
// `tryRoomInviteBearer` server-side in resolveChatRoomReadAccess —
// /messages GET reads accept the bearer with zero server change.
//
// Falls back to the existing pidChain-in-URL + cookie-mint path when
// no token is in config (CLI sessions that never redeemed an invite).
// Dual-shape lookup (xenoCC bug report 2026-05-26):
//
//   Flat shape (post-0.1.7 invite exchange writes):
//     tokens[roomId] = { token: '<secret>', server_url?: '...', ... }
//
//   Legacy nested shape (pre-0.1.7 invite exchange writes):
//     tokens[roomId] = { default_handle: '@x',
//                        byHandle: { '@x': { token: '<secret>', ... } } }
//
// If we only check the flat shape, an older config with the nested
// shape returns null here, the bearer path is skipped, and the router
// falls back to pidChain-in-URL — which hits the gateway URL-length
// 502 we fixed for the bearer path in ant 0.1.9. Reproducer: drop the
// flat `token` field from a tokens[roomId] entry that still has
// byHandle and watch the router 502-storm.
function lookupRoomToken(runtime, roomId) {
  if (typeof roomId !== 'string' || roomId.length === 0) return null;
  const tokens = runtime.config?.tokens;
  if (!tokens || typeof tokens !== 'object') return null;
  const entry = tokens[roomId];
  if (!entry || typeof entry !== 'object') return null;
  // Flat shape first — current writers use this.
  if (typeof entry.token === 'string' && entry.token.length > 0) return entry.token;
  // Legacy nested shape — prefer default_handle when set, else any
  // handle (single-handle is the common case for older configs).
  const byHandle = entry.byHandle;
  if (byHandle && typeof byHandle === 'object') {
    const defaultHandle = typeof entry.default_handle === 'string' ? entry.default_handle : null;
    const candidate = (defaultHandle && byHandle[defaultHandle]) ?? Object.values(byHandle)[0];
    if (candidate && typeof candidate === 'object'
        && typeof candidate.token === 'string'
        && candidate.token.length > 0) {
      return candidate.token;
    }
  }
  return null;
}

export async function fetchRoomJsonWithBrowserSessionFallback(
  runtime,
  roomId,
  path,
  explicitHandle
) {
  const base = resolveRoomServerUrl(runtime, roomId);
  const bearerToken = lookupRoomToken(runtime, roomId);
  // Bearer path: URL stays bare — no pidChain query param. The bearer
  // proves room-scoped read access via slice C's tryRoomInviteBearer
  // resolver. This is the primary path for any agent that redeemed an
  // invite (i.e. anyone whose CLI has ever connected to this room).
  if (bearerToken) {
    const url = `${base}${path}`;
    const response = await runtime.fetchImpl(url, {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        origin: base
      }
    });
    if (response.ok) return response.json();
    // If the bearer is rejected (revoked, expired, or wrong room), fall
    // through to the legacy pidChain + cookie-mint path rather than
    // surface a hard 401 — this preserves the existing user-recovery
    // story for stale-token edge cases.
    if (response.status !== 401) throw await makeGetFailure(url, response);
  }

  // Legacy / no-token path: pidChain in URL + cookie-mint fallback.
  const url = appendPidChainQuery(`${base}${path}`);
  const first = await runtime.fetchImpl(url);
  if (first.ok) return first.json();
  if (first.status !== 401) throw await makeGetFailure(url, first);

  const cookie = await mintAntCliBrowserSessionCookie(runtime, roomId, explicitHandle);
  if (!cookie) throw await makeGetFailure(url, first);

  const retry = await runtime.fetchImpl(url, {
    headers: {
      cookie,
      origin: base
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
