// Phase C of server-split-2026-05-11 — internal notify endpoint.
//
// The Phase D CLI direct-write path writes to ant.db via the persist
// library and then fires this endpoint best-effort so live consumers
// (channel webhooks, WS subscribers) see the message immediately
// without waiting for the 5s catch-up poller.
//
// Contract:
//   - Authenticated via assertCanWrite (the CLI sends its bearer or
//     the local key; web clients should not hit this path).
//   - Returns 202 Accepted IMMEDIATELY after enqueuing the replay.
//     We do NOT await runSideEffects in the response path — the
//     awaited round-trip from the CLI must stay sub-50ms.
//   - The actual replay happens through replayPendingBroadcasts so
//     the isReplaying guard naturally serialises this call with the
//     5s poller. A flood of CLI sends gets deduped to one in-flight
//     replay cycle at a time.
//   - Body shape is intentionally minimal: { id?: string } — the
//     id is informational (helpful for logs) but not required. The
//     catch-up loop loads all pending rows regardless.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { assertCanWrite } from '$lib/server/room-scope';
import { replayPendingBroadcasts } from '$lib/server/processor/catchup';

export async function POST(event: RequestEvent) {
  assertCanWrite(event);

  // Parse body permissively; the id is logged but the catchup loop
  // reads pending rows directly so we don't need to look up by id.
  let messageId: string | null = null;
  try {
    const body: any = await event.request.json();
    if (body && typeof body.id === 'string') messageId = body.id;
  } catch {
    // empty body / non-JSON is fine — replay happens regardless.
  }

  // Kick off the replay. Promise is deliberately NOT awaited: the
  // 202 returns immediately and replay runs as a background task.
  // isReplaying inside replayPendingBroadcasts dedupes concurrent
  // callers; the 5s poller will still pick up anything we miss.
  void replayPendingBroadcasts().catch((err) => {
    // Best-effort: log and move on. Phase C's catchup loop has its
    // own broadcast_attempts retry bookkeeping inside runSideEffects.
    console.error('[notify-new-message] replay error:', err);
  });

  return json({ accepted: true, message_id: messageId }, { status: 202 });
}
