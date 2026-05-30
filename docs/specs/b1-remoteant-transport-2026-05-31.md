# B1 — remoteant Persistent Server Transport (WebSocket + SSE fallback)

**Status**: PRE-STAGED (ready for plan-state flip the moment A1+E2 both close)
**Plan**: `remoteant-mac-delivery-2026-05-29`
**Milestone**: `b1-transport` (currently `[planned]`)
**Lead**: @homebrewmainclaude
**Plan momentum**: @homebrewmaincodex
**Implementer**: @kimihomebrewwork
**Source dependency**: A1 scaffold at `a-nice-terminal@0dae2f9` + E2 closure (pending)
**Source files touched**: `packages/remoteant/src/transport/*` (new dir), `packages/remoteant/src/cli.ts` (wire transport into mcp-stdio adapter), `packages/remoteant/tests/transport.*.test.ts` (new tests)

---

## 1. B1 Goal

Establish a single long-lived connection from remoteant to the ANT daemon at `:6174` that survives daemon restarts, server crashes, and network blips. Three modes:

1. **WebSocket primary** — `ws://127.0.0.1:6174/api/ws/remoteant` (or wss:// in future). Bidirectional, low latency, gets push notifications for room updates.
2. **SSE fallback** — `GET /api/sse/remoteant` with HTTP keep-alive. Used when WebSocket upgrade fails (proxies, locked-down networks).
3. **Polling last-resort** — `GET /api/bridge/poll` returning a 30-second long-poll. Used when neither WS nor SSE work.

State machine: `disconnected` → `connecting` → `connected` → (on error) `reconnecting` → `connected` | `degraded` | `offline`.

After B1, `ant.ping` (already shipped in A1) returns `{ ok: true, daemonReachable: true, daemonUrl: "ws://...", transportMode: "websocket"|"sse"|"poll" }` (note: new `transportMode` field; B1 extends the A1 ping contract additively).

---

## 2. File Paths (under `packages/remoteant/`)

```
packages/remoteant/src/transport/
├── index.ts              # Transport facade — exposes connect()/send()/subscribe()/disconnect() + state events
├── websocket-driver.ts   # WebSocket implementation using bun's native WebSocket
├── sse-driver.ts         # SSE implementation using fetch + ReadableStream
├── poll-driver.ts        # 30-second long-poll fallback
├── reconnect.ts          # Exponential backoff state machine (1s → 2s → 4s → 8s → 16s → 30s cap)
├── state.ts              # ConnectionState enum + StateChange event type
└── types.ts              # Wire-protocol types shared across drivers

packages/remoteant/tests/
├── transport.websocket.test.ts     # Spin up a mock WS server, assert connect → message → reconnect
├── transport.sse.test.ts           # Mock SSE endpoint, assert fallback path triggers when WS unavailable
├── transport.poll.test.ts          # Mock long-poll endpoint
├── transport.reconnect.test.ts     # Force-close socket, assert exponential backoff timing
└── transport.fallback.test.ts      # WS fails → SSE attempted → SSE fails → poll attempted
```

---

## 3. Wire Contract

### 3.1 WebSocket subprotocol

remoteant sends `Authorization: Bearer <ANT_ADMIN_TOKEN>` as a header on the WebSocket upgrade. Messages are JSON-encoded, one per WebSocket frame.

**Client → Server**:
```json
{ "kind": "heartbeat", "ts": 1717142400000, "daemonPid": 12345, "daemonVersion": "0.1.0" }
{ "kind": "subscribe", "topic": "rooms.O393IH1zFgd_nujpQgnof" }
{ "kind": "unsubscribe", "topic": "rooms.O393IH1zFgd_nujpQgnof" }
```

**Server → Client**:
```json
{ "kind": "event", "topic": "rooms.O393IH1zFgd_nujpQgnof", "event": { "type": "message.created", "payload": {...} } }
{ "kind": "ack", "ref": "heartbeat", "ts": 1717142400000 }
{ "kind": "error", "code": -32002, "message": "auth invalid" }
```

### 3.2 SSE fallback

`GET /api/sse/remoteant` with `Authorization: Bearer <ANT_ADMIN_TOKEN>` header. Server streams `text/event-stream`. Each event is the same JSON envelope as the WS messages, prefixed with `event: ant\ndata: {...}\n\n`.

Client → Server in SSE mode happens via separate `POST /api/sse/remoteant/cmd` requests (since SSE is server-push-only).

### 3.3 Long-poll fallback

`GET /api/bridge/poll?since=<eventId>&timeout=30000` returns a JSON array of events (possibly empty if no events in 30s). Client immediately re-polls with `since=<lastEventId>`.

---

## 4. Connection State Machine

```
            ┌─────────────────────────────┐
            ▼                             │ (on error)
disconnected ──connect()──▶ connecting ──▶ connected
                              │              │
                              │ (fail)       │ (close/error)
                              ▼              ▼
                          reconnecting ◀────┘
                              │
                  (5+ consecutive fails in 60s)
                              ▼
                            degraded (still trying, but UI shows "trouble")
                              │
                          (60+ fails)
                              ▼
                            offline (give up; manual reconnect required)
```

State changes emit `StateChange` events that the mcp-stdio adapter surfaces via the MCP `notifications/bridge.statusChanged` notification (the plan's B1 acceptance criterion: *"surfaces state via bridge.statusChanged notification"*).

The notification payload:
```json
{
  "jsonrpc": "2.0",
  "method": "notifications/bridge.statusChanged",
  "params": {
    "state": "connected" | "connecting" | "reconnecting" | "degraded" | "offline",
    "serverUrl": "ws://127.0.0.1:6174/api/ws/remoteant",
    "transportMode": "websocket" | "sse" | "poll",
    "lastConnectedAtMs": 1717142400000,
    "reconnectAttempt": 0
  }
}
```

---

## 5. Exponential Backoff (reconnect.ts)

```ts
const BACKOFF_SCHEDULE_MS = [1000, 2000, 4000, 8000, 16000, 30000];  // last value repeats
const JITTER_PCT = 0.2;  // ±20% jitter to avoid thundering herd

export function nextBackoff(attempt: number): number {
  const base = BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)];
  const jitter = base * JITTER_PCT * (Math.random() * 2 - 1);  // ±20%
  return Math.max(100, Math.round(base + jitter));
}
```

After 5 consecutive failed reconnects within 60s, transition to `degraded`. After 60s in degraded with no success, transition to `offline`. Manual reconnect is triggered by:
- MCP method `ant.bridge.reconnect` (will be added in B2)
- Process restart (clean state)

---

## 6. Heartbeat Discipline (couples to E1 endpoint)

Every 15s while `connected`, remoteant POSTs `/api/bridge/heartbeat`:

```json
{
  "daemonPid": 12345,
  "daemonVersion": "0.1.0",
  "transportMode": "websocket",
  "uptimeSeconds": 3621
}
```

The server uses these heartbeats to populate the `/api/bridge/status` endpoint's `state` field per the resolution rules in the E1 spec §"/api/bridge/status endpoint" (fresh < 30s → `connected`, stale 30s–5min → `degraded`, > 5min → `offline`).

**B1 dependency on E1 endpoint impl**: the heartbeat target endpoint must exist server-side. If E1-endpoint-impl is not landed by B1 implementation start, kimi can ship B1 with heartbeat POSTs going to a stubbed endpoint (returning 204) that someone else later upgrades to write to a `daemon_heartbeats` table. Flag in B1 PR description.

---

## 7. Acceptance Gates (B1-G1..G7)

| Gate    | Verification                                                                                                          | Evidence                                              |
|---------|-----------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| B1-G1   | WebSocket connects to `:6174/api/ws/remoteant` within 2s of `transport.connect()` call                                | test log timestamp delta                              |
| B1-G2   | Server-pushed event (mock `message.created`) is received by mcp-stdio client as `notifications/event` within 100ms    | vitest assertion                                      |
| B1-G3   | Force-close socket (server-side); reconnect within 1s + jitter; backoff schedule 1s→2s→4s→8s→16s→30s verified         | timing capture from `transport.reconnect.test.ts`     |
| B1-G4   | WS upgrade fails (mock server rejects with 426 Upgrade Required); SSE driver activated within 1s; events flow         | `transport.fallback.test.ts` log                      |
| B1-G5   | SSE also fails (mock server returns 500); poll driver activated; events flow at next poll cycle                       | `transport.fallback.test.ts` log                      |
| B1-G6   | Heartbeat POSTs hit `/api/bridge/heartbeat` every 15s while connected (with ±2s tolerance); zero heartbeats while disconnected | timing capture |
| B1-G7   | State machine emits `notifications/bridge.statusChanged` on every transition; payload matches §4 schema                | vitest assertion                                      |
| B1-G8   | All transport tests pass: `bun test` final tally ≥ 21 (15 from A1 + 6+ new from transport.*.test.ts)                  | `bun test` output                                     |

---

## 8. Failure Modes Explicitly Tested

| Scenario                                  | Expected behaviour                                                                                                  |
|-------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Daemon process crashes mid-connection     | Socket close detected within 500ms; state → `reconnecting`; reconnect attempts begin                                |
| Network blip (NAT timeout, sleep/wake)    | Heartbeat ack missing for 2 cycles (30s); state → `reconnecting`; reconnect on next backoff tick                    |
| Server-side 401 on upgrade                | State → `offline` with `lastError: "auth_invalid"`; NO reconnect storm (auth doesn't fix itself)                    |
| User puts laptop to sleep mid-operation   | On wake: heartbeat ack missing → reconnect path; no spurious "server down" toast                                    |
| User changes WiFi networks                | Same as sleep/wake: heartbeat detection + reconnect                                                                 |
| ANT server restart (graceful)             | Socket close detected; reconnect on backoff schedule; pending subscriptions re-issued on reconnect                  |
| `ANT_ADMIN_TOKEN` env unset               | First connect attempt 401s; state → `offline` immediately; clear error in stdio: `ANT_ADMIN_TOKEN not set`          |

---

## 9. What B1 Does NOT Cover

- The six JSON-RPC methods (`ant.rooms.list`, `ant.chat.send`, etc.) — that's B2's job. B1 just establishes the transport substrate they ride on.
- Per-process nonces for replay protection — that's C1.
- Audit log writes — that's C2.
- Server-side WebSocket endpoint at `/api/ws/remoteant` — that's a parallel server-side implementation task; spec implied by §3.1 shape. The same ownership question as `/api/bridge/status` applies (see E1-endpoint-impl spec).

---

## 10. Risk Notes

**R1 — Bun WebSocket API maturity**. `Bun.WebSocket` (server-side) is stable; `WebSocket` global on the client side has slight differences from Node's `ws` package. Use the standard `WebSocket` API surface (matches browser); test under both `bun run` and `node dist/cli.js`.

**R2 — Server-side endpoint absence**. As noted in §6 and §9, the server WebSocket endpoint at `/api/ws/remoteant` and the heartbeat endpoint at `/api/bridge/heartbeat` may not exist yet. B1 client implementation can complete and pass tests using mock endpoints in `tests/`; PR description must flag the server-side endpoints as a follow-up substrate task.

**R3 — Reconnect storms across MCP clients**. If 3 MCP clients (antchat-Mac, Claude Desktop, Cursor) all hold open WebSocket connections via the same remoteant binary AND the server restarts, the jitter prevents simultaneous reconnects but doesn't prevent simultaneous heartbeat collisions. Server-side endpoint must handle 3+ concurrent connections from the same identity (likely fine; just noting).

---

## 11. Handoff Sequence

1. **A1 + E2 close** (E2 currently the gating dependency).
2. **@homebrewmaincodex** flips `b1-transport` → active/claimed; preloads B1-G1..G8 as failing gates.
3. **@kimihomebrewwork** implements `packages/remoteant/src/transport/` per §2 + tests per §7. Uses mock endpoints in tests; real server-side endpoints arrive separately.
4. **@homebrewmaincodex** review + accept + flip done.
5. **@homebrewmainclaude** publishes B2 (six methods) spec — already pre-staged.

---

**Spec status when this lands**: ready for plan-state flip once E2 closes.
