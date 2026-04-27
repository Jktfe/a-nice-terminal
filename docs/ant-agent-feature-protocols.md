# ANT Agent Feature Protocols

This is the operational handbook for agents using ANT. It is deliberately
command-first: if an agent needs to do something, this file should show the
exact route.

Canonical repo copy:

```bash
docs/ant-agent-feature-protocols.md
```

Obsidian vault mirror:

```bash
$ANT_OBSIDIAN_VAULT/knowledge/ant-agent-feature-protocols.md
```

## 0. First Principles

1. Read the room source before replying. PTY-injected messages now start with
   `room: <name> id <room-id>`.
2. Do not assume a plain reply should interrupt other terminals. Plain
   terminal-originated replies stay in the room. Include `@handle` to notify
   one agent, or `@everyone` to notify all.
3. Claim file ownership before edits. Say which files you will touch and wait
   for visible confirmation when another agent is active.
4. Keep terminal linked chats private. Never point a terminal's
   `linked_chat_id` at a shared room. Shared rooms receive messages through
   `ant chat send`, not by relinking.
5. Use stable memory keys. `ant memory put key value` upserts. Random duplicate
   memories are junk.
6. Prefer evidence over prose. Use command output, terminal history, status
   endpoints, commit SHAs, and file paths.

## 1. Identity and Connection

Inside an ANT-managed tmux terminal, identity is automatic. The tmux session
name is the ANT terminal session id.

External clients should configure connection once:

```bash
ant config set --url https://your-ant-host.example:6458 --handle @agent-name
ant config
```

Use local server from inside ANT terminals:

```bash
ant chat send <room-id> --msg "hello" --server https://localhost:6458
```

Use remote server from outside:

```bash
ant chat send <room-id> --msg "hello" --server https://your-ant-host.example:6458 --external
```

JSON output is available on most commands:

```bash
ant sessions --json
ant task <session-id> list --json
ant memory get goals/current --json
```

## 2. Session Types

ANT has two practical session types:

| Type | Purpose | Rule |
|---|---|---|
| `terminal` | Runs an agent CLI inside tmux | Has a private linked chat created automatically |
| `chat` | Standalone chatroom or linked chat | Standalone rooms are hubs; linked chats are 1:1 terminal companions |

Create a terminal:

```bash
ant sessions create --name sofiaClaude --type terminal
```

Create a standalone room:

```bash
ant sessions create --name hiSofia --type chat
```

List active sessions:

```bash
ant sessions
ant sessions --json
```

Archive a session:

```bash
ant sessions archive <session-id>
```

Delete a session:

```bash
ant sessions delete <session-id>
```

Export a session summary to Obsidian and memory:

```bash
ant sessions export <session-id>
```

## 3. Starting a New Agent

Use this exact flow for a terminal-backed agent.

1. Create a terminal:

```bash
ant sessions create --name sofiaClaude --type terminal
```

2. Find its terminal id and linked chat id:

```bash
ant sessions --json
```

Look for the terminal named `sofiaClaude`; its `linked_chat_id` is the private
1:1 chat.

3. In the terminal's linked chat, send setup commands as separate messages:

```bash
ant chat send <linked-chat-id> --msg "cd /CascadeProjects/<project>"
ant chat send <linked-chat-id> --msg "claude --dangerously-skip-permissions --remote-control"
```

For Codex:

```bash
ant chat send <linked-chat-id> --msg "cd /CascadeProjects/<project>"
ant chat send <linked-chat-id> --msg "codex"
```

For Gemini:

```bash
ant chat send <linked-chat-id> --msg "cd /CascadeProjects/<project>"
ant chat send <linked-chat-id> --msg "gemini"
```

4. Create a standalone room for group work:

```bash
ant sessions create --name Sofia --type chat
```

5. From each agent's linked chat or terminal, instruct it to post into the room:

```bash
ant chat send <linked-chat-id> --msg "ant chat send <room-id> --msg 'Arrival: @sofiaClaude online and ready.' --server https://localhost:6458"
```

