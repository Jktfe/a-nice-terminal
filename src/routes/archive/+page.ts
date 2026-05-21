import type { PageLoad } from './$types';
import type { RoomCard } from '$lib/domain/types';

// The recovery endpoint enriches each RoomCard with the lifecycle
// timestamps the archive surface needs (and a soft-delete restore
// gate). RoomCard itself stays lean for the live-room surfaces.
export type RecoverableRoomCard = RoomCard & {
  archivedAtMs: number | null;
  deletedAtMs: number | null;
  restorable: boolean;
  deleteBoundary?: string;
};

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch('/api/chat-rooms/recovery');
  if (!response.ok) {
    return {
      archivedRooms: [] as RecoverableRoomCard[],
      deletedRooms: [] as RecoverableRoomCard[],
      serverFailed: true as const
    };
  }
  const body = (await response.json()) as {
    archivedRooms: RecoverableRoomCard[];
    deletedRooms: RecoverableRoomCard[];
  };
  return {
    archivedRooms: body.archivedRooms ?? [],
    deletedRooms: body.deletedRooms ?? [],
    serverFailed: false as const
  };
};
