/**
 * /asks loader — fetches the cross-room open asks queue.
 *
 * Backs asks UI slice 3. Mirrors /memory loader pattern: parallel fetch
 * for the primary list + a soft-fail roomName resolver from /api/chair.
 *
 * Per @evolveantcodex slice-3 guard: /api/asks failure and /api/chair
 * room-name lookup failure must be INDEPENDENT. A chair fetch failure
 * must NOT hide the asks list (the cards fall back to showing roomId).
 */

import type { PageLoad } from './$types';
import type { Ask } from '$lib/server/askStore';
import type { AskCandidate } from '$lib/server/askCandidateStore';
import type { ChairRowDigest } from '$lib/server/chairStore';

export const load: PageLoad = async ({ fetch }) => {
  const [asksResponse, chairResponse] = await Promise.all([
    fetch('/api/asks'),
    fetch('/api/chair')
  ]);

  let asks: Ask[] = [];
  let recentlyAnswered: Ask[] = [];
  let candidates: AskCandidate[] = [];
  let asksFetchFailed = false;
  if (asksResponse.ok) {
    const asksBody = (await asksResponse.json()) as {
      asks: Ask[];
      recentlyAnswered?: Ask[];
      candidates?: AskCandidate[];
    };
    asks = asksBody.asks ?? [];
    recentlyAnswered = asksBody.recentlyAnswered ?? [];
    candidates = asksBody.candidates ?? [];
  } else {
    asksFetchFailed = true;
  }

  const roomNameByRoomId: Record<string, string> = {};
  if (chairResponse.ok) {
    const chairBody = (await chairResponse.json()) as {
      chairDigest: ChairRowDigest[];
    };
    for (const row of chairBody.chairDigest ?? []) {
      roomNameByRoomId[row.roomId] = row.roomName;
    }
  }

  return {
    asksFromServer: asks,
    recentlyAnsweredFromServer: recentlyAnswered,
    candidatesFromServer: candidates,
    roomNameByRoomId,
    asksFetchFailed
  };
};
