/**
 * Shared name-or-id resolvers for the JWPK 2026-05-16 verb spec.
 *
 *   resolveTerminalIdentifier(runtime, identifier) → TerminalRecord
 *   resolveChatRoomIdentifier(runtime, identifier) → ChatRoom
 *
 * "identifier" may be an id (sessionId / roomId), a name, or a handle.
 * GETs the relevant list endpoint once and matches client-side. Throws
 * a CliInputError-compatible error if no match. Saves us building
 * dedicated server-side by-name lookups for every entity type.
 *
 * Used by ant-cli-terminal.mjs and ant-cli-chat.mjs (name-aware shape).
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

export async function resolveTerminalIdentifier(runtime, identifier, ErrorCtor) {
  if (!identifier || typeof identifier !== 'string') {
    throw new ErrorCtor('terminal identifier (id, name, or handle) is required');
  }
  const trimmed = identifier.trim();
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/terminals`);
  if (!response.ok) {
    throw new Error(`could not list terminals: ${response.status}`);
  }
  const { terminals } = await response.json();
  if (!Array.isArray(terminals)) {
    throw new Error('terminals response was malformed');
  }
  const match = terminals.find((t) =>
    t.sessionId === trimmed ||
    t.name === trimmed ||
    t.handle === trimmed ||
    t.derivedHandle === trimmed ||
    t.derivedHandle === `@${trimmed.replace(/^@/, '')}`
  );
  if (!match) {
    throw new ErrorCtor(`no terminal matching "${identifier}" (tried sessionId/name/handle/derivedHandle)`);
  }
  return match;
}

export async function resolveChatRoomIdentifier(runtime, identifier, ErrorCtor) {
  if (!identifier || typeof identifier !== 'string') {
    throw new ErrorCtor('chat room identifier (id or name) is required');
  }
  const trimmed = identifier.trim();
  const response = await runtime.fetchImpl(chatRoomsListUrl(runtime));
  if (!response.ok) {
    throw new Error(`could not list chat-rooms: ${response.status}`);
  }
  const { chatRooms } = await response.json();
  if (!Array.isArray(chatRooms)) {
    throw new Error('chat-rooms response was malformed');
  }
  // Exact id wins first; then exact name; then case-insensitive name.
  const lower = trimmed.toLowerCase();
  const match =
    chatRooms.find((r) => r.id === trimmed) ??
    chatRooms.find((r) => r.name === trimmed) ??
    chatRooms.find((r) => typeof r.name === 'string' && r.name.toLowerCase() === lower);
  if (!match) {
    throw new ErrorCtor(`no chat room matching "${identifier}"`);
  }
  return match;
}

function chatRoomsListUrl(runtime) {
  const url = new URL('/api/chat-rooms', runtime.serverUrl);
  url.searchParams.set('pidChain', JSON.stringify(processIdentityChain()));
  return url.toString();
}

/** Helper for runtimes that may not have writeOut/writeErr (defensive). */
export function makeStandardSendJson(runtime) {
  return async function sendJson(path, method, body, extraHeaders = {}) {
    const init = { method, headers: { 'content-type': 'application/json', ...extraHeaders } };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`, init);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
    }
    if (response.status === 204) return {};
    return response.json();
  };
}

// 0.1.8 slice H (Xeno goal-2 footnote 2026-05-20): ant chat send was
// requiring an explicit ANT_SERVER_URL env override even when
// ~/.ant/config.json already had a per-room server_url stamped in by
// `ant invite redeem`. Precedence: env (user-explicit override) wins
// first, then the per-room token's server_url for the addressed room,
// then top-level config.serverUrl, then the default. Callers that know
// the roomId (chat send, chat tail, message read, etc.) should route
// through this resolver instead of reading runtime.serverUrl directly.
//
// Lives here (not ant-cli.mjs) to avoid the ant-cli.mjs → ant-cli-chat.mjs
// → ant-cli.mjs circular import that ES-module-bound late-resolved would
// have left as a runtime hazard.
export function resolveRoomServerUrl(runtime, roomId) {
  if (runtime.serverUrlSource === 'env') return runtime.serverUrl;
  const tokens = runtime.config?.tokens;
  if (tokens && typeof tokens === 'object' && typeof roomId === 'string' && roomId.length > 0) {
    const entry = tokens[roomId];
    if (entry && typeof entry === 'object') {
      const candidate = entry.server_url;
      if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
  }
  const configRoot = runtime.config;
  if (configRoot && typeof configRoot === 'object' && typeof configRoot.serverUrl === 'string' && configRoot.serverUrl.length > 0) {
    return configRoot.serverUrl;
  }
  return runtime.serverUrl;
}
