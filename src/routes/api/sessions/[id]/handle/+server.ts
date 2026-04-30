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
  const { handle, display_name } = await request.json();

  // Normalise: ensure handle starts with @ if provided
  const normalised = handle
    ? (handle.startsWith('@') ? handle : `@${handle}`)
    : null;

  // Check uniqueness if setting a handle
  if (normalised) {
    const existing = queries.getSessionByHandle(normalised);
    if (existing && existing.id !== params.id) {
      return json({ error: `${normalised} is already taken` }, { status: 409 });
    }
  }

  queries.setHandle(params.id, normalised, display_name || null);

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(params.id, {
    type: 'handle_updated',
    sessionId: params.id,
    handle: normalised,
    display_name: display_name || null,
  });

  return json({ handle: normalised, display_name: display_name || null });
}