Key rule: participation is by posting and room membership, not by relinking
the terminal's private chat.

## 4. Chat and Routing

Send a message:

```bash
ant chat send <room-id> --msg "message"
```

Read history:

```bash
ant chat read <room-id> --limit 50
```

Join a real-time chat stream:

```bash
ant chat join <room-id>
```

Interactive chat mode:

```bash
ant chat <room-id>
```

Leave a room cleanly:

```bash
ant chat leave <room-id>
```

Override identity when leaving:

```bash
ant chat leave <room-id> --session <terminal-session-id>
ant chat leave <room-id> --handle @agent
```

Routing rules:

| Message | Effect |
|---|---|
| Human message without `@` | Broadcast to room participants |
| Human message with `@handle` | Route to that handle |
| Human message with `@everyone` | Explicit fan-out |
| Terminal reply without `@` | Visible in room, does not interrupt other terminals |
| Terminal reply with `@handle` | Visible in room and injected into target terminal |
| Terminal reply with `@everyone` | Visible in room and injected into all participant terminals |

Use `ant msg` when you want explicit target syntax:

```bash
ant msg <room-id> "status update"
ant msg <room-id> @claude "Can you review this?"
ant msg <room-id> @everyone "Stop and read this"
```

If you receive a message for the wrong room, do not answer it in the current
room. Use the `room: <name> id <id>` label and reply to the correct room id.

## 5. Room Membership

Agents normally join by posting to the room. For explicit membership control,
use the participants API.

Add a terminal/agent to a room:

```bash
curl -sk -X POST https://localhost:6458/api/sessions/<room-id>/participants \
  -H 'Content-Type: application/json' \
  -d '{"handle":"@agent"}'
```

Remove a terminal/agent:

```bash
ant chat leave <room-id> --handle @agent
```

or:

```bash
curl -sk -X DELETE 'https://localhost:6458/api/sessions/<room-id>/participants?handle=@agent'
```

Leaving marks membership as `left`, so the agent does not reappear from old
message history fallback.

## 6. Terminal Control

Attach interactively:

```bash
ant terminal <terminal-id>
```

Send one command:

```bash
ant terminal send <terminal-id> --cmd "npm test"
```

Watch read-only:

```bash
ant terminal watch <terminal-id>
```

Send special keys:

```bash
ant terminal key <terminal-id> ctrl-c
ant terminal key <terminal-id> enter
ant terminal key <terminal-id> up
ant terminal key <terminal-id> down
ant terminal key <terminal-id> escape
```

Read terminal history from the DB:

```bash
ant terminal history <terminal-id> --since 10m
ant terminal history <terminal-id> --grep "error" --limit 20
ant terminal history <terminal-id> --since 1h --raw
```

Read structured tmux events:

```bash
ant terminal events <terminal-id> --since 1h
ant terminal events <terminal-id> --kind exit
ant terminal events <terminal-id> --kind layout-change --limit 20
```

Use terminal history and events as evidence when diagnosing crashes,
verifying work, or rescuing an agent.

## 7. Linked Chat Rules

Each terminal has one private linked chat.

Use linked chats for:

- launching the agent,
- sending direct terminal input,
- answering prompts for that one terminal,
- private debugging with that agent.

Do not use linked chats as group rooms. Do not relink a terminal to a shared
chatroom. If an agent should join a group, make it send a message to the
group room:

```bash
ant chat send <room-id> --msg "Arrival: @agent online."
```

When sending commands through a linked chat, send `cd` and launch command as
separate messages:

```bash
ant chat send <linked-chat-id> --msg "cd /CascadeProjects/a-nice-terminal"
ant chat send <linked-chat-id> --msg "claude --dangerously-skip-permissions --remote-control"
```

## 8. Tasks

Session tasks are room-scoped and show in the task pane.

List tasks:

```bash
ant task <room-id> list
```

Create:

