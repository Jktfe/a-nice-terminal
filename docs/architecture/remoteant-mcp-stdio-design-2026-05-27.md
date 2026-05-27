# Remoteant MCP Stdio Adapter Design

## Status

Design draft for Bridge C Phase 2. No implementation is approved by this document. JWPK ratifies this design before any prototype code lands.

## Goal

Make `remoteant` the unified local sidecar for ANT clients by adding a `remoteant --mcp-stdio` mode that can replace the current per-client `@jktfe/mcp-server-ant` stdio translators.

The ANT daemon at `:6174` remains the HTTP source of truth. The change is about consolidating local client adapters, identity, lifecycle, and crash recovery around one sidecar binary.

## Current State

The local daemon at `127.0.0.1:6174` is the real bridge. It already serves HTTP APIs and realtime SSE.

`packages/mcp-server-ant` is a small per-MCP-client stdio to HTTP translator. Each MCP client spawns its own process. The package currently exposes three tools:

| Tool | Current HTTP call | Keep? | Remoteant v1 action |
| --- | --- | --- | --- |
| `ant_get_pending_mentions` | `GET /api/me/mentions?since=&wait=` | Yes | Lift unchanged. This remains the blocking long-poll tool. |
| `ant_post_message` | `POST /api/chat-rooms/:roomId/messages` | Yes | Lift unchanged, with the same `parentMessageId` support. |
| `ant_list_rooms` | `GET /api/chat-rooms` | Yes | Lift unchanged, returning `{ id, name, kind: "chat" }`. |

## Proposed `remoteant --mcp-stdio` Surface

`remoteant --mcp-stdio` starts an MCP stdio server and registers a versioned ANT tool set. V1 should keep the existing three tool names so current prompts and MCP clients do not change.

### Required V1 Tools

#### `ant_get_pending_mentions`

Input:

```json
{
  "workspaceId": "optional future routing key",
  "since": 0,
  "waitSeconds": 25
}
```

Output:

```json
{
  "mentions": [
    {
      "messageId": "msg_abc",
      "roomId": "room_123",
      "roomName": "speed matters",
      "authorHandle": "@you",
      "body": "@speedycodex ping",
      "postedAt": "2026-05-27T12:00:00Z",
      "matchedHandle": "@speedycodex"
    }
  ],
  "nextCursor": 1770000000000
}
```

Semantics:

- Clamp `waitSeconds` to `0..60` client-side and rely on the daemon to enforce the same contract server-side.
- The process must not run its own polling loop. The HTTP daemon performs the wait.
- Abort/cancel from MCP transport should abort the HTTP request when the SDK exposes cancellation.

#### `ant_post_message`

Input:

```json
{
  "roomId": "orsz2321qb",
  "body": "message text",
  "parentMessageId": "optional parent message id"
}
```

Output:

```json
{ "messageId": "msg_abc" }
```

Semantics:

- Preserve the existing body shape used by `mcp-server-ant`.
- Surface daemon errors as MCP tool errors with status and truncated response text.
- Do not synthesize success when the daemon rejects auth or validation.

#### `ant_list_rooms`

Input: `{}`

Output:

```json
{
  "rooms": [
    { "id": "orsz2321qb", "name": "speed matters", "kind": "chat" }
  ]
}
```

Semantics:

- Preserve the current tool output.
- Use the daemon's membership filtering; `remoteant` does not implement room authorization itself.

### Future Tool Expansion

V2 tools should be added under the same MCP server after the three-tool compatibility cut is stable:

- `ant_get_room_context` for room summary, members, recent messages, open asks, and tasks.
- `ant_create_task` for agent-created work items.
- `ant_update_task` for task status/assignment.
- `ant_get_artefact_summary` for deck/doc/file summaries.

Do not add these to the first prototype. The value of P3 is proving sidecar lifecycle and compatibility, not expanding the tool surface.

## Identity Flow

V1 keeps the existing daemon identity model:

