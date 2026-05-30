# B2 — remoteant Six JSON-RPC Methods

**Status**: PRE-STAGED (activates after B1 closes)
**Plan**: `remoteant-mac-delivery-2026-05-29`
**Milestone**: `b2-methods` (currently `[planned]`)
**Lead**: @homebrewmainclaude
**Plan momentum**: @homebrewmaincodex
**Implementer**: @kimihomebrewwork
**Source files**: `packages/remoteant/src/methods/*` (new dir), wired into `methods.ts` registry from A1

---

## 1. B2 Goal

Ship the six baseline JSON-RPC methods specified in E1 §4.1 so MCP clients (antchat-Mac, Claude Desktop, Cursor) can actually DO things via remoteant: list rooms, get a room, send a message, read history, show a plan, get status. Each method is a thin stdio↔HTTP translator against the ANT daemon at `:6174`.

The plan's B2 acceptance: *"Each method returns per the locked contract in the E1 spec; six error codes mapped"*. After B2, the mcp-stdio surface from JWPK's perspective is "I can chat through Claude Desktop and it actually posts to ANT".

---

## 2. The Six Methods (E1 §4.1)

| MCP method            | HTTP target                              | Params required                          | Result shape                                            |
|-----------------------|------------------------------------------|------------------------------------------|---------------------------------------------------------|
| `ant.rooms.list`      | `GET /api/chat-rooms?archived=…&limit=…` | `{ archived?: bool, limit?: number }`    | `{ rooms: Array<{ id, title, memberCount, lastMessageAtMs }> }` |
| `ant.rooms.get`       | `GET /api/chat-rooms/[roomId]`           | `{ roomId: string }` (REQUIRED)          | `{ room: { id, title, memberCount, members: Array<{ handle, name }> } }` |
| `ant.chat.send`       | `POST /api/chat-rooms/[roomId]/messages` | `{ roomId, body, kind?: "human"|"agent" }` (roomId+body REQUIRED) | `{ messageId, ts }` |
| `ant.chat.history`    | `GET /api/chat-rooms/[roomId]/messages?since=…&limit=…` | `{ roomId, since?: messageId, limit?: number }` | `{ messages: Array<{ id, handle, body, ts, replyTo }> }` |
| `ant.plans.show`      | `GET /api/plans/[planId]`                | `{ planId: string }` (REQUIRED)          | `{ plan: { id, sections, milestones, decisions, acceptance } }` |
| `ant.status`          | `GET /api/status`                        | `{}`                                     | `{ daemonReachable, serverVersion, dbReachable, uptimeSeconds }` |

(Note: the plan substrate phrased "six JSON-RPC methods" — `ant.ping` from A1 is the seventh internal one; not counted here. Total surface after B2: 7 methods + `tools/list` + `initialize`.)

---

## 3. File Paths

```
packages/remoteant/src/methods/
├── index.ts              # Export all methods; register with methods.ts registry from A1
├── rooms-list.ts         # ant.rooms.list handler
├── rooms-get.ts          # ant.rooms.get handler
├── chat-send.ts          # ant.chat.send handler
├── chat-history.ts       # ant.chat.history handler
├── plans-show.ts         # ant.plans.show handler
├── status.ts             # ant.status handler
├── http-client.ts        # Shared HTTP client with auth header + error mapping
└── validation.ts         # JSON Schema-style param validators (each method has its own)

packages/remoteant/tests/methods/
├── rooms-list.test.ts
├── rooms-get.test.ts
├── chat-send.test.ts
├── chat-history.test.ts
├── plans-show.test.ts
├── status.test.ts
├── http-client.test.ts   # auth header, 401/403/429 mapping
└── validation.test.ts    # missing required params → -32602
```

Each `.test.ts` file mocks the daemon HTTP endpoint and asserts the full request/response cycle through the JSON-RPC dispatcher.

---

## 4. Common Patterns (http-client.ts)

```ts
import type { Env } from "../env";

export class HttpError extends Error {
  constructor(public statusCode: number, public body: string) {
    super(`HTTP ${statusCode}: ${body}`);
  }
}

export async function antApiFetch<T>(
  path: string,
  init: RequestInit & { env: Env }
): Promise<T> {
  const url = `${init.env.serverUrl}${path}`;
  const headers = new Headers(init.headers);
  if (init.env.adminToken) {
    headers.set("Authorization", `Bearer ${init.env.adminToken}`);
  }
  if (init.env.asHandle) {
    headers.set("X-Ant-As-Handle", init.env.asHandle);
  }
  headers.set("Content-Type", "application/json");

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text());
  }
  return response.json() as Promise<T>;
}
```

Error mapping (in `methods/index.ts` dispatcher wrapper):

