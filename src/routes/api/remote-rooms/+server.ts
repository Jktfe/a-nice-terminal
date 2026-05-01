// GET /api/remote-rooms — returns the joined remote rooms from ~/.ant/config.json.
// Strips the bearer token from the response (server-side only); UI never needs
// the raw token, it goes via /remote/[id]/proxy when posting/streaming.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { listRemoteRooms } from '$lib/server/remote-rooms';
import { assertNotRoomScoped } from '$lib/server/room-scope';

export function GET(event: RequestEvent) {
  // Local-instance config is admin-scope. A room-scoped bearer should not be
  // able to enumerate other rooms the user has joined.
  assertNotRoomScoped(event);
  const rooms = listRemoteRooms().map((r) => ({
    room_id: r.room_id,
    server_url: r.server_url,
    kind: r.kind,
    handle: r.handle,
    joined_at: r.joined_at,
    label: r.label,
    server_url_inferred: r.server_url_inferred,
    // Token deliberately omitted — see proxy routes.
  }));
  return json({ rooms });
}
