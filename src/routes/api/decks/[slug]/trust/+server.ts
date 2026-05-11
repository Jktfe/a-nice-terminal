// B2 of main-app-improvements-2026-05-10 — form-friendly POST handler
// that flips a deck's trust_mode. Used by the Safe-mode banner the
// deck proxy injects: a plain HTML form posts here (no JS required,
// works under the strict Safe CSP), we update the deck row, and
// redirect the browser back to the deck so it re-fetches with the
// new CSP from the proxy.

import { error, json, redirect, type RequestEvent } from '@sveltejs/kit';
import { isDeckTrustMode, readDeckMeta, setDeckTrustMode } from '$lib/server/decks';
import { requireDeckCaller } from '$lib/server/deck-auth';
import { assertCanWrite } from '$lib/server/room-scope';

function slugParam(event: RequestEvent): string {
  return String((event.params as Record<string, string>).slug ?? '');
}

async function parseMode(event: RequestEvent): Promise<'safe' | 'trusted'> {
  const ct = event.request.headers.get('content-type') || '';
  let raw: unknown = null;
  if (ct.includes('application/json')) {
    try {
      const body = await event.request.json();
      raw = (body as any)?.mode ?? (body as any)?.trust_mode;
    } catch {
      throw error(400, 'Invalid JSON body');
    }
  } else {
    const form = await event.request.formData();
    raw = form.get('mode') ?? form.get('trust_mode');
  }
  if (!isDeckTrustMode(raw)) throw error(400, 'mode must be "safe" or "trusted"');
  return raw;
}

export async function POST(event: RequestEvent) {
  const slug = slugParam(event);
  const existing = readDeckMeta(slug);
  if (!existing) throw error(404, 'deck not found');

  const caller = requireDeckCaller(event);
  if (!caller.admin) {
    assertCanWrite(event);
    if (caller.scope.roomId !== existing.owner_session_id) {
      throw error(403, 'Only the deck owner room can flip trust_mode');
    }
  }

  const mode = await parseMode(event);
  const deck = setDeckTrustMode(slug, mode);

  // Form submissions expect a 303 redirect back to the deck; JSON
  // callers (CLI, fetch from JS) get the updated deck as JSON.
  const accept = event.request.headers.get('accept') || '';
  const ct = event.request.headers.get('content-type') || '';
  if (ct.includes('application/json') || accept.includes('application/json')) {
    return json({ ok: true, deck });
  }
  throw redirect(303, `/deck/${encodeURIComponent(slug)}/`);
}
