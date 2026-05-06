import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { listDeckFiles, readDeckManifest, readDeckMeta } from '$lib/server/decks';
import { assertDeckAccess, requireDeckCaller } from '$lib/server/deck-auth';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

export function GET(event: RequestEvent) {
  requireDeckCaller(event);
  const deck = readDeckMeta(slugParam(event));
  if (!deck) throw error(404, 'deck not found');
  assertDeckAccess(event, deck);
  return json({ ok: true, deck, files: listDeckFiles(deck), manifest: readDeckManifest(deck) });
}
