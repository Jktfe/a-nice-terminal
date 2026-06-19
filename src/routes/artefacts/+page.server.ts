import type { PageServerLoad } from './$types';
import { listArtefactsInRoom } from '$lib/server/chatRoomArtefactStore';
import { listChatRooms } from '$lib/server/chatRoomStore';
import { listReadableChatRooms } from '$lib/server/chatRoomReadGate';

export const load: PageServerLoad = async ({ request }) => {
  const readableRooms = await listReadableChatRooms(request, listChatRooms());
  const roomNames = new Map(readableRooms.map((room) => [room.id, room.name]));
  const artefacts = readableRooms
    .flatMap((room) =>
      listArtefactsInRoom(room.id).map((artefact) => ({
        ...artefact,
        roomName: roomNames.get(artefact.roomId) ?? artefact.roomId
      }))
    )
    .sort((a, b) => b.createdAtMs - a.createdAtMs);

  return { artefacts };
};
