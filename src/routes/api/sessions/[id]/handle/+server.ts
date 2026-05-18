import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { assertNotRoomScoped } from '$lib/server/room-scope';

// PATCH /api/sessions/:id/handle
// Body: { handle: '@myhandle' | null, display_name?: string }
export async function PATCH(event: RequestEvent<{ id: string }>) {
  // Changing the room's handle is admin-only — guests can't rename the room.
  assertNotRoomScoped(event);
  const { params, request } = event;
  const session = queries.getSession(params.id);
  if (!session) return json({ error: 'Session not found' }, { status: 404 });
  if (session.archived || session.deleted_at) {
    return json({ error: 'Session is inactive' }, { status: 410 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawHandle = typeof body?.handle === 'string' ? body.handle.trim() : body?.handle;
  const displayName = typeof body?.display_name === 'string' && body.display_name.trim()
    ? body.display_name.trim()
    : null;

  // Normalise: ensure handle starts with @ if provided
  const normalised = rawHandle
    ? (rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`)
    : null;

  // Check uniqueness if setting a handle
  if (normalised) {
    const existing = queries.getSessionByHandle(normalised);
    if (existing && existing.id !== params.id) {
      return json({ error: `${normalised} is already taken` }, { status: 409 });
    }
  }

  queries.setHandle(params.id, normalised, displayName);

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, {
    type: 'handle_updated',
    sessionId: params.id,
    handle: normalised,
    display_name: displayName,
  });

  return json({ handle: normalised, display_name: displayName });
}
