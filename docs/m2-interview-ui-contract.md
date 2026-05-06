# M2 #1 — Interview Mode UI Contract

Date: 2026-05-06
Status: locked while kimi/m2-ui builds. Server-side shipped at b888108
(plus c097875 integration tests). Doc captures the wire for the agent-card
"Start interview" button and the room @-mention parser.

Reference: `docs/interview-mode-sketch-2026-05-05.md` § Slice 2 — this
doc pins down the wire details that sketch deferred.

## Server endpoint

```
POST /api/sessions/:id/start-interview
Content-Type: application/json
```

`:id` is the **target session id** — the terminal/chat/agent the human is
interviewing. The route reads `linked_chat_id` on the target row and
either returns it (focus) or creates a new linked chat (create).

### Request body (all fields optional)

```json
{
  "origin_room_id": "string | null",
  "caller_handle":  "string | null"
}
```

- `origin_room_id` — when triggered from a room @-mention, set to that
  room's session id so the published summary can back-link.
- `caller_handle` — the human's handle for attribution in the chat meta
  blob.

The server stores both (plus `interview: true`, `started_at_ms`) in the
new chat row's `meta` column. They are not used to enforce anything yet
— they're audit / future-routing breadcrumbs.

### Response

**200 OK, created path** (no existing linked chat on target):
```json
{
  "ok": true,
  "created": true,
  "linked_chat_id": "<chat_id>",
  "target_session_id": "<target_id>",
  "chat_name": "Interview: <display_name>"
}
```

**200 OK, focus path** (target already has linked_chat_id):
```json
{
  "ok": true,
  "created": false,
  "linked_chat_id": "<chat_id>",
  "target_session_id": "<target_id>"
}
```

Note the `chat_name` is **only present on created=true**. Don't index
into it without checking `created`.

**404** — target session does not exist.
**400** — target session type is not in {terminal, chat, agent}.

`SvelteKit error()` shape: body is `{ message: string }`.

## Client decision tree

After a successful POST:

| `created` | UI behaviour |
|-----------|--------------|
| `true`    | Toast "Interview started with @handle". Navigate to `/session/<linked_chat_id>` (or push it into the linked-chat side-pane if a panel is already open for the target). |
| `false`   | Toast "Resumed interview with @handle". Same navigation as above — the chat already exists, we're just focusing it. |

On error:

| status | UI behaviour |
|--------|--------------|
| `404`  | Toast "Cannot start interview — session not found". No navigation. |
| `400`  | Toast "Cannot interview a workspace". No navigation. (User should pick a terminal/chat/agent.) |
| `5xx`  | Toast "Interview server error — try again". Log to console. |

## Surfaces

### Agent card button

Location: `src/lib/components/AgentCard.svelte` (or wherever agent
listings render — verify against current code). Add a "Start interview"
button visible when the card represents a session of type
terminal/chat/agent. Disabled state if `linked_chat_id` is already set
on the row AND the linked chat is currently focused (avoid the
no-op-focus loop).

POST body for this surface: `{ caller_handle: <current user handle> }`.
No `origin_room_id` — the agent card lives outside any specific room.

### Room @-mention parser

Location: composer mention-handler. Detect the **interview prefix** in
a chat message:

```
@<agent_handle> /interview <optional question>
```

(Slash-prefix is the convention because it's terse and visually distinct
from a normal mention. Confirmed pattern with James — if a different
prefix is preferred, change here and update tests.)

When parsed:
1. Resolve `<agent_handle>` → target session id (use existing
   `getSessionByHandle` query).
2. POST `{ origin_room_id: <current_room_id>, caller_handle: <user> }`.
3. On `created=true`: post a system message in the origin room "@user
   started an interview with @agent → /session/<linked_chat_id>" so
   other room members can follow.
4. Navigate the user (only) to the linked chat.
5. If the message had an `<optional question>` body, paste it as the
   first human message in the new linked chat.

If the agent_handle does not resolve, surface a toast and **do not** post
anything system-level — leave the original message intact for the user
to fix.

## Acceptance for the UI lane

- Agent-card button works for a terminal target: creates linked chat,
  navigates to it, shows the right toast.
- Second click on same card: focuses existing linked chat, no
  duplicate creation.
- Room @-mention `@agent /interview question` creates linked chat,
  navigates user, posts system message in origin room with back-link,
  pastes question into linked chat.
- 404 / 400 / 5xx error paths each show the documented toast and do
  not navigate.
- E2E exercise: from the dashboard, click Start interview on an agent
  card, type a message in the linked chat, hit "Publish summary"
  (when slice 4 lands — out of scope for this lane).

Server contract is locked by `tests/start-interview.test.ts` (helper)
and `tests/start-interview-route.test.ts` (route). Don't change the
response shape without updating both.
