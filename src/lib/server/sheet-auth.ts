import { error, type RequestEvent } from '@sveltejs/kit';
import { roomScope, assertCanWrite, type RoomScope } from './room-scope.js';
import type { SheetMeta } from './sheets.js';

// Structural copy of deck-auth.ts. Sheets reuse the deck auth model verbatim:
// admin via ANT_API_KEY bearer, otherwise scoped by room invite token.

function presentedMasterKey(event: RequestEvent): string | null {
  const auth = event.request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return event.request.headers.get('x-api-key') || event.url.searchParams.get('apiKey');
}

export function isSheetAdmin(event: RequestEvent): boolean {
  return Boolean(process.env.ANT_API_KEY && presentedMasterKey(event) === process.env.ANT_API_KEY);
}

export function assertSheetAccess(event: RequestEvent, sheet: SheetMeta, opts: { write?: boolean } = {}): void {
  if (isSheetAdmin(event)) return;
  const scope = roomScope(event);
  if (!scope) throw error(401, 'Sheet access requires a room invite token');
  if (!sheet.allowed_room_ids.includes(scope.roomId)) {
    throw error(403, 'Room token does not authorise this sheet');
  }
  if (opts.write) assertCanWrite(event);
}

export function currentRoomId(event: RequestEvent): string | null {
  if (isSheetAdmin(event)) return null;
  return roomScope(event)?.roomId ?? null;
}

export function requireSheetCaller(event: RequestEvent): { admin: true; scope: null } | { admin: false; scope: RoomScope } {
  if (isSheetAdmin(event)) return { admin: true, scope: null };
  const scope = roomScope(event);
  if (!scope) throw error(401, 'Sheet access requires a room invite token');
  return { admin: false, scope };
}
