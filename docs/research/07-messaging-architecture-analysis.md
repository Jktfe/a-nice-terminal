# ANT Messaging & Conversation Architecture Analysis

> Follow-up research conducted April 2026 to address gap in original synthesis.

## Current Architecture

### Message Flow: Create → Stream → Complete

1. User types in InputArea (Tiptap editor with @mention autocomplete)
2. `sendMessage()` POSTs to `/api/sessions/{sessionId}/messages`
3. Backend validates role, content, format; strips ANSI codes for plaintext
4. Creates message with role (human/agent/system), format (markdown/json/text), status (pending/streaming/complete)
5. Emits `message_created` WebSocket event to session room

**Streaming path:**
- Agent sends `stream_chunk` events with content increments
- Handler appends chunks to message.content in DB
- Relays to all clients; `stream_end` sets status to "complete"

**Status messages:** Messages with role=system, format=json matching `{status, from}` pattern are transient socket events (`agent_status`) — don't persist to DB.

### Session Types

- `terminal` — PTY-backed shell with live I/O
- `conversation` — chat message threads (no PTY)
- `unified` — combines both (future)

### Identity Binding

Messages capture: `sender_type`, `sender_name`, `sender_cwd`, `sender_persona`, `sender_terminal_id`
- `sender_terminal_id` is FK to terminal session
- Display names from `terminal_display_names` table

**Problem:** Identity binding is optional — `sender_terminal_id` FK exists but isn't required, creating spoofing surface.

### Threading Model

- Messages have optional `thread_id` FK to parent message
- Single-level deep (no nested replies)
- ThreadPanel renders collapsed aside with parent + replies
- Scale=0.85 for visual hierarchy

### Chat Rooms & Multi-Participant

- DB-backed room registry in `antchat_rooms` table
- Rooms link to `conversation_session_id`
- Tracks participants as Map<terminalSessionId, ParticipantInfo>
- Protocol syntax: `ANTchat! [room-name] "message text"`
- Task syntax: `ANTtask! [room-name] "task name" status:pending assigned:AgentName`

**Problem:** Protocol parsing happens in terminals (agents use ANTchat! syntax), but UI doesn't enforce this. Gap between agent output and chat system.

### Chairman/AI Orchestrator

- Embedded in server process, polls every 4s
- Two prompts: MESSAGE_ANALYSIS_PROMPT (task detection) + SYSTEM_PROMPT (agent routing)
- Calls LM Studio `/v1/chat/completions`
- Injects formatted messages into agent PTYs
- Posts decisions as system messages with metadata

### Message Bridge (@mentions)

- Polls conversation sessions for human messages with @mentions
- 6s grace period, checks if terminal cursor advanced
- Injects raw message content into PTY if cursor stayed still
- **Fire-and-forget** — no ACK mechanism

## What's Working Well

- Socket.IO real-time sync — instant propagation
- Rich metadata — sender info, annotations, starred flags
- Simple streaming protocol (chunk + end) — reliable
- FTS5-backed search across sessions
- Flexible annotation model (thumbs, flags, stars, ratings)
- Offline queue in localStorage, flushed on reconnect

## What's Awkward

1. **Chairman + Message Bridge redundancy** — both poll separately for overlapping concerns
2. **Terminal injection is fire-and-forget** — no delivery confirmation
3. **Protocol syntax leaks** — agents must output `ANTchat!` but UI doesn't visualize it
4. **Threading is flat** — single-level only
5. **Identity binding optional** — `sender_name` can be spoofed
6. **Room-to-session coupling confusing** — dual-path linkage via `conversation_session_id` and nullable `antchat_room_id`
7. **No conversation scoping** — Chairman analyzes all sessions globally

## How It Should Evolve in v2

### A. Daemon-Centric Messaging
- Move routing logic OUT of web server into daemon
- Daemon owns: terminal I/O, message delivery, orchestration
- Web server becomes stateless view layer
- Agents connect directly to daemon

### B. Proper Identity & Authorization
- Bind messages to authenticated agent identity at daemon level
- Derive sender from auth context, not client-provided name
- Per-room ACLs

### C. Unified Message Router (replacing Chairman + Bridge)
- Single routing service instead of two polling loops
- Pub/sub with explicit ACKs
- Store routing decisions as first-class records (audit trail)
- Agents respond with receipt/rejection/questions

### D. Conversation as First-Class Entity
- `Conversation = {participants, scope, context_files, tasks, threading_model}`
- Messages belong to a Conversation, inherit scope/permissions
- Per-conversation routing rules

### E. Rich Threading
- Unlimited nesting
- Tree rendering with collapse/expand
- Query by root message ID + depth

### F. Observability
- Every message: created → routed → delivered → read → ACKed
- Chairman decisions visible as events in chat
- Injection attempts recorded with success/failure

### G. CLI Integration
The `ant` CLI should support messaging natively:
```bash
ant msg send <session> "message text" --role agent --json
ant msg stream <session> --follow          # subscribe to new messages
ant msg list <session> --since 1h --json   # query history
```

This makes agents' message operations the same CLI-based flow as terminal operations, eliminating the need for separate MCP/REST paths.
