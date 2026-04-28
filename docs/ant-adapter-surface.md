# ANT Adapter Surface

Consumer-facing contract for systems that read ANT as an operational graph.
This document is audited from the ANT source tree, not from chat memory.

Last audited: 2026-04-28

## Purpose

ANT owns operational facts: sessions, chat rooms, terminal state, routing,
messages, raw evidence, prompts, read receipts, room links, task/file-reference
state, health, and process lifecycle.

Consumers should build semantic layers on top of ANT rather than copying this
infrastructure. For example, mymatedave v2 should persist goals, success
criteria, assignments, outcome grades, and evidence references, but should read
live room/session/evidence state from ANT when making decisions.

## Contract Notes

- Base URL is the running ANT server, for example
  `https://mac.kingfisher-interval.ts.net:6458`.
- External API callers should send `Authorization: Bearer <ANT_API_KEY>`,
  `X-API-Key: <ANT_API_KEY>`, or `?apiKey=<ANT_API_KEY>` when `ANT_API_KEY`
  is configured. Same-origin browser calls are exempt.
- External WebSocket callers connect to `/ws` and use the same API key rules.
- Most responses are raw database rows plus derived fields. Fields may be
  `null` when not applicable or when old rows pre-date a migration.
- Stable identifiers are string IDs for sessions, messages, room links, tasks,
  file refs, and handles. Terminal transcript/event/run-event IDs are integer
  row IDs and should be treated as evidence cursors, not semantic IDs.
- `meta`, `settings`, and some `payload` fields are JSON stored as text in the
  database. Some endpoints parse them, others return the raw string.

## Boundary

| ANT Owns | Consumer Owns |
|---|---|
| Session, room, terminal, participant, and route state | Project and domain context |
| Message persistence, routing, read receipts, delivery attempts | Intent interpretation and response policy |
| Terminal transcripts, run events, command events, hooks | Evidence selection and confidence |
| Prompt detection, approval transport, PTY injection | Approval policy and judgement |
| Watchdog health, resource samples, stall signals | Scheduling/escalation decisions |
| Room links and task/file-reference primitives | Meaning of rooms, tasks, and files |

## Core IDs

| ID | Source | Notes |
|---|---|---|
| `session.id` | `sessions` table | Primary ID for terminal, chat, and agent sessions. Terminal tmux session names also use this ID. |
| `session.handle` | `sessions.handle` | Global handle such as `@antcodex`; unique among active sessions. |
| `chat_room_members.alias` | `chat_room_members.alias` | Per-room alias used before falling back to global handle for routing. |
| `message.id` | `messages` table | Stable message ID for replies, read receipts, prompt cards, and evidence references. |
| `room_links.id` | `room_links` table | Stable room relationship ID. |
| `task.id` | `tasks` table | Stable room task ID. |
| `file_refs.id` | `file_refs` table | Stable file-reference ID. |
| `run_events.id` | `run_events` table | Evidence cursor; monotonically increasing database row ID. |
| `terminal_events.id` | `terminal_events` table | Evidence cursor for tmux control-mode events. |
| `terminal_transcripts.id` | `terminal_transcripts` table | Evidence cursor for raw terminal chunks. |

