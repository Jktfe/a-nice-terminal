import type { PageLoad } from './$types';
import type { RoomCard } from '$lib/domain/types';
import type { Ask } from '$lib/server/askStore';

export const load: PageLoad = async ({ fetch }) => {
  const [roomsResp, asksResp] = await Promise.all([
    fetch('/api/chat-rooms').catch(() => null),
    fetch('/api/asks').catch(() => null)
  ]);

  const chatRoomsFromServer: RoomCard[] = roomsResp?.ok
    ? ((await roomsResp.json()) as { chatRooms: RoomCard[] }).chatRooms ?? []
    : [];
  const asksFromServer: Ask[] = asksResp?.ok
    ? ((await asksResp.json()) as { asks: Ask[] }).asks ?? []
    : [];

  return {
    chatRoomsFromServer,
    asksFromServer,
    serverRoomListFailed: !roomsResp?.ok
  };
};
