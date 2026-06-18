import type { ChatRoom } from './chatRoomStore';
import { findChatRoomById, listChatRooms } from './chatRoomStore';

const DEFAULT_BROWSER_LOGIN_ROOM_ID = 'fnokx03pud';

export function configuredBrowserLoginRoomId(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANT_BROWSER_LOGIN_ROOM_ID || env.ANT_DEMO_ROOM_ID || DEFAULT_BROWSER_LOGIN_ROOM_ID;
}

export function resolveBrowserLoginRoom(preferredRoomId = configuredBrowserLoginRoomId()): ChatRoom | null {
  const configured = preferredRoomId.trim();
  if (configured.length > 0) {
    const room = findChatRoomById(configured);
    if (room) return room;
  }

  return listChatRooms()[0] ?? null;
}