## Sessions

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/sessions` | No | none | `{ sessions, recoverable }` | List active and recoverable sessions. | `sessions` excludes archived and soft-deleted rows. |
| `POST /api/sessions` | Yes | `{ name, type, ttl?, workspace_id?, root_dir?, meta? }` | Session row, status `201` | Create terminal/chat/agent session. | `type === "terminal"` also creates an auto-linked chat, sets `linked_chat_id`, and assigns handles. Duplicate normalized names return `409`. |
| `GET /api/sessions/:id` | No | none | Session row | Resolve room/session identity by ID. | Throws `404` for missing session. |
| `PATCH /api/sessions/:id` | Yes | `{ name?, ttl?, status?, archived?, meta?, linked_chat_id? }` | Updated session row | Rename, archive, update metadata, relink terminal. | Archiving a terminal kills its PTY after summary capture. Renaming an auto-linked terminal renames the linked chat too. |
| `DELETE /api/sessions/:id` | Yes | `?hard=true` optional | `204` | Soft-delete or permanently delete session. | Soft delete preserves recoverability. Hard delete cascades auto-linked terminal/chat pairs and kills terminal PTYs. |
| `POST /api/sessions/:id/restore` | Yes | none | Restored session row | Restore archived/soft-deleted sessions. | Soft-deleted rows respect TTL recovery window; expired rows return `410`. |
| `PATCH /api/sessions/:id/handle` | Yes | `{ handle, display_name? }` | `{ handle, display_name }` | Set public identity. | Handles are normalized to `@handle` and checked for uniqueness. |
| `PATCH /api/sessions/:id/cli-flag` | Yes | `{ cli_flag }` | `{ id, cli_flag }` | Set the agent driver used by event detection and line stripping. | Invalid driver slug returns `400`; terminal sessions also notify the PTY daemon. |

Session row fields include:

```ts
{
  id: string;
  name: string;
  type: "terminal" | "chat" | "agent";
  workspace_id: string | null;
  root_dir: string | null;
  status: string;
  archived: 0 | 1;
  ttl: string;
  deleted_at: string | null;
  last_activity: string | null;
  meta: string;
  created_at: string;
  updated_at: string;
  handle?: string | null;
  display_name?: string | null;
  cli_flag?: string | null;
  alias?: string | null;
  tmux_id?: string | null;
  kill_timer?: string | null;
  is_aon?: 0 | 1;
  linked_chat_id?: string | null;
  auto_forward_chat?: 0 | 1;
}
```

## Messages and Routing

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/sessions/:id/messages` | No | `?limit=50`, optional `?since=<created_at>`, optional `?before=<created_at>` | `{ messages }` | Read room history or poll by cursor. | Without `since` or `before`, code returns all messages for the session, not just `limit`. `before` returns older rows in ascending order. |
| `POST /api/sessions/:id/messages` | Yes | `{ role, content, format?, sender_id?, target?, reply_to?, msg_type?, meta? }` | Message row plus `{ deliveries }`, status `201` | Send chat messages and trigger routing. | Message is persisted before routing. `deliveries` reports the current route attempt only. |
| `PATCH /api/sessions/:id/messages?msgId=...` | Yes | `{ meta }` | `{ msgId, meta }` | Merge message metadata such as reactions/status. | For `agent_event` messages, setting `meta.status` to `discarded` or `dismissed` also discards pending event state. |
| `DELETE /api/sessions/:id/messages?msgId=...` | Yes | none | `{ ok: true }` | Delete a message. | No tombstone is returned. |
| `PATCH /api/sessions/:id/messages/:msg_id/pin` | Yes | `{ pinned: boolean }` | `{ msgId, pinned }` | Pin/unpin important messages. | Returns `404` if the message is not in that session. |
| `GET /api/sessions/:id/messages/search` | No | `?q=<fts>&limit=50` | `{ results }` or `{ results: [], error }` | Search a room's messages. | Uses SQLite FTS; invalid query returns `400`. |
| `GET /api/search` | No | `?q=<fts>&limit=50` | `{ results }` | Search all messages. | Uses SQLite FTS; invalid query returns `400`. |

Message row fields include:

```ts
{
  id: string;
  session_id: string;
  role: string;
  content: string;
  format: string;
  status: string;
  sender_id: string | null;
  target: string | null;
  reply_to: string | null;
  msg_type: string;
  meta: string;
  created_at: string;
  pinned?: 0 | 1;
}
```

Routing behaviour confirmed from `message-router.ts`:

- WebSocket clients joined to the room always receive `message_created`.
- System message types do not fan out to terminals:
  `prompt`, `silence`, `title`, `agent_response`, `agent_event`,
  `terminal_line`.
- In a private linked chat, messages fan out to linked terminal sessions unless
  loop-prevention skips the sender. `auto_forward_chat = 1` writes raw user
  input to the terminal; otherwise the terminal receives a notification block.
- In standalone chatrooms, fan-out is scoped to `chat_room_members`.
- Human messages with no valid mention fan out to all participant terminals.
- Terminal-originated messages with no mention fan out only to idle/ready
  terminals; busy/thinking agents are protected unless `@everyone` is used.
- A terminal-originated invalid `@mention` stays visible in chat only and does
  not wake every participant.
- Bracketed mentions such as `[@agent]` are suppressed from delivery.
- Delivery attempts are logged internally in `delivery_log`, but no read API
  currently exposes that table.

