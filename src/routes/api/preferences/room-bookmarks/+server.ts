import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { listRoomBookmarks, replaceRoomBookmarks } from '$lib/server/roomBookmarkStore';
import { canonicaliseOperatorHandle, getOperatorHandle } from '$lib/server/operatorHandle';

function ownerFromUrl(url: URL): string {
  const owner = url.searchParams.get('owner');
  return owner && owner.trim().length > 0
    ? canonicaliseOperatorHandle(owner)
    : getOperatorHandle();
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

  // Persistence robustness (JWPK 2026-06-09 "stars aren't persisting"): a save
  // is NOT all-or-nothing. Previously ANY bookmarked room that findChatRoomById
  // couldn't resolve (a since-deleted/churned room left in the user's star set)
  // threw 404 for the WHOLE PUT — and the client fires-and-forgets + swallows
  // the error, so one stale bookmark silently killed persistence for ALL stars.
  // Skip unknown rooms instead; the valid ones persist.
  const roomIds = body.roomIds.filter(
    (roomId): roomId is string => typeof roomId === 'string' && Boolean(findChatRoomById(roomId))
  );

  return json({
    ownerHandle: owner,
    roomIds: replaceRoomBookmarks(owner, roomIds).map((bookmark) => bookmark.roomId)
  });
};