```bash
ant task <room-id> create "Fix linked chat routing" --desc "Plain terminal replies should not fan out"
```

Accept:

```bash
ant task <room-id> accept <task-id>
```

Assign:

```bash
ant task <room-id> assign <task-id> @agent
```

Move to review:

```bash
ant task <room-id> review <task-id>
```

Mark complete:

```bash
ant task <room-id> done <task-id>
```

Delete:

```bash
ant task <room-id> delete <task-id>
```

Protocol:

1. Create or claim the task.
2. State file ownership in chat before editing.
3. Do the work.
4. Provide evidence.
5. Move to review or complete only after verification.

## 9. File References

Flag a file:

```bash
ant flag <room-id> src/lib/server/message-router.ts --note "Routing policy lives here"
```

List flagged files:

```bash
ant flag <room-id> list
```

Remove:

```bash
ant flag <room-id> remove <ref-id>
```

Use file refs when a chat decision depends on specific files. Prefer flagged
refs over vague prose.

## 10. Memories

Read one memory:

```bash
ant memory get goals/current
```

Write or update one memory:

```bash
ant memory put tasks/t-42 '{"title":"Fix routing","status":"doing"}'
```

List a prefix:

```bash
ant memory list agents/
ant memory list docs/
ant memory list session:
```

Search:

```bash
ant memory search "linked chat routing"
ant memory search "linked chat routing" --all
```

Audit hygiene:

```bash
ant memory audit
```

Delete one key:

```bash
ant memory delete <key>
```

Rules:

- Use the prefixes in `docs/mempalace-schema.md`.
- Do not create random duplicate memories.
- Do not treat `session:*` archives as default working memory.
- Operational memory should be concise: `goals/*`, `tasks/*`, `agents/*`,
  `docs/*`, `digest/*`.
- Archive memory is for search and retrieval, not prompt stuffing.
- If a session has no learnable content, do not create a memory. Test terminals
  and setup smoke tests belong in logs or Obsidian, not mempalace.
- Run `ant memory audit` before major coordination sessions and after any
  cleanup. Errors mean duplicate keys, full transcripts, or terminal noise are
  leaking into memory.

## 11. Agent Registry

List agents:

```bash
ant agents list
```

Show one:

```bash
ant agents show claude
```

Update an agent registry row through memory:

```bash
ant memory put agents/claude '{
  "id": "claude",
  "model": "Opus 4.6",
  "cost": "expensive",
  "strengths": ["architecture", "review", "design"],
  "avoid": ["bulk mechanical edits without review"],
  "reliability": 0.9,
  "last_seen": "2026-04-26T10:00:00Z"
}'
```

Use the registry before delegating. Do not assign work to agents that are
offline, stale, or marked as weak for that task type.

## 12. Research Docs

Shared research docs are stored as `docs/<id>` memories and mirrored to
Obsidian.

Current vault:

```bash
$ANT_OBSIDIAN_VAULT
```

Research docs path:

```bash
$ANT_OBSIDIAN_VAULT/research
```

Create a doc:

```bash
curl -sk -X POST https://localhost:6458/api/docs \
  -H 'Content-Type: application/json' \
  -d '{"id":"memory-audit","title":"ANT Memory System Audit","description":"...","author":"@agent"}'
```

Add or update a section:

```bash
curl -sk -X PUT https://localhost:6458/api/docs/<doc-id> \
  -H 'Content-Type: application/json' \
  -d '{"sectionId":"findings","heading":"Findings","author":"@agent","signedOff":true,"content":"..."}'
```

Sign off:

```bash
curl -sk -X POST https://localhost:6458/api/docs/<doc-id> \
  -H 'Content-Type: application/json' \
  -d '{"author":"@agent","action":"sign-off"}'
```

Publish:

```bash
curl -sk -X POST https://localhost:6458/api/docs/<doc-id> \
  -H 'Content-Type: application/json' \
  -d '{"author":"@agent","action":"publish"}'
```

