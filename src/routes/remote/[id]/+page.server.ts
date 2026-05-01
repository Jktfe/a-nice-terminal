// Loads the remote-room metadata so the page can render label / handle / server
// before the client opens the SSE stream. Bearer token deliberately not exposed.

import { error } from '@sveltejs/kit';
import { getRemoteRoom } from '$lib/server/remote-rooms';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const room = getRemoteRoom(params.id);
  if (!room) {
    throw error(404, `Remote room "${params.id}" not joined. Run: ant join-room <share-string>`);
  }
  return {
    room: {
      room_id: room.room_id,
      server_url: room.server_url,
      kind: room.kind,
      handle: room.handle,
      label: room.label,
      joined_at: room.joined_at,
    },
  };
};
