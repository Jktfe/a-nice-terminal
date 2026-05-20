import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listRoomBookmarks, replaceRoomBookmarks } from '$lib/server/roomBookmarkStore';

const DEFAULT_OWNER_HANDLE = '@you';

function ownerFromUrl(url: URL): string {
  const owner = url.searchParams.get('owner');
  return owner && owner.trim().length > 0 ? owner.trim() : DEFAULT_OWNER_HANDLE;
}

export const GET: RequestHandler = ({ url }) => {
  const owner = ownerFromUrl(url);
  return json({
    ownerHandle: owner,
    roomIds: listRoomBookmarks(owner).map((bookmark) => bookmark.roomId)
  });
};

export const PUT: RequestHandler = async ({ request, url }) => {
  const owner = ownerFromUrl(url);
  const body = (await request.json().catch(() => null)) as { roomIds?: unknown } | null;
  if (!body || !Array.isArray(body.roomIds)) {
    throw error(400, 'roomIds array required.');
  }

  const roomIds = body.roomIds.filter((roomId): roomId is string => typeof roomId === 'string');
  for (const roomId of roomIds) {
    if (!findChatRoomById(roomId)) throw error(404, `Room not found: ${roomId}`);
  }

  return json({
    ownerHandle: owner,
    roomIds: replaceRoomBookmarks(owner, roomIds).map((bookmark) => bookmark.roomId)
  });
};