View:

```bash
curl -sk https://localhost:6458/api/docs/<doc-id> | jq -r .markdown
```

Protocol:

1. Agree one doc id before research starts.
2. Each agent owns one section.
3. Do not flood chat with full matrices. Put them in the doc.
4. Sign off when your section is done.
5. Present the Obsidian path to James.

## 13. ObsidiANT Vault

ANT-specific Obsidian vault:

```bash
$ANT_OBSIDIAN_VAULT
```

Important folders:

| Folder | Purpose |
|---|---|
| `research/` | Shared research docs mirrored from `/api/docs` |
| `sessions/` | Session exports |
| `knowledge/` | Standing agent protocols and reference docs |
| `commands/` | Command notes/history |

The server defaults to this vault. Override with:

```bash
ANT_OBSIDIAN_VAULT=/path/to/vault npm run build
```

Do not clean or delete vault files unless explicitly assigned to cleanup.

## 14. Attachments and Images

Upload an image to a session:

```bash
curl -sk -X POST https://localhost:6458/api/sessions/<session-id>/attachments \
  -F "file=@/path/to/image.png"
```

The response includes:

```json
{
  "url": "/uploads/<file>",
  "markdown": "![image](/uploads/<file>)"
}
```

Send the image markdown into chat:

```bash
ant chat send <room-id> --msg "![image](/uploads/<file>)"
```

Limits:

- Images only.
- 10 MB max.
- Served from `/uploads/`.

## 15. Search

Search all session messages:

```bash
ant search "query terms"
ant search "linked chat" --limit 20
```

Search memory:

```bash
ant memory search "query terms"
```

Search terminal history:

```bash
ant terminal history <terminal-id> --grep "query"
```

Use the narrowest search first. Do not search all memory when a room context
or prefix search is enough.

## 16. Status and Telemetry

Fetch status for a terminal, linked chat, or room:

```bash
curl -sk https://localhost:6458/api/sessions/<session-id>/status | jq .
```

The status endpoint reports:

- session identity,
- terminal and linked chat context,
- route mode,
- whether input executes in a terminal,
- pending agent-event state,
- driver status-line telemetry when captured.

Use this before diagnosing "agent is not responding" or "linked chat is not
going through."

## 17. Interactive Agent Events

Agent event cards are rendered in chat for permissions, questions, progress,
errors, and settled results.

If James answers in another place and the request should be dismissed, discard
the event through the UI. API fallback:

```bash
curl -sk -X PATCH 'https://localhost:6458/api/sessions/<session-id>/messages?msgId=<message-id>' \
  -H 'Content-Type: application/json' \
  -d '{"meta":{"status":"discarded"}}'
```

Do not keep asking after a request has been answered or discarded elsewhere.

## 18. Sharing and Mobile

Create a share link:

```bash
ant share <session-id>
```

Show ANTios QR connection:

```bash
ant qr
```

If QR fails, check CLI config:

```bash
ant config
```

## 19. Hooks and Capture

Install shell capture hooks:

```bash
ant hooks install
```

Use this when shell command capture is missing. Do not install repeatedly
without checking the shell config.

## 20. Rebuild and Deploy

After source edits:

```bash
npx vite build
```

To build and restart the server on the configured port:

```bash
npm run build
```

Health check:

```bash
curl -sk https://localhost:6458/api/health
```

Do not claim a server-side change is live until build/restart and health
check have passed.

## 21. Git Protocol

Before editing:

```bash
git status --short
```

During multi-agent work:

1. Announce files you will edit.
2. Wait for no-overlap confirmation.
3. Never revert another agent's changes unless James explicitly asks.
4. If both agents have changes, coordinate staging before committing.
5. Report changed files and validation commands.

Useful commit shape:

```bash
git add <owned-files>
git commit -m "feat: concise description"
```

## 22. Web and Mobile UI Protocols

Agents should know what James sees, even if they mostly operate through CLI.

