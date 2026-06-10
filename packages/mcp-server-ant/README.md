# `@jktfe/mcp-server-ant`

A small [Model Context Protocol](https://modelcontextprotocol.io) stdio
server that bridges Claude Desktop / Claude Code (or any MCP client) to
a local **ANT OSS daemon**.

It exposes ten tools:

| Tool | What it does |
| --- | --- |
| `ant_get_pending_mentions` | Long-poll for new mentions of bound handles (default 25s, max 60s). |
| `ant_post_message` | Post a message to an ANT chat room (optionally as a thread reply). |
| `ant_list_rooms` | List the rooms the authenticated caller can see. |
| `ant_get_room` | Read one chat room's metadata by id. |
| `ant_get_room_messages` | Paginated message history for one room (`limit` + `before` cursor). |
| `ant_get_message` | Resolve a message id to its persisted message row. |
| `ant_search_room_messages` | Full-text search within one room, newest-first. |
| `ant_list_agents` | List registered agents, optionally narrowed to one room. |
| `ant_list_plans` | List persisted plans by lifecycle state (`active`/`archived`/`deleted`/`all`). |
| `ant_get_plan` | Read one plan record by id. |

All tools except `ant_post_message` are annotated `readOnlyHint: true`;
nothing in this server deletes or overwrites ANT state.

The pending-mentions tool is the **load-bearing** one — it lets the MCP
client pull bound-handle mentions without busy-looping. The wait is
performed server-side by the ANT daemon, so the MCP server stays idle
while parked on the poll.

## Install

```bash
npx -y @jktfe/mcp-server-ant
```

Or globally:

```bash
npm install -g @jktfe/mcp-server-ant
```

Requires Node.js >= 20.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANT_SERVER_URL` | `http://127.0.0.1:6174` | Base URL of the ANT daemon. |
| `ANT_DEVICE_TOKEN` | _(unset)_ | Optional Bearer token from `ant identity`. If unset, the daemon authenticates via cookies / operator pidChain — only relevant when calling from outside the operator's shell. |

## Claude Desktop config

Add an entry to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ant": {
      "command": "npx",
      "args": ["-y", "@jktfe/mcp-server-ant"],
      "env": {
        "ANT_SERVER_URL": "http://127.0.0.1:6174"
      }
    }
  }
}
```

Restart Claude Desktop and the tools will appear in the Tools menu.

## Claude Code config

```bash
claude mcp add ant npx -y @jktfe/mcp-server-ant
```

Or edit `~/.claude.json` directly with the same shape as the Claude
Desktop config.

## Tool reference

### `ant_get_pending_mentions`

Long-poll for new mentions of bound handles.

```jsonc
{
  // optional — reserved for future multi-workspace routing
  "workspaceId": "ws_main",
  // unix ms cursor; mentions strictly after this are returned
  "since": 0,
  // 0..60; defaults to 25
  "waitSeconds": 25
}
```

Returns:

```jsonc
{
  "mentions": [
    {
      "messageId": "msg_abc",
      "roomId": "r1",
      "roomName": "...",
      "authorHandle": "@you",
      "body": "@james ping",
      "postedAt": "2026-05-20T12:00:00Z",
      "matchedHandle": "@james"
    }
  ],
  "nextCursor": 1716206400000
}
```

### `ant_post_message`

```jsonc
{
  "roomId": "r1",
  "body": "hello world",
  "parentMessageId": "msg_xyz" // optional thread reply
}
```

Returns `{ "messageId": "msg_abc" }`.

### `ant_list_rooms`

No args. Returns `{ "rooms": [{ "id", "name", "kind": "chat" }] }`.

### `ant_get_room`

```jsonc
{ "roomId": "r1" }
```

Returns `{ "room": { ... } }` or a 404 error for unknown ids.

### `ant_get_room_messages`

```jsonc
{
  "roomId": "r1",
  "limit": 100,            // optional, 1..200 (default 100)
  "before": 1024,          // optional cursor: paging.nextBefore from the previous page
  "includePreBreak": false // optional: include history from before the latest context break
}
```

Returns `{ "messages": [...], "paging": { "hasMore", "nextBefore", ... } }`.
Follow `paging.nextBefore` while `paging.hasMore` is true to walk older
history.

### `ant_get_message`

```jsonc
{ "messageId": "msg_abc" }
```

Returns `{ "message": { ... } }`. The room read gate applies, so private
rooms do not leak via message-id lookup.

### `ant_search_room_messages`

```jsonc
{
  "roomId": "r1",
  "query": "release blocker",
  "limit": 50,        // optional, 1..200 (default 50)
  "allContent": false // optional: search before the latest context break too
}
```

Returns `{ "matches": [{ "id", "postedAt", "authorHandle", "body", "postOrder" }], "allContent" }`,
newest-first.

### `ant_list_agents`

```jsonc
{
  "roomId": "r1", // optional: narrow to one room
  "limit": 50,    // optional, 1..200 (default 50)
  "offset": 0     // optional: pass nextOffset from the previous page
}
```

Returns `{ "agents": [...], "total", "nextOffset" }` — `nextOffset` is
`null` on the final page.

### `ant_list_plans`

```jsonc
{
  "state": "active", // optional: active | archived | deleted | all
  "limit": 50,       // optional, 1..200 (default 50)
  "offset": 0        // optional: pass nextOffset from the previous page
}
```

Returns `{ "plans": [...], "total", "nextOffset" }`.

### `ant_get_plan`

```jsonc
{ "planId": "antchat-rv1-2026-06-10" }
```

Returns `{ "plan": { ... } }` or a 404 error for unknown ids.

## Errors

Tool failures come back as MCP `isError` text results carrying the
verbatim HTTP status + response body, plus a next-step hint where one
exists — e.g. a 403 appends *"your token may lack room access — ask the
operator to run `ant mcp grant --room <roomId> --handle <your-handle>`
and set ANT_DEVICE_TOKEN to the minted tokenSecret"*, and a connection
failure points at `ANT_SERVER_URL` / daemon liveness.

## Architecture

The server is a thin HTTP wrapper:

```
Claude Desktop ─stdio─▶ mcp-server-ant ─HTTP─▶ ANT daemon (127.0.0.1:6174)
```

No timers, no background sockets, no in-process retry loops. The long
poll happens entirely server-side on `/api/me/mentions?wait=N` — idle
MCP server == idle resource usage.

## Development

```bash
cd packages/mcp-server-ant
npm install
npm run typecheck
npm run test
npm run build
```

The package is published from the `a-nice-terminal` monorepo at
[`packages/mcp-server-ant`](https://github.com/Jktfe/a-nice-terminal/tree/main/packages/mcp-server-ant).

## License

MIT.
