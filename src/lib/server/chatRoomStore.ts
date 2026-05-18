import { randomUUID } from 'node:crypto';
import getDb, { queries } from './db';

export type ChatRoomRecord = {
  id: string;
  name: string;
  type: string;
  archived: number;
  deleted_at: string | null;
};

export function createChatRoom(input: { id?: string; name: string }): ChatRoomRecord {
  const id = input.id ?? `room-${randomUUID()}`;
  queries.createSession(id, input.name, 'chat', 'forever', null, null, '{}');
  return queries.getSession(id) as ChatRoomRecord;
}

export function findChatRoomById(roomId: string): ChatRoomRecord | undefined {
  const row = queries.getSession(roomId) as ChatRoomRecord | undefined;
  if (!row || row.type !== 'chat' || row.deleted_at !== null || row.archived !== 0) return undefined;
  return row;
}

export function resetChatRoomStoreForTests(): void {
  getDb().prepare(`DELETE FROM sessions WHERE type = 'chat'`).run();
}
