import { parseEnv } from "../env.ts";
import { antApiFetch } from "./http-client.ts";
import { mapRoom } from "./rooms-list.ts";
import { validateRoomsGetParams } from "./validation.ts";

export async function antRoomsGet(params: unknown) {
  const { roomId } = validateRoomsGetParams(params);
  const response = await antApiFetch<{ chatRoom: Parameters<typeof mapRoom>[0] }>(
    `/api/chat-rooms/${encodeURIComponent(roomId)}`,
    { method: "GET", env: parseEnv() },
  );
  const room = mapRoom(response.chatRoom);
  return { room: { id: room.id, name: room.name, members: room.members } };
}