## Participants and Presence

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/sessions/:id/participants` | No | none | `{ participants, postsFrom, all }` | Query room members and message-derived participants. | If no `chat_room_members` rows exist, falls back to message-derived participants only. |
| `POST /api/sessions/:id/participants` | Yes | `{ session_id? | handle?, role?, alias? }` | Added participant object, status `201` | Add a terminal/agent/chat identity to a chat room. | Session must exist; room must be a chat. `role` is `participant` or `external`. |
| `DELETE /api/sessions/:id/participants` | Yes | query or body `{ session_id? | handle? }` | `{ ok, removed, id }` | Mark a participant as left. | It updates role to `left`; it does not delete the membership row. |
| `GET /api/presence/:sessionId` | No | none | `{ presence: { [handle]: { lastSeen, status } } }` | Query active/idle/offline clients for a room/session. | Presence exists only for WebSocket clients that joined the session and have a handle. |
| `POST /api/sessions/:id/typing` | Yes | `{ handle, typing }` | `{ ok: true }` | Broadcast typing state. | Broadcast-only; no durable typing state. |
| `GET /api/sessions/:id/reads` | No | none | `{ reads: { [message_id]: ReadReceipt[] } }` | Read receipts for all messages in a room. | Based on explicit read marking or automatic terminal delivery read marks. |
| `POST /api/sessions/:id/messages/:msgId/read` | Yes | `{ reader_id }` | `{ ok, reads }` | Mark message read. | `reader_id` is a session ID. |
| `GET /api/sessions/:id/messages/:msgId/read` | No | none | `{ reads }` | Read receipts for one message. | Reader names/handles are derived from sessions where possible. |

Participant object shape from `chat_room_members` path:

```ts
{
  id: string;              // member session id
  name: string;
  handle: string | null;
  alias: string | null;
  session_type?: string;
  session_status?: string | null;
  cli_flag?: string | null;
  role: "participant" | "external" | string;
  joined_at: string;
  first_seen?: string;
  last_seen?: string;
  message_count: number;
}
```

## Room Links

Room links are typed relationships between chat sessions. They are generic:
discussion rooms, summary rooms, follow-ups, and promoted decision rooms are all
normal chat sessions connected by `room_links`.

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/sessions/:id/links` | No | none | `{ outgoing, incoming }` | Read room topology. | Outgoing rows include `target_name/target_type`; incoming rows include `source_name/source_type`. |
| `POST /api/sessions/:id/links` with `targetRoomId` | Yes | `{ targetRoomId, relationship?, title?, createdBy?, inheritContext?, settings? }` | `{ id, sourceRoomId, targetRoomId, relationship }` | Link an existing room. | Source and target must be chats. Duplicate source/target/relationship returns `409`. |
| `POST /api/sessions/:id/links` without `targetRoomId` | Yes | `{ title?, relationship?, createdBy?, copyMembers?, settings? }` | `{ id, sourceRoomId, targetRoomId, discussionName, relationship, membersCopied }`, status `201` | Create a new linked discussion room. | New room is `type: "chat"`, `ttl: "forever"`, and `meta.parent_room` points to source. Members are copied unless `copyMembers === false`. |
| `DELETE /api/sessions/:id/links?linkId=...` | Yes | none | `{ ok: true }` | Remove a room relationship. | Only deletes links whose `source_room_id` is `:id`. |

Valid relationships in code:

- `discussion_of`
- `promoted_summary_for`
- `spawned_from`
- `follows_up`

Link settings are JSON text. Current creation defaults include
`{ "inherit_parent_context": true }` for new discussions and
`{ "inherit_parent_context": body.inheritContext !== false }` for existing
room links.

