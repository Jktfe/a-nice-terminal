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

export interface RoomScope {
  roomId: string;
}

export function roomScope(event: RequestEvent): RoomScope | null {
  const scope = (event.locals as Record<string, unknown>).roomScope;
  if (!scope || typeof scope !== 'object') return null;
  const roomId = (scope as { roomId?: unknown }).roomId;
  return typeof roomId === 'string' ? { roomId } : null;
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
