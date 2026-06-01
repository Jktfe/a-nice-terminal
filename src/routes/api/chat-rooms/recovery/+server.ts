import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listArchivedChatRooms,
  listDeletedChatRooms
} from '$lib/server/chatRoomStore';

export const GET: RequestHandler = () => {
  return json({
    archivedRooms: listArchivedChatRooms(),
    deletedRooms: listDeletedChatRooms()
  });
};