## Agent Status, Prompts, and Approvals

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/sessions/:id/status` | No | none | Status object plus `session`, `terminal`, `linked_chat`, `route`, `capture` | Read current needs-input and agent status for a terminal or linked chat. | Chat IDs are resolved to their owning terminal where possible. Status is in-memory and refreshed from pane capture if stale. |
| `POST /api/sessions/:linkedChatId/messages` with `msg_type: "agent_response"` | Yes | `content` is JSON `{ type, choice?, event_id?, event_content?, terminal_session_id?, justification?, source? }` | Synthetic handled message with delivery result | Approve/deny/respond to an agent event card. | Calls the configured driver and injects keystrokes into the terminal. It does not persist the `agent_response` message row in the normal path. |
| `GET /api/sessions/:id/prompt-bridge/pending` | No | none | `{ pending }` | Read generic prompt bridge pending event. | Separate from driver-specific `agent_event` cards. |
| `POST /api/sessions/:id/prompt-bridge/respond` | Yes | `{ text? | response?, enter? }` | `{ ok, prompt }` | Inject a raw text response into a terminal prompt. | Writes text and sends Enter unless `enter === false`. |
| `GET /api/prompt-bridge/config` | No | none | `{ config }` | Read generic prompt bridge configuration. | Stored in settings table. |
| `PUT /api/prompt-bridge/config` | Yes | config object or `{ config }` | `{ config }` | Enable/configure generic detect-route-inject prompt bridge. | Target types are `linked_chat`, `chat`, and `webhook`. Bad patterns are ignored at detection time. |
| `POST /api/hooks` | Yes | Hook JSON with `event` or `hook_event_name`, optional `ant_session_id`, `agent` | `{ ok, event }` plus event-specific fields | Ingest agent hook events into linked chat/run-events. | Claude/Gemini-specific behaviour exists; events are normalized to run-events and sometimes messages/tasks. |

`GET /api/sessions/:id/status` response fields include:

```ts
{
  needs_input: boolean;
  event_id?: string;       // message id for pending agent_event
  event_chat_id?: string;  // linked chat id containing the event
  event_class?: string;
  event?: object;
  summary?: string;
  since?: string;
  agent_status?: object;
  session: PublicSession | null;
  terminal: PublicSession | null;
  linked_chat: PublicSession | null;
  route: {
    mode: "private_terminal_input" | "terminal" | "chatroom" | "unknown";
    terminal_id: string | null;
    linked_chat_id: string | null;
    executes_in_terminal: boolean;
  };
  capture: {
    status_source: "driver_status_line" | "none";
    interactive_source: "agent_event_bus" | "none";
    detected_at: number | null;
  };
}
```

Important approval boundary:

- ANT transports prompt events and responses.
- Agent drivers decide keystroke mappings for `approve`, `deny`, `confirm`,
  `select`, `text`, `retry`, and `abort`.
- Consumers decide policy and justification; ANT records/injects the decision.

## Evidence Surfaces

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/sessions/:id/run-events` | No | `?since=<iso|ms|5m>`, `?source=hook|json|terminal|status|tmux`, `?kind=...`, `?q=...`, `?limit=200` | `{ session_id, terminal_id, since_ms, limit, count, events }` | Read interpreted evidence timeline. | If `:id` is a linked chat, resolves to owning terminal when possible. Default window is last hour. Limit max is `1000`. |
| `GET /api/sessions/:id/terminal/history` | No | `?since=<iso|ms|5m>`, `?grep=<fts>`, `?raw=1`, `?limit=100` | Range or search result | Read terminal transcript chunks. | `grep` mode ignores `since` and `raw`. Default range strips ANSI; `raw=1` returns raw bytes as string. |
| `GET /api/sessions/:id/terminal/events` | No | `?since=<iso|ms|5m>`, `?kind=...`, `?limit=100` | `{ session_id, since_ms, kind, limit, count, rows }` | Read tmux control-mode events. | Default window is last hour; limit max is `1000`. |
| `GET /api/sessions/:id/commands` | No | `?limit=100` | Array of command events | Read recorded command execution events. | Command ingestion depends on shell hooks/collectors; not every terminal command is guaranteed to appear. |
| `POST /api/sessions/:id/export` | Yes | none | `{ ok: true }` | Write session summary to capture/Obsidian pipeline. | Side-effectful local export; consumers should treat generated file paths as external evidence. |
| `GET /api/sessions/:id/digest` | No | none | `{ messageCount, participantCount, durationMinutes, messagesPerHour, participants, keyTerms, firstMessage, lastMessage }` | Lightweight room digest. | Extractive heuristic only; not an LLM summary. |

Run event object shape:

```ts
{
  id: number;
  session_id: string;
  ts: number;
  ts_ms: number;
  source: "hook" | "json" | "terminal" | "status" | "tmux";
  trust: "high" | "medium" | "raw";
  kind: string;
  text: string;
  payload: object;
  raw_ref: string | null;
  created_at: string;
}
```

