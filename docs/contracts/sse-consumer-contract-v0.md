---
contract_id: sse-consumer-contract-v0
title: SSE consumer contract v0 — room-event subscription for pane-injection + browser clients
status: draft
visibility: oss
proposed_by: "@speedyclaude (with @claudev4 as finish-layer reviewer)"
proposed_at: 2026-05-23
linked_rooms: ["yz4clwzvbm"]
---

# SSE consumer contract v0

## Problem this solves

Current room-event delivery has two consumer shapes both running on polling:

1. **Pane-injection (Windows pane-router, etc.)** — polls every 2s for new room events. Per @claudev4's flag in `yz4clwzvbm`: "router poll-ms 2s + agent gen 5-10s" — the polling is the slow leg.
2. **Browser room view** — uses `EventSource` against `/api/realtime/[roomId]/events`. Receives events in near-real-time. Works today.

The server-side SSE pipe exists (`broadcastToRoom` in `eventBroadcast.ts` → `/api/realtime/[roomId]/events`). What's missing is:

- A **node-side consumer pattern** for the pane-router (no `EventSource` in Node by default)
- An **event sequence ID** so reconnects don't lose events
- A **backfill endpoint** for missed events on reconnect
- An **event-type catalogue** so consumers know what to expect

This contract defines the consumer-facing shape so the pane-router (claudev4's lane) and the existing browser room view can share one pipe.

## Event payload shape

Current broadcast emits `{ type: '<event-type>', ...payload }`. The catalogue of types in use today (grep `broadcastToRoom(` in `src/`):

| Event type | Source | Payload shape | Consumer interest |
|---|---|---|---|
| `message_added` | many — `pty-inject-fanout`, `terminalReplyRouter`, stage endpoints, asks/answer | `{ message: ChatMessage }` | **Pane-injection: YES**. Browser: YES. |
| `ask_resolved` | `asks/[askId]/answer`, `asks/[askId]/dismiss` | `{ askId, targetHandle, status, stillResponseRequired }` | Pane-injection: NO. Browser ask-pill: YES. |
| `stage_pause_context` | `decks/[deckId]/stage-pause-context` | (stage-specific payload) | Pane-injection: NO. Stage viewer: YES. |
| `test` | tests only | various | NA |

Consumer SHOULD filter by `event.type`. The contract is additive — new event types may be added; consumers ignore unknown types.

## Proposed extensions to the broadcast layer

### 1. Add a monotonic per-room sequence ID

`broadcastToRoom(roomId, event)` should attach a per-room monotonically increasing `seq` field before serialising:

```typescript
// in eventBroadcast.ts
const roomSeqCounters = new Map<string, number>();

export function broadcastToRoom(roomId: string, event: Record<string, unknown>): void {
  const seq = (roomSeqCounters.get(roomId) ?? 0) + 1;
  roomSeqCounters.set(roomId, seq);
  const payload = `id: ${seq}\ndata: ${JSON.stringify({ ...event, seq })}\n\n`;
  // ... rest unchanged
}
```

The `id:` field per SSE spec makes EventSource set its `lastEventId` automatically on reconnect. The duplicated `seq` inside the JSON lets node consumers without EventSource use it as well.

**Caveat:** in-memory counter — resets on server restart. For v0 this is acceptable (browser reconnect after server restart gets fresh events from seq 1; backfill endpoint can detect "seq lower than my last" as "server restarted" and discard the bookmark).

### 2. Add a backfill endpoint

`GET /api/realtime/[roomId]/events/backfill?since_seq=N` returns events since the given seq. Implementation depends on persistence:

- **v0 (today):** events are not persisted; backfill returns 410 Gone for any since_seq → consumer just resumes from current. Acceptable for "you might miss N seconds of events during disconnect" — pane-injection is best-effort anyway, the next `message_added` arriving will trigger the right surface.
- **v1 (future):** persist events to a ring buffer (last 1000 per room) so backfill returns the actual missed events. Worth scoping when we want reliable resume.

### 3. Document the heartbeat contract

Current: 25s comment-ping (`: heartbeat\n\n`). Consumers should:
- Treat any inbound bytes (event or heartbeat) as "connection healthy"
- Reconnect if NO inbound bytes for > 60s (2x heartbeat interval + slack)
- Use the SSE auto-reconnect for browsers; implement explicit retry loop for node clients

## Node-side consumer pattern (pane-router shape)

For a node consumer (pane-router, etc.), recommended implementation:

```typescript
async function subscribeRoomEvents(
  roomId: string,
  authBearer: string,
  onEvent: (event: { type: string; seq: number; [k: string]: unknown }) => void
): Promise<{ close: () => void }> {
  let lastSeq = 0;
  let aborted = false;
  let currentController: AbortController | null = null;

  async function connect() {
    while (!aborted) {
      const ctl = new AbortController();
      currentController = ctl;
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${authBearer}`,
          Accept: 'text/event-stream'
        };
        if (lastSeq > 0) headers['Last-Event-ID'] = String(lastSeq);
        const res = await fetch(`http://127.0.0.1:6174/api/realtime/${roomId}/events`, {
          headers,
          signal: ctl.signal
        });
        if (!res.ok || !res.body) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        // Parse SSE frames: lines starting with "data:" carry JSON payload
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let frameEnd: number;
          while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, frameEnd);
            buffer = buffer.slice(frameEnd + 2);
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const event = JSON.parse(dataLine.slice(5).trim());
              if (typeof event.seq === 'number') lastSeq = event.seq;
              onEvent(event);
            } catch {
              /* malformed frame; skip */
            }
          }
        }
      } catch {
        /* network error; back off + retry */
      }
      if (!aborted) await new Promise((r) => setTimeout(r, 2000));
    }
  }

  void connect();
  return {
    close: () => {
      aborted = true;
      currentController?.abort();
    }
  };
}
```

This goes in `src/lib/server/realtimeRoomConsumer.ts` (new file) once we agree the contract.

## What @claudev4 owns (finish layer)

Per his offer in `yz4clwzvbm`: the UX surface on the consumer side. Specifically:

1. **Offline indicator** — when `lastEventId` hasn't moved in > 60s, surface a "reconnecting" state to the pane (TUI line at bottom, or a status pill in the browser room view)
2. **Retry feedback** — exponential backoff visible to the user (1s, 2s, 4s, 8s, capped at 30s)
3. **Last-event-id resume on reconnect** — already in the consumer above; the UX is showing "caught up" once seq catches the latest known event
4. **Disconnect warning** — if server is unreachable for > 30s, surface "ANT server unreachable" with a manual retry button

## What @speedyclaude owns (speed layer)

Per the agreed split:

1. **Add `seq` ID + SSE `id:` header to `broadcastToRoom`** — single-file change in `eventBroadcast.ts` + a test
2. **Add `/api/realtime/[roomId]/events/backfill`** v0 (returns 410 Gone for any since_seq; v1 adds real persistence later)
3. **Add `src/lib/server/realtimeRoomConsumer.ts`** with the node-side consumer pattern above
4. **One smoke test** in `src/lib/server/realtimeRoomConsumer.test.ts` — subscribe + broadcast + assert receipt

## Open questions for ratify before code lands

1. **Sequence counter persistence on server restart** — accept v0 in-memory reset, or scope a per-room counter table in SQLite for v0? My read: in-memory is fine; restart is rare enough.
2. **Backfill: 410 Gone vs no-op 200 for v0** — 410 surfaces the gap honestly; 200 with empty array pretends backfill worked. My read: 410 is more honest.
3. **Auth on the backfill endpoint** — uses `requireChatRoomReadAccess` same as the SSE endpoint? My read: yes, same auth model.
4. **Should `message_added` payload include all reactions + read-receipts inline?** Per @speedycodex's earlier note (heads-down status), the decision shape was "inline summary on read, no fanout spam". This contract should respect that — `message_added` carries just the message, reaction summaries come via a separate `reactions_updated` event (or are pulled on demand from a read-model endpoint). Worth confirming.

## Status

Draft. Awaiting @claudev4 review for the UX contract side + ratify on the 4 open questions before I cut the server-side code.

## Cross-references

- `src/routes/api/realtime/[roomId]/events/+server.ts` — existing SSE endpoint this builds on
- `src/lib/server/eventBroadcast.ts` — existing broadcast + subscribe primitives
- `feedback_guard_before_action_meta_pattern_2026_05_23.md` — applies here too: backfill auth check goes BEFORE the load
- `boundary_surface_invisible_upstream_constraints_2026_05_23.md` — applies to SSE proxy timeouts, worth a boundary-shape smoke test for the heartbeat-vs-proxy-idle-timeout boundary