- `ANT_SERVER_URL` chooses the daemon, defaulting to `http://127.0.0.1:6174`.
- `ANT_DEVICE_TOKEN` remains the optional bearer token for non-shell clients.
- PID-chain identity remains a daemon concern for CLI calls that can provide process ancestry.
- The MCP stdio adapter should not invent a separate MCP-only identity system in v1.

### Recommended Grant Shape

`remoteant --mcp-stdio` should read the same local config/token that `ant identity` writes today. If that lookup is not currently centralized, P3 should extract a shared `remoteantIdentity` helper rather than adding a second grant file.

MCP-specific grant is deferred unless a client cannot pass `ANT_DEVICE_TOKEN` or local config safely. If needed later, add `remoteant mcp grant` as a thin wrapper around the same device-token store, not a new auth table.

## Crash Recovery

Today's `mcp-server-ant` recovery model is per-client respawn:

- MCP client starts one process.
- Stale sibling processes can be reaped.
- If the process dies, that MCP client respawns it according to its MCP config.

`remoteant --mcp-stdio` should preserve that first. Every MCP client can still execute `remoteant --mcp-stdio` as its own child process, which means the host MCP client remains the lifecycle owner for stdio sessions.

The consolidated sidecar model should be phased:

1. **P3 compatibility mode:** `remoteant --mcp-stdio` behaves like `mcp-server-ant` and exits when stdin closes. MCP clients respawn it. This is the safe migration target.
2. **P4 app-supervised mode:** Antchat-Mac owns a long-lived `remoteant` daemon for HTTP/local state. MCP stdio children may either connect to that daemon or run in compatibility mode.
3. **P5 shim mode:** `@jktfe/mcp-server-ant` becomes a tiny wrapper that execs `remoteant --mcp-stdio`, preserving existing user configs.

### Required Process Guards

- Never write logs to stdout in stdio mode. Stdout is MCP protocol.
- Write diagnostics to stderr only.
- Exit cleanly on stdin `end` or `close`.
- Keep sibling reaping optional behind an environment flag or conservative same-parent check. The current mcp-server-ant sibling reaper can be ported, but it must not kill Antchat-owned long-lived remoteant processes.

## Antchat-Mac Lifecycle Assumptions

These assumptions require @homebrewclaude ratification before P3 implementation:

- Antchat-Mac may eventually launch and supervise a long-lived `remoteant` process for local state coherence.
- The app needs predictable log locations, probably under `~/Library/Logs/ANT/remoteant.log`.
- The app needs a readiness check before routing UI calls to local remoteant.
- The app must be able to stop/restart remoteant without killing unrelated MCP stdio children.
- Antchat should treat remoteant as a local dependency, not as content/delivery logic.

## Migration Path

1. Land this design doc.
2. Prototype `remoteant --mcp-stdio` with the three compatibility tools.
3. Configure one MCP client to run `remoteant --mcp-stdio` directly.
4. Verify mention long-poll, room list, and post message against `:6174`.
5. Keep `@jktfe/mcp-server-ant` published but convert it to a wrapper only after direct remoteant usage is proven.

## Non-Goals

- Do not retire the ANT daemon at `:6174`.
- Do not merge dev server `:6176` into this design; that is a separate stable/dev server split.
- Do not add native app UI in this phase.
- Do not expand the MCP tool surface before compatibility is proven.
- Do not create an MCP-only auth database.

## Ratification Questions

1. Should P3 compatibility mode execute one `remoteant --mcp-stdio` process per MCP client, preserving today's respawn behavior? Recommendation: yes.
2. Should `ANT_DEVICE_TOKEN` remain the only MCP-specific auth input in v1? Recommendation: yes.
3. Should `mcp-server-ant` become a wrapper in P5 rather than being deleted? Recommendation: yes.
4. Should Antchat-Mac supervise a long-lived remoteant separately from MCP stdio children? Recommendation: yes, subject to @homebrewclaude lifecycle ratification.