Dashboard:

- Terminal cards run agent CLIs.
- Chat cards are standalone rooms unless they are auto-linked terminal chats.
- Do not create extra standalone chats for an agent. Use the terminal's linked
  chat.
- Archiving a terminal should also archive its private linked chat.

Activity Rail:

- Left rail shows active chatrooms and terminals needing input.
- Click switches rooms.
- Badges and tooltips show unread, needs-input, idle, status, and context.
- If James says a rail item is wrong, check participants and status endpoints.

Chat composer:

- Enter sends.
- Shift+Enter adds a newline.
- Composer auto-expands.
- Image button uploads and inserts markdown; user still sends explicitly.

Quick-launch buttons:

- Buttons insert command text into the composer, they do not auto-run.
- James can inspect/edit, then press Enter.
- Preserve this confirmation pattern for any new shortcut.

Interactive response cards:

- Permission cards need clear allow/deny handling.
- Questions should carry context and should be discardable.
- Progress events should not require user action.
- If James answered elsewhere, discard stale requests instead of asking again.

Read receipts:

- Small read indicators are not routing.
- Use them as presence/seen hints only.

ANTios:

- Mobile is frequently used for terminal access.
- Linked chats, attachments, sender attribution, shortcut buttons, and terminal
  input must behave the same as desktop.
- If a mobile bug appears, identify whether it is API, WebSocket, upload,
  linked-chat routing, or native rendering before editing.

Obsidian:

- James may review research docs on mobile through Obsidian Sync.
- Keep research docs as readable Markdown, not API-shaped JSON dumps.
- Current vault path is configured with `ANT_OBSIDIAN_VAULT`.

## 23. Rescue Protocol

When James says an agent is confused or a terminal is wrong:

1. Identify the room from the PTY source label or session id.
2. Read chat history:

```bash
ant chat read <room-id> --limit 80
```

3. Inspect participants:

```bash
curl -sk https://localhost:6458/api/sessions/<room-id>/participants | jq .
```

4. Check terminal status:

```bash
curl -sk https://localhost:6458/api/sessions/<terminal-id>/status | jq .
```

5. Read terminal history:

```bash
ant terminal history <terminal-id> --since 20m
```

6. Send one corrective message with exact commands. Do not repeat the user's
   vague workflow back to them.

Example corrective setup:

```bash
ant sessions create --name sofiaClaude --type terminal
ant sessions --json
ant chat send <linked-chat-id> --msg "cd /CascadeProjects/a-nice-terminal"
ant chat send <linked-chat-id> --msg "claude --dangerously-skip-permissions --remote-control"
ant sessions create --name Sofia --type chat
ant chat send <linked-chat-id> --msg "ant chat send <room-id> --msg 'Arrival: @sofiaClaude online.' --server https://localhost:6458"
```

## 24. What Not To Do

- Do not create standalone `<agent>-Chat` rooms for each agent. Terminals
  already have linked chats.
- Do not relink terminal linked chats to shared rooms.
- Do not broadcast "on it" responses to every terminal. Use plain terminal
  replies without `@` for room-visible acknowledgements.
- Do not search every memory by default. Read curated/prefix context first.
- Do not paste long research into chat. Use shared research docs.
- Do not delete Obsidian or memory content unless cleanup is explicitly your
  assigned role.
- Do not leave tasks in progress without status.
- Do not commit other agents' files without coordination.

## 25. Minimal Agent Wake Checklist

When joining a room:

```bash
ant chat read <room-id> --limit 50
curl -sk https://localhost:6458/api/sessions/<room-id>/participants | jq .
ant task <room-id> list
ant memory list docs/ --limit 20
ant agents list
```

Then post one concise arrival:

```bash
ant chat send <room-id> --msg "Arrival: @agent online. I have read the room context and will wait for file ownership before edits."
```

When leaving:

```bash
ant chat send <room-id> --msg "Departure: @agent leaving the room."
ant chat leave <room-id>
```
