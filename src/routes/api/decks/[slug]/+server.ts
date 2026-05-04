import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { readDeckMeta, registerDeck } from '$lib/server/decks';
import { assertDeckAccess, requireDeckCaller } from '$lib/server/deck-auth';
import { assertCanWrite } from '$lib/server/room-scope';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

function assertOwner(event: RequestEvent, ownerSessionId: string): void {
  const caller = requireDeckCaller(event);
  if (caller.admin) return;
  assertCanWrite(event);
  if (caller.scope.roomId !== ownerSessionId) {
    throw error(403, 'Only the deck owner room can update this deck');
  }
}

export function GET(event: RequestEvent) {
  requireDeckCaller(event);
  const deck = readDeckMeta(slugParam(event));
  if (!deck) throw error(404, 'deck not found');
  assertDeckAccess(event, deck);
  return json({ ok: true, deck });
}

export async function PATCH(event: RequestEvent) {
  const existing = readDeckMeta(slugParam(event));
  if (!existing) throw error(404, 'deck not found');
  assertOwner(event, existing.owner_session_id);

  let body: any = {};
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const deck = registerDeck({
    slug: slugParam(event),
    owner_session_id: existing.owner_session_id,
    allowed_room_ids: Array.isArray(body.allowed_room_ids)
      ? body.allowed_room_ids.filter((roomId: unknown): roomId is string => typeof roomId === 'string' && roomId.length > 0)
      : existing.allowed_room_ids,
    deck_dir: typeof body.deck_dir === 'string' ? body.deck_dir : existing.deck_dir,
    dev_port: body.dev_port === null ? null : Number.isFinite(Number(body.dev_port)) ? Number(body.dev_port) : existing.dev_port,
  });

  return json({ ok: true, deck });
}

export function DELETE(event: RequestEvent) {
  const existing = readDeckMeta(slugParam(event));
  if (!existing) throw error(404, 'deck not found');
  assertOwner(event, existing.owner_session_id);
  queries.deleteDeck(existing.slug);
  return json({ ok: true, slug: existing.slug });
}
