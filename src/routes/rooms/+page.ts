import type { PageLoad } from './$types';
import type { RoomCard } from '$lib/domain/types';

type ChatRoomsApiResponse = { chatRooms: RoomCard[] };
type PlanProgressApiResponse = {
  progress: Record<string, { total: number; completed: number; pct: number }>;
};

export const load: PageLoad = async ({ fetch }) => {
  const [roomsRes, progressRes] = await Promise.all([
    fetch('/api/chat-rooms'),
    fetch('/api/chat-rooms/plan-progress')
  ]);

  if (!roomsRes.ok) {
    return { chatRoomsFromServer: [] as RoomCard[], serverRoomListFailed: true };
  }

  const body = (await roomsRes.json()) as ChatRoomsApiResponse;
  const rooms = body.chatRooms ?? [];

  // Merge plan progress when available (best-effort; endpoint may 401/404
  // on older builds or when not yet deployed).
  if (progressRes.ok) {
    const progressBody = (await progressRes.json()) as PlanProgressApiResponse;
    const progress = progressBody.progress ?? {};
    for (const room of rooms) {
      if (progress[room.id]) {
        room.planProgress = progress[room.id];
      }
    }
  }

  return { chatRoomsFromServer: rooms, serverRoomListFailed: false };
};
