import { parseEnv } from "../env.ts";
import { antApiFetch } from "./http-client.ts";
import { validateRoomsListParams } from "./validation.ts";

type DaemonRoom = {
  id: string;
  name: string;
  lastUpdate?: string;
  archivedAtMs?: number | null;
  deletedAtMs?: number | null;
  members?: Array<{ handle: string; displayName: string; kind: "human" | "agent" }>;
};

export function mapRoom(room: DaemonRoom) {
  return {
    id: room.id,
    name: room.name,
    lastUpdate: room.lastUpdate ?? null,
    members: (room.members ?? []).map((member) => ({
      handle: member.handle,
      displayName: member.displayName,
      kind: member.kind,
    })),
  };
}

export async function antRoomsList(params: unknown) {
  const parsed = validateRoomsListParams(params);
  const response = await antApiFetch<{ chatRooms: DaemonRoom[] }>("/api/chat-rooms", {
    method: "GET",
    env: parseEnv(),
  });
  let rooms = response.chatRooms;
  if (parsed.archived !== true) {
    rooms = rooms.filter((room) => room.archivedAtMs === undefined || room.archivedAtMs === null);
  }
  if (parsed.limit !== undefined) rooms = rooms.slice(0, parsed.limit);
  return { rooms: rooms.map(mapRoom) };
}