## Tasks and File References

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/sessions/:id/tasks` | No | none | `{ tasks }` | Read room task state. | Tasks are room-scoped operational records. |
| `POST /api/sessions/:id/tasks` | Yes | `{ title, description?, created_by? }` | `{ task }`, status `201` | Create task. | `created_by` is validated against session/handle when possible, otherwise set to `cli`. |
| `PATCH /api/sessions/:id/tasks/:taskId` | Yes | `{ status?, assigned_to?, description?, file_refs? }` | `{ task }` | Update task state. | `file_refs` is JSON-stringified into the task row. |
| `DELETE /api/sessions/:id/tasks/:taskId` | Yes | none | `{ ok: true }` | Mark task deleted. | Soft delete only: status becomes `deleted`. |
| `GET /api/sessions/:id/file-refs` | No | none | `{ refs }` | Read flagged file references. | Room-scoped. |
| `POST /api/sessions/:id/file-refs` | Yes | `{ file_path, note?, flagged_by? }` | `{ ref }`, status `201` | Add file reference. | Requires `file_path`. |
| `DELETE /api/sessions/:id/file-refs?refId=...` | Yes | none | `{ ok: true }` | Delete file reference. | Hard delete of the file ref row. |

## Health and Lifecycle

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `GET /api/health` | No | none | `{ status, version, resources }` | Read resource pressure, active session count, cap, stalls. | Watchdog samples every 15s and is advisory only; it never kills sessions. |
| `GET /api/sessions` | No | none | `recoverable` list included | Read archived/soft-deleted sessions. | Restore uses `/restore`; hard delete is irreversible. |

Health resource shape:

```ts
{
  totalCpuPct: number;
  totalRssMb: number;
  activeSessionCount: number;
  maxActiveSessions: number; // 0 means unlimited
  atCap: boolean;
  canSpawn: boolean;
  stalledSessions: string[];
  sessions: Array<{ sessionId: string; pid: number; cpuPct: number; rssMb: number }>;
  sampledAt: string | null;
}
```

Lifecycle caveats:

- `ANT_MAX_ACTIVE_AGENTS` controls an advisory active-session cap.
- TTL/AON/`kill_timer` fields exist on sessions and are enforced by the
  server-side lifecycle sweep, but there is no dedicated public schedule API.
- Archiving terminal sessions kills their PTY after summary capture.

## Terminal Control

| Surface | Mutates? | Request | Response Shape | Consumer Use | Caveats |
|---|---:|---|---|---|---|
| `POST /api/sessions/:id/terminal/input` | Yes | `{ data }` | `{ ok: true }` | Write raw bytes to a terminal PTY. | Requires non-empty string. This is a low-level control surface. |
| WebSocket `/ws` `join_session` | Conditional | `{ type: "join_session", sessionId, spawnPty?, cols?, rows?, cwd? }` | `session_health`, optional `terminal_output` | Attach to a session; optionally spawn PTY. | `spawnPty: true` only spawns for terminal sessions. |
| WebSocket `/ws` `terminal_input` | Yes | `{ type: "terminal_input", sessionId, data }` | none | Write terminal input. | Same live path used by the browser terminal. |
| WebSocket `/ws` `terminal_resize` | Yes | `{ type: "terminal_resize", sessionId, cols, rows }` | none | Resize terminal. | Consumer must know terminal dimensions. |
| WebSocket `/ws` `check_health` | No | `{ type: "check_health", sessionId }` | `session_health` | Check PTY alive state. | PTY health, not semantic agent status. |

WebSocket events observed from server/routes include:

- `build_id`
- `session_health`
- `terminal_output`
- `message_created`
- `message_updated`
- `message_deleted`
- `message_read`
- `message_pinned`
- `task_created`, `task_updated`, `task_deleted`
- `file_ref_created`, `file_ref_deleted`
- `room_link_created`, `room_link_deleted`
- `typing`
- `agent_status_updated`
- `session_needs_input`
- `session_input_resolved`
- `session_stall_detected`
- `prompt_detected`
- `prompt_bridge_resolved`
- `sessions_changed`

## CLI Surface

CLI commands are a UX layer over REST/WS. Consumers that need stable contracts
should prefer REST/WS and treat CLI output as operator convenience unless using
`--json`.

| CLI | Backing Surface | Notes |
|---|---|---|
| `ant sessions` | `GET /api/sessions` | Lists active sessions; `--json` emits raw response. |
| `ant sessions create --name <name> --type <terminal|chat>` | `POST /api/sessions` | CLI only sends `name` and `type`. |
| `ant sessions archive <id>` | `PATCH /api/sessions/:id` | Sends `{ archived: true }`. |
| `ant sessions delete <id>` | `DELETE /api/sessions/:id` | Soft delete by default. |
| `ant sessions export <id>` | `POST /api/sessions/:id/export` | Obsidian/capture side effect. |
| `ant chat send <id> --msg "..."` | `POST /api/sessions/:id/messages` | Sender identity auto-resolves from ANT tmux session, `ANT_SESSION_ID`, config handle, or external mode. |
| `ant chat read <id> --limit N` | `GET /api/sessions/:id/messages?limit=N` | Does not expose `since`/`before`. |
| `ant chat join <id>` | `GET messages` plus `/ws` | Joins real-time stream and sends `presence_ping`. |
| `ant chat leave <id>` | `DELETE /api/sessions/:id/participants` | Resolves identity from session/handle. |
| `ant chat pending <id>` | `GET /api/sessions/:id/status` | Human-readable pending prompt summary. |
| `ant chat decide <id> approve|deny|yes|no|retry|abort|text|select` | `GET status` + `POST agent_response` | Sends decision with optional justification. |
| `ant msg <room-id> [@handle] "message"` | `POST /api/sessions/:id/messages` | Targeted or broadcast delivery. |
| `ant terminal <id>` | `/ws` | Interactive terminal attach; sends `spawnPty: true`. |
| `ant terminal send <id> --cmd "..."` | `/ws` | Spawns if needed, writes command plus carriage return. |
| `ant terminal key <id> <key>` | `/ws` | Sends special key sequence. |
| `ant terminal history <id>` | `GET /terminal/history` | Supports `--json`, `--since`, `--grep`, `--raw`, `--limit`. |
| `ant terminal events <id>` | `GET /terminal/events` | Supports `--json`, `--since`, `--kind`, `--limit`. |
| `ant task <id> ...` | Tasks API | Create/list/assign/review/done/delete. |
| `ant prompt config|pending|respond` | Prompt bridge API | Configure generic prompt bridge and inject raw responses. |

CLI discoverability gaps:

- There is no obvious `ant chat participants` command even though the API
  exists.
- `ant chat read` does not expose cursor-style `since`/`before`.
- There is no CLI for read receipts/presence/delivery log.
- Delivery attempts are returned from message POSTs, but historical delivery
  attempts are not exposed by CLI or REST.

## Scheduling and Recurrence

Confirmed from code:

- ANT has TTL/AON/`kill_timer` lifecycle fields on sessions.
- ANT has a watchdog timer for resource sampling and stall detection.
- ANT has no public scheduled task, recurrence, cron, or timed-resume API in
  `src/routes/api` or `cli/commands` as of this audit.

Consumer rule:

- Consumers may read lifecycle/resource facts from ANT.
- Consumers should not assume ANT can schedule recurring semantic workflows.
- If Dave v2 or another consumer needs recurring workflows, the gap should be
  addressed by a deliberate ANT scheduler surface or an external scheduler that
  records ANT references.

## Consumer Checklist

ManorFarm's five consumer questions, answered from code:

| Question | Answer | Surface |
|---|---|---|
| Can I query who is in a room? | Yes. | `GET /api/sessions/:id/participants` |
| Can I read history when joining mid-conversation? | Yes. | `GET /api/sessions/:id/messages?limit=N`, with optional `since`/`before` |
| Can I confirm delivery to specific participants? | Partial. | POST message response includes current `deliveries`; `delivery_log` exists internally, but there is no public read API. |
| Can I resolve room name/metadata from ID? | Yes. | `GET /api/sessions/:id` |
| Can I query presence/typing? | Partial. | `GET /api/presence/:sessionId` exists; typing is broadcast-only and not durable. CLI agents do not get this unless they use REST/WS directly. |

## Dave v2 Consumer Notes

Dave v2 should start with a read-only `ANTAdapter` that builds an ephemeral
`DaveContextSnapshot` from live ANT facts. Persist Dave semantics and ANT
foreign references only.

Recommended read methods:

```ts
listSessions(): Promise<{ sessions: Session[]; recoverable: Session[] }>;
getSession(id: string): Promise<Session>;
getParticipants(roomId: string): Promise<ParticipantsResponse>;
getMessages(roomId: string, cursor?: { since?: string; before?: string; limit?: number }): Promise<Message[]>;
getRoomLinks(roomId: string): Promise<RoomLinksResponse>;
getStatus(sessionOrChatId: string): Promise<SessionStatus>;
getHealth(): Promise<HealthResponse>;
getRunEvents(sessionOrChatId: string, filter?: RunEventFilter): Promise<RunEvent[]>;
getTerminalHistory(terminalId: string, filter?: HistoryFilter): Promise<TerminalHistoryResponse>;
getTerminalEvents(terminalId: string, filter?: TerminalEventFilter): Promise<TerminalEventResponse>;
getTasks(roomId: string): Promise<Task[]>;
getFileRefs(roomId: string): Promise<FileRef[]>;
getReads(roomId: string): Promise<Record<string, ReadReceipt[]>>;
```

Allowed mutating operations for a Dave supervisor, if policy permits:

- Create/link chat rooms with `/api/sessions` and `/api/sessions/:id/links`.
- Add/remove room participants with `/api/sessions/:id/participants`.
- Create/update tasks and file refs.
- Send ordinary messages.
- Send `agent_response` decisions only after Dave policy has approved the
  decision and stored the reason as Dave semantics.

Do not persist copied ANT operational state in Dave records:

- Do not store message bodies as durable Dave truth.
- Do not store participant lists as durable Dave truth.
- Do not store session status, pending prompt state, terminal output, or run
  event payloads as durable Dave truth.
- Store ANT IDs and evidence references instead, then rebuild snapshots from
  ANT when needed.

## Fixture Checklist

Adapter tests should use fixture responses shaped like the real ANT surface.

Required fixture groups:

1. Sessions
   - Active terminal with auto-linked chat.
   - Standalone chatroom.
   - Archived/soft-deleted recoverable session.
   - Session with `handle`, `display_name`, `cli_flag`, `root_dir`, and `meta`.
2. Messages
   - Plain message.
   - Targeted `@handle` message.
   - Reply with `reply_to`.
   - `agent_event` prompt message with JSON content and meta transitions:
     pending, responded, discarded.
   - Pinned message.
3. Participants
   - `chat_room_members` path with participant and external roles.
   - Fallback message-derived participants when no room members exist.
   - Participant with per-room alias and global handle.
   - Left participant row.
4. Room links
   - Outgoing discussion link with `settings.inherit_parent_context`.
   - Incoming backlink.
   - Existing room linked as a discussion.
5. Evidence
   - Run events from `hook`, `terminal`, `status`, and `tmux` sources.
   - Terminal history range response.
   - Terminal history FTS search response.
   - Terminal event rows.
6. Prompt/approval
   - `status.needs_input === false` with agent status.
   - `status.needs_input === true` with `event_id`, `event_chat_id`, and event.
   - `agent_response` handled response.
   - Generic prompt bridge pending/responded event.
7. Health
   - Empty watchdog state.
   - Active sessions under cap.
   - At-cap state.
   - Stalled session.
8. Presence/reads
   - Presence active/idle/offline by handle.
   - Read receipt map with multiple readers.
9. Missing surfaces
   - Delivery log read API absent.
   - Scheduling/recurrence API absent.

Invariant tests for semantic consumers:

- `NoInfrastructureOwnership`: consumer records may contain ANT IDs, URLs,
  and semantic fields, but not copied message bodies, terminal transcripts,
  participant lists, run-event payloads, or approval state.
- `SnapshotDisposability`: deleting and rebuilding a context snapshot from ANT
  must not lose consumer-owned goals, assignments, criteria, evidence refs, or
  grades.
- `LiveANTWins`: when fresh ANT responses disagree with a stale cached view,
  the consumer must prefer ANT.

## Known Gaps

- No public delivery-log read API, despite internal `delivery_log` writes.
- No public scheduling/recurrence/timed-resume API.
- No durable typing state; typing is a WebSocket broadcast only.
- CLI does not expose all available REST surfaces, especially participants,
  presence, read receipts, and delivery history.
- API response schemas are not formally versioned. This document is the current
  consumer contract, but TypeScript types should still be generated/maintained
  with tests.
