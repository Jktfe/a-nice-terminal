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
  const response = await runtime.fetchImpl(`${runtime.serverUrl}/api/chat-rooms`);
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

/** Helper for runtimes that may not have writeOut/writeErr (defensive). */
export function makeStandardSendJson(runtime) {
  return async function sendJson(path, method, body) {
    const init = { method, headers: { 'content-type': 'application/json' } };
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