| HTTP status / case                | JSON-RPC error                                                |
|-----------------------------------|---------------------------------------------------------------|
| 401 / 403                         | `code: -32002`, message: "auth failure" (E1 §4.4)            |
| 429                               | `code: -32003`, message: "rate-limited"                       |
| 404                               | `code: -32602`, message: "resource not found"                 |
| ECONNREFUSED / network            | `code: -32001`, message: "daemon unreachable"                 |
| 5xx                               | `code: -32603`, message: "internal error", `data: { upstream }` |
| Validation failure (params)       | `code: -32602`, message: "invalid params: <details>"          |

---

## 5. Validation (per method)

Each method has a strict params validator. Examples:

```ts
// ant.rooms.get validator
export function validateRoomsGetParams(params: unknown): { roomId: string } {
  if (typeof params !== "object" || params === null) {
    throw new InvalidParamsError("params must be an object");
  }
  const { roomId } = params as { roomId?: unknown };
  if (typeof roomId !== "string" || roomId.length === 0) {
    throw new InvalidParamsError("roomId is required (non-empty string)");
  }
  return { roomId };
}
```

`InvalidParamsError` maps to `-32602` per the dispatcher wrapper. The tests in `tests/methods/validation.test.ts` assert that every method REJECTS missing/wrong-typed params with `-32602`.

(This satisfies the deferred `-32602` test from A1 — at B2, params-required methods exist, so the error code branch finally has a testable surface.)

---

## 6. Acceptance Gates (B2-G1..G8)

| Gate    | Verification                                                                                                       | Evidence                                       |
|---------|--------------------------------------------------------------------------------------------------------------------|------------------------------------------------|
| B2-G1   | `ant.rooms.list` round-trip against real local daemon returns at least one room (e.g. g6s4bwanvh)                  | manual stdio capture                           |
| B2-G2   | `ant.rooms.get { roomId: "g6s4bwanvh" }` returns room with `members` populated                                      | manual stdio capture                           |
| B2-G3   | `ant.chat.send { roomId, body: "B2 smoke test" }` writes a message visible in the room                              | room message id returned matches `ant rooms messages` capture |
| B2-G4   | `ant.chat.history { roomId, limit: 5 }` returns 5 most recent messages                                              | manual stdio capture                           |
| B2-G5   | `ant.plans.show { planId: "remoteant-mac-delivery-2026-05-29" }` returns plan with milestones                       | manual stdio capture                           |
| B2-G6   | `ant.status` returns `daemonReachable: true` and a `serverVersion` semver string                                    | manual stdio capture                           |
| B2-G7   | Each method REJECTS missing required params with JSON-RPC error code `-32602` and a descriptive message             | vitest assertions                              |
| B2-G8   | All tests pass: `bun test` final tally ≥ 29 (21 from B1 + 8+ new from methods/*.test.ts)                            | `bun test` output                              |

---

## 7. Cross-Spec Hooks

**Plan acceptance language**: *"Adapter passes end-to-end smoke: tool list, request, response, error, and reconnect path."* B2-G1 through B2-G6 cover "request, response"; B2-G7 covers "error"; the reconnect path was covered in B1-G3.

**tools/list update**: After B2 lands, remoteant's `tools/list` response (from A1) must enumerate the six new methods alongside `ant.ping`. Update `mcp-stdio/initialize.ts` (or wherever tools/list lives) to include the new tool definitions with proper inputSchema. This is a 6-entry addition; not chunky.

---

## 8. Out of Scope for B2

- Auth nonces (per-process monotonic) — that's C1.
- Audit log writes — that's C2.
- Streaming responses for large history queries — V2.
- Pagination beyond simple `since`+`limit` — V2.
- The mutating endpoints beyond `chat.send` (tag apply, plan mutation, etc.) — V2 / separate milestones.

---

## 9. Risk Notes

**R1 — Auth header collisions**. `X-Ant-As-Handle` is the spec's preferred way to mint session cookies for user-context endpoints (per E1 §5.3). Some daemon endpoints may not honor it yet — that's a daemon-side concern, not B2's. Document as known limitation per-method if discovered during testing.

**R2 — Schema drift between daemon and methods**. The daemon's response shapes may have drifted from the E1 spec since 2026-05-28. B2 implementation should `curl` each endpoint against the local daemon FIRST and verify the shape matches §2; if any shape has changed, file a follow-up to align (don't silently adapt — surface the drift).

**R3 — Long-running history queries**. `ant.chat.history` against a high-traffic room could return MB of data. Default `limit` to 50 (matches existing room UI default); cap max `limit` at 500 server-side anyway. Don't stream in V2; just bounded paging.

---

## 10. Handoff Sequence

1. B1 closes.
2. @homebrewmaincodex flips `b2-methods` → active/claimed; preloads B2-G1..G8.
3. @kimihomebrewwork implements `packages/remoteant/src/methods/` per §3 + tests per §6. Curl the daemon first per R2 to verify shapes.
4. @homebrewmaincodex review + accept + flip done.
5. @homebrewmainclaude publishes C1 (auth nonces) + C2 (audit log) specs in parallel.

---

**Spec status when this lands**: ready for plan-state flip once B1 closes. After B2 ships, "fully wired" is one D1 (build+sign+notarize) away from JWPK being able to install and use the app.
