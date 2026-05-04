import { error, type RequestEvent } from '@sveltejs/kit';
import { roomScope, assertCanWrite, type RoomScope } from './room-scope.js';
import type { DeckMeta } from './decks.js';

function presentedMasterKey(event: RequestEvent): string | null {
  const auth = event.request.headers.get('authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return event.request.headers.get('x-api-key') || event.url.searchParams.get('apiKey');
}

export function isDeckAdmin(event: RequestEvent): boolean {
  return Boolean(process.env.ANT_API_KEY && presentedMasterKey(event) === process.env.ANT_API_KEY);
}

export function assertDeckAccess(event: RequestEvent, deck: DeckMeta, opts: { write?: boolean } = {}): void {
  if (isDeckAdmin(event)) return;
  const scope = roomScope(event);
  if (!scope) throw error(401, 'Deck access requires a room invite token');
  if (!deck.allowed_room_ids.includes(scope.roomId)) {
    throw error(403, 'Room token does not authorise this deck');
  }
  if (opts.write) assertCanWrite(event);
}

export function currentRoomId(event: RequestEvent): string | null {
  if (isDeckAdmin(event)) return null;
  return roomScope(event)?.roomId ?? null;
}

export function requireDeckCaller(event: RequestEvent): { admin: true; scope: null } | { admin: false; scope: RoomScope } {
  if (isDeckAdmin(event)) return { admin: true, scope: null };
  const scope = roomScope(event);
  if (!scope) throw error(401, 'Deck access requires a room invite token');
  return { admin: false, scope };
}
