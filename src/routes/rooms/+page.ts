import type { PageLoad } from './$types';
import type { RoomCard } from '$lib/domain/types';

type ChatRoomsApiResponse = { chatRooms: RoomCard[] };

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch('/api/chat-rooms');
  if (!response.ok) {
    return { chatRoomsFromServer: [] as RoomCard[], serverRoomListFailed: true };
  }
  const body = (await response.json()) as ChatRoomsApiResponse;
  return { chatRoomsFromServer: body.chatRooms ?? [], serverRoomListFailed: false };
};
