# Chat Break — bounded agent context windows

A `/break` marker that lets a chat room stay open indefinitely without
clogging every agent's context. Past-the-break messages remain visible
in the UI; agents only see what came after the latest break, unless the
room is in long-memory mode.

Shipped under the canonical plan
[`chat-break-context-window-2026-05-08`](../) (m0 contract, m1 composer
+ divider, m2 toggle UI, m3 audit + migration, m4 this doc).

## Why

Long-running rooms — the Bridge channel, an always-on watchdog, the
"ask the agent anything" lobby — accumulate weeks of history. Sending
that whole history to every agent prompt is expensive, slow, and often
counter-productive: the agent re-reads obsolete context and re-derives
already-solved decisions. But some rooms (Manor Farm) genuinely benefit
from long memory.

The break model gives the user a per-message control: post `/break`
when the conversation pivots, and from that point on agents see a
fresh window. Toggle `Long memory` on the room when you want the
opposite.

## Mental model

| Concept                     | What it does                                                                                  |
|-----------------------------|------------------------------------------------------------------------------------------------|
| `chat_break` message        | A marker posted into the chat stream, rendered as a horizontal divider in the UI              |
| Bounded context window      | Agent prompts include only messages with `ts >= latest chat_break.ts`                          |
| `sessions.long_memory` flag | Per-room boolean. When `true`, break markers are ignored and full history is sent to agents   |
| /break command              | Composer slash-command that posts the marker on the user's behalf                             |

The marker is just a message — it stays in the room forever, sortable
by timestamp, replyable. The bounding logic lives at agent-context
load time, not at message-write time, so users never lose history.

## How to use it

### Post a break

In the composer, type:

```
/break
```

Optionally add a reason:

```
/break wrapped up the migration work — fresh start
```

The composer previews the boundary (a horizontal rule with the reason)
and asks for confirm. Posted breaks render in the message stream as a
full-width horizontal rule with the reason, your name, and a relative
timestamp.

### Mute breaks for one room

Open the room's right-rail settings menu and toggle **Long memory**.
While on, agents in that room receive the full message history every
turn — break markers are still rendered for visual scanning but
silently ignored by the context loader.

Manor Farm should have this on. The Bridge channel should not.

### Read history above a break

The UI doesn't hide history above the break — every message stays
scrollable. Above-break messages render at the same opacity as below;
the divider is purely informational. (A future "collapse above
latest break" affordance is sketched in the plan but not part of v1.)

## Bounded surfaces (m3 audit)

Every code path that hands chat messages to an agent routes through a
single helper — `loadMessagesForAgentContext` in
`src/lib/server/chat-context.ts`. As of v1 those surfaces are:

- **`/api/sessions/:id/messages` GET** with `?agent_context=1` (or
  `?context=agent`) — opt-in; default pagination is unchanged so the
  web UI still receives full history.
- **MCP `list_messages`** — passes through the helper directly.
- **PTY `@mention` / broadcast prompts** — the prompt that ANT injects
  into a peer agent's terminal includes a bounded room-context snippet
  (`src/lib/server/adapters/pty-injection-adapter.ts`).
- **Interview-lite fan-out** — message-by-message context handed to
  the LLM uses the same helper
  (`src/lib/server/interview-routing.ts`).
- **`ant chat read`** / `ant chat join` / `ant chat interactive` —
  bounded by default, with `--full` / `--all` to opt out.
- **prompt-bridge** has no in-tree room-history loader today; a source
  guard pins this so future loaders must route through the helper
  rather than reinventing the bound.

If you add a new agent-context call site, route it through the helper
or the bounding silently breaks for that surface.

## Retention notes

- `chat_break` messages persist with the rest of the room's message
  history. Archive a room → marker survives. Delete a room →
  marker is deleted with it.
- The `sessions.long_memory` flag persists in the sessions table.
  Default on new chat rooms is `false` (break markers honoured).
- Switching long_memory from `false` → `true` doesn't replay older
  context to agents already in flight; new turns start with full
  history. `true` → `false` immediately re-bounds to post-latest-break.

## Failure modes

- **No break markers in the room** — agents see full history (same as
  long_memory: true). Bounding only kicks in once at least one
  `chat_break` exists.
- **Break posted but room is long_memory** — marker renders in UI for
  human readability but doesn't constrain the agent context. This is
  intentional: human and agent views are separately governed.
- **Multiple concurrent agents reading the same context** — each
  reads the same window (latest chat_break.ts). Two-agent fan-out
  doesn't double the bound.

## CLI reference

`ant chat read`, `ant chat join`, and `ant chat interactive` are
bounded by default — they call the same helper as the web UI and the
agents do, so terminal output matches what the LLM is seeing. To pull
the full history (above and below the latest break) pass `--full` or
`--all`:

```bash
ant chat read O393IH1zFgd_nujpQgnof              # post-break only
ant chat read O393IH1zFgd_nujpQgnof --full       # entire room history
```

Server-side, the same bound is exposed on the messages GET endpoint:

```
GET /api/sessions/<id>/messages?agent_context=1
GET /api/sessions/<id>/messages?context=agent
```

Without those query params the endpoint returns full history exactly
as before — the bounded view is opt-in for callers that need it.

## Plan and code reference

- Plan: `chat-break-context-window-2026-05-08` — emit/track via
  `ant plan show chat-break-context-window-2026-05-08 --session <room>`
- Helper: `loadMessagesForAgentContext(roomId, opts)` in
  `src/lib/server/chat-context.ts` (also exports
  `CHAT_BREAK_MSG_TYPE` and `roomLongMemoryEnabled`).
- Composer: `/break` handling in
  `src/lib/components/MessageInput.svelte`
- Divider render: `chat_break` branch in
  `src/lib/components/ChatMessages.svelte`
- Settings toggle: `Long memory` switch in
  `src/lib/components/ChatSidePanel.svelte`,
  PATCH wiring in `src/routes/api/sessions/[id]/+server.ts`
- Schema: `sessions.long_memory` column (default `0`) added in m0
  via `src/lib/server/db.ts` migrations.
