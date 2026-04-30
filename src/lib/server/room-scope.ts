// Room-scope enforcement for HTTP routes.
//
// Authentication arrives at routes via two mutually-exclusive paths:
//   1. **Master API key** (or same-origin browser request) — set ANT_API_KEY
//      in env. Hooks waved this through with no `event.locals.roomScope`.
//      Treated as full-trust admin.
//   2. **Per-room bearer token** — issued by ant join-room. Hooks resolved
//      it and set `event.locals.roomScope = { roomId }`. The bearer can
//      only act on its own room.
//
// Helpers:
//   - `roomScope(event)`: read the resolved scope (or null if admin).
//   - `assertSameRoom(event, expectedId)`: 403 if the bearer's room
//     doesn't match the URL the route handles.
//   - `assertNotRoomScoped(event)`: 403 if a per-room bearer is trying to
//     hit an admin-only endpoint (revoke invite, kick participant, etc.).
//
// Routes that don't call any of these stay open to both auth paths — fine
// for read-only endpoints and chat writes that scope-by-URL is sufficient.

import { error, type RequestEvent } from '@sveltejs/kit';

// Token kinds that can write to the room. 'web' is intentionally absent —
// the read-only browser viewer must NOT be able to escalate via curl into
// a posting agent just because it holds a valid token. Keep this list
// narrow; new kinds default to read-only until added here explicitly.
const WRITE_KINDS = new Set(['cli', 'mcp']);

export interface RoomScope {
  roomId: string;
  kind: string | null;
}

export function roomScope(event: RequestEvent): RoomScope | null {
  const scope = (event.locals as Record<string, unknown>).roomScope;
  if (!scope || typeof scope !== 'object') return null;
  const roomId = (scope as { roomId?: unknown }).roomId;
  if (typeof roomId !== 'string') return null;
  const rawKind = (scope as { kind?: unknown }).kind;
  const kind = typeof rawKind === 'string' ? rawKind : null;
  return { roomId, kind };
}

export function assertSameRoom(event: RequestEvent, expectedRoomId: string): void {
  const scope = roomScope(event);
  if (!scope) return; // master API key — fine
  if (scope.roomId !== expectedRoomId) {
    throw error(403, 'Room token does not authorise this room');
  }
}

export function assertNotRoomScoped(event: RequestEvent): void {
  if (roomScope(event)) {
    throw error(403, 'This action requires master API key, not a per-room token');
  }
}

// Reject when the caller's room scope is read-only (kind === 'web' today).
// Master API key and write-capable kinds (cli, mcp) pass through.
export function assertCanWrite(event: RequestEvent): void {
  const scope = roomScope(event);
  if (!scope) return; // master API key — fine
  if (scope.kind === null) return; // unknown kind — be permissive (legacy tokens)
  if (!WRITE_KINDS.has(scope.kind)) {
    throw error(403, `Tokens of kind '${scope.kind}' are read-only`);
  }
}
