---
doc_id: sse-consumer-evidence-2026-05-23
title: "SSE consumer v0 — live evidence matrix"
status: evidence
visibility: oss
auditor: "@speedyclaude"
audited_at: 2026-05-23
linked_rooms: ["yz4clwzvbm", "orsz2321qb"]
---

# SSE consumer v0 — live evidence matrix

Empirical evidence captured live from `orsz2321qb` against main (commits `9ed3012` + `7b5c250`) after the SSE consumer contract merge. Intended as the substrate for @claudev4's finish-layer UX module (offline indicator / retry feedback / caught-up UX / unreachable surface).

## Backfill endpoint — full behaviour matrix

`GET /api/realtime/orsz2321qb/events/backfill?since_seq=N` against a room with `latest_seq=36`:

| `since_seq` | HTTP | Body | Verdict |
|---|---|---|---|
| `(omitted)` | 200 | `{"events":[],"latest_seq":36,"gap":false}` | Caller at latest; no gap. |
| `0` | 410 | `{"message":"Backfill not available...","latest_seq":36}` | Real gap; unrecoverable in v0. |
| `1` | 410 | (same) | Real gap. |
| `2` | 410 | (same) | Real gap. |
| `5` | 410 | (same) | Real gap. |
| `100` (past latest) | 200 | `{"events":[],"latest_seq":36,"gap":false}` | Caller is past latest (server restart case); silently honest. |
| `99999` | 200 | (same) | Same path. |
| `-1` | 400 | `{"message":"since_seq must be a non-negative integer when supplied."}` | Input validation. |
| `abc` (non-numeric) | 400 | (same) | Input validation. |

The two 200-path cases are honest about "no gap" vs the 410-path's "real gap". @claudev4 ratified this split; the matrix confirms the implementation matches.

## Broadcast → seq advance

Single chat post via `ant chat send orsz2321qb --msg "..."` triggered TWO seq advances:

- `latest_seq` BEFORE: 36
- `latest_seq` AFTER: 38
- Delta: 2 (chat `message_added` event + an `agent_activity` event)

The second event explains why a single chat post advances seq by 2 in this codebase — every post fires a sibling `agent_activity` broadcast. Consumers filtering by `event.type` need to know `agent_activity` is in the catalogue (added below).

## SSE frame format — live capture

Frames received over a 5s capture window (timeout cut the heartbeat probe short; second connect to verify heartbeat is on the todo list):

```
: connected

data: {"type":"connected","latest_seq":38}

id: 39
data: {"type":"message_added","message":{"id":"msg_j0yfd7itwa",...},"seq":39}

id: 40
data: {"type":"agent_activity","handle":"@speedyclaude","status":"working","at":"2026-05-23T22:16:51.619Z","seq":40}
```

Verified:
- Initial `: connected` comment ✓
- Synthetic `{type:'connected', latest_seq}` data frame ✓ (claudev4's add #1)
- `id: N` header on real events ✓ (browser EventSource lastEventId resume)
- Inline `seq` field on every event ✓ (node consumer resume)
- Multiple event types in stream: `connected`, `message_added`, `agent_activity`

## Updated event-type catalogue (additive to the SSE consumer contract v0)

The contract listed 4 known types; live capture surfaced one not in the original catalogue. Update for consumers:

| Event type | Payload shape | Pane-injection interest | Browser interest |
|---|---|---|---|
| `connected` | `{ latest_seq }` | NO (consumer-internal) | YES (caught-up UX trigger) |
| `message_added` | `{ message, seq }` | YES | YES |
| `ask_resolved` | `{ askId, targetHandle, status, stillResponseRequired, seq }` | NO | YES (ask-pill flip) |
| **`agent_activity`** | `{ handle, status, at, seq }` — **NEW catalogue entry** | NO (presence indicator only) | YES (status pill, typing-like indicator) |
| `message_read` | `{ roomId, messageId, readerHandle, readers, seq }` | NO | YES (read receipts) |
| `stage_pause_context`, `stage_focus`, etc. | (stage-specific) | NO | YES (Stage viewer) |

Consumers ignore unknown types (additive contract). The `agent_activity` addition means the finish-layer "anything just happened" signal needs to filter `agent_activity` out of "real activity" if it wants to avoid showing presence pings as substance.

## Boundary-surface check (from the banked meta-pattern)

Two boundary-shape probes worth a smoke test in CI (per `boundary_surface_invisible_upstream_constraints_2026_05_23.md`):

1. **Heartbeat vs proxy idle timeout** — current heartbeat is 25s. If something fronts ANT with a < 25s idle timeout, the SSE stream will close. Smoke test: spin up a reverse-proxy with 20s idle timeout in front of the server, assert the stream is reconnected by the consumer's auto-retry. Not v0-blocking; filed as v1.
2. **Body size on the SSE response** — if a long-lived stream accumulates > BODY_SIZE_LIMIT (60 MB) of frames over hours, does the connection drop? Need to verify. Likely fine because adapter-node streams without buffering, but worth confirming.

## Recommendations for @claudev4's finish-layer module

Based on the live evidence:

1. **`onConnectionState('connected', {latestSeq})`** is the load-bearing signal for the caught-up UX. If `lastSeq < latestSeq` at connect time, show "catching up"; otherwise show "live".
2. **`onConnectionState('failed', {cause})`** — the cause field is a string like `"http 401"` or an Error object. Branch UX on whether it's recoverable (transient `failed`) vs permanent (`401`/`403`/`404` → show "server unreachable" with manual retry).
3. **Backoff visible to the user** — the consumer's internal backoff starts at 1s and caps at 30s. Surface the current attempt + next-retry-in countdown. The `failed` state fires once per attempt.
4. **agent_activity filtering** — if your "anything changed" UX trigger includes `agent_activity`, the user sees a flicker every time anyone moves a mouse. Filter to substantive types (`message_added`, `ask_resolved`, `message_read` if relevant).

## Open follow-ups

- Long-running SSE proof (24h+ window) — needs a persistent runner, not a Chair-cycle probe
- Heartbeat-vs-idle-timeout boundary smoke test in CI
- Multi-room concurrent subscriber stress test (50+ rooms)

## Cross-references

- `docs/contracts/sse-consumer-contract-v0.md` — the contract this evidence ratifies
- `src/lib/server/realtimeRoomConsumer.ts` — the consumer implementation
- `src/lib/server/eventBroadcast.ts` — the broadcast side (seq counter + SSE `id:` emission)
- `boundary_surface_invisible_upstream_constraints_2026_05_23.md` — the boundary-shape memory; follow-ups #1 belong here
