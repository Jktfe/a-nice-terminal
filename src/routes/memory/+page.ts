/**
 * /memory loader — runs unified recall when ?q=... is in the URL.
 *
 * Backs memory-recall UI slice 2 (/memory page). Mirrors /search loader
 * pattern: plain GET form on the page navigates here, this loader runs
 * server-side, first HTML carries the hits.
 *
 * Per @evolveantcodex slice-2 contract guardrails:
 *   - Encode q when forwarding to /api/memory-recall with limit=50.
 *   - Empty/blank query avoids the recall network call.
 *   - Recall failure does NOT throw — sets recallFetchFailed flag.
 *   - Chair room-name lookup is loader-side AND soft-fails independently
 *     (a chair fetch failure does not poison the recall hits view).
 *
 * Slice 6: loader still calls /api/memory-recall with surfaces=all, which
 * now includes ask hits alongside the existing four kinds. The hit type
 * widens to RecallHitIncludingAsks; only the discriminator render branch
 * on the page changes to surface the new "ask" kind.
 *
 * Slice 9: optional ?roomId scope. Forward encoded roomId to the slice 8
 * endpoint contract; on 404 (unknown room) treat hits as empty + set
 * roomScopeUnknown flag for the UI banner. Default no-?roomId callers
 * keep the exact slice 6 shape — zero drift preserved.
 */

import type { PageLoad } from './$types';
import type { RecallHitIncludingAsks } from '$lib/server/memoryRecallStore';
import type { ChairRowDigest } from '$lib/server/chairStore';

export const load: PageLoad = async ({ url, fetch }) => {
  const rawQuery = url.searchParams.get('q') ?? '';
  const trimmedQuery = rawQuery.trim();
  const rawRoomIdScope = url.searchParams.get('roomId');
  const trimmedRoomIdScope = rawRoomIdScope?.trim() ?? '';
  const roomIdScope = trimmedRoomIdScope.length > 0 ? trimmedRoomIdScope : undefined;
  const longMemoryEnabled = parseBooleanParam(url.searchParams.get('longMemory'));

  if (trimmedQuery.length === 0) {
    return {
      queryFromServer: '',
      hitsFromServer: [] as RecallHitIncludingAsks[],
      roomNameByRoomId: {} as Record<string, string>,
      recallFetchFailed: false,
      roomIdScope,
      roomScopeName: undefined as string | undefined,
      roomScopeUnknown: false,
      longMemoryEnabled
    };
  }

  const recallParams = new URLSearchParams({
    query: trimmedQuery,
    limit: '50',
    surfaces: 'all'
  });
  if (roomIdScope !== undefined) recallParams.set('roomId', roomIdScope);
  if (longMemoryEnabled) recallParams.set('longMemory', '1');
  const recallUrl = `/api/memory-recall?${recallParams.toString()}`;

  const [recallResponse, chairResponse] = await Promise.all([
    fetch(recallUrl),
    fetch('/api/chair')
  ]);

  let hits: RecallHitIncludingAsks[] = [];
  let recallFetchFailed = false;
  let roomScopeUnknown = false;
  if (recallResponse.ok) {
    const recallBody = (await recallResponse.json()) as { hits: RecallHitIncludingAsks[] };
    hits = recallBody.hits ?? [];
  } else if (recallResponse.status === 404 && roomIdScope !== undefined) {
    // Slice 8 endpoint returns 404 for unknown roomId. Soft-fail at the
    // page layer: show a scoped-error banner rather than throwing.
    roomScopeUnknown = true;
  } else {
    recallFetchFailed = true;
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
  // Chair failure is soft-failed independently: note hits will fall back
  // to their roomId in the UI render path.

  const roomScopeName =
    roomIdScope !== undefined ? roomNameByRoomId[roomIdScope] : undefined;

  return {
    queryFromServer: trimmedQuery,
    hitsFromServer: hits,
    roomNameByRoomId,
    recallFetchFailed,
    roomIdScope,
    roomScopeName,
    roomScopeUnknown,
    longMemoryEnabled
  };
};

function parseBooleanParam(rawValue: string | null): boolean {
  if (rawValue === null) return false;
  const normalized = rawValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}
