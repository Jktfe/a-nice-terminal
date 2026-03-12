# ANT iOS — Native Mobile App Design Spec

**Date**: 2026-03-12
**Status**: Approved
**Repo**: `/Users/jamesking/CascadeProjects/antios` (private, open-source later)

---

## 1. Overview

A native iOS app for ANT (A Nice Terminal) — a full-featured mobile client that connects to the ANT server over Tailscale (with future public access). The app provides both conversation-focused AI agent messaging and simplified terminal control, with offline support via cached reads and queued writes.

### Goals
- Slick, premium iOS-native UX built entirely in SwiftUI
- Full session management: create, rename, archive, delete, switch workspaces
- Conversation view: rich message bubbles with markdown, streaming support
- Terminal view: clean formatted output (not raw xterm) with smart command bar
- Offline-first: cached state when disconnected, queued actions on reconnect
- Connect via Tailscale with API key auth; designed for future public auth

### Non-Goals (v1)
- Push notifications (add later via APNs)
- iPad / macOS builds (iOS only for v1)
- Full xterm terminal emulator (simplified output view instead)
- Light theme (dark mode only for v1)

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Platform | iOS 17+, Swift 6, Xcode 16 |
| UI | SwiftUI + Observation framework |
| Navigation | NavigationStack with typed destinations |
| State | `@Observable` classes (SessionStore, MessageStore, TerminalStore, SearchStore) |
| Networking | URLSession for REST, Socket.IO-Client-Swift (v16.x) for WebSocket |
| Offline cache | SwiftData |
| Auth | API key stored in Keychain |
| Connectivity | NWPathMonitor for online/offline detection |
| Queued writes | PendingAction table in SwiftData, FIFO flush on reconnect |

### Key Decisions
- **No third-party UI libraries** — pure SwiftUI for full native feel
- **Socket.IO client**: Use `Socket.IO-Client-Swift` (v16.x) for v1 — handles Engine.IO transport negotiation, heartbeats, and reconnection out of the box. Consider a lightweight custom client post-v1 if binary size becomes a concern.
- **No xterm.js / WebView** — terminal output rendered as `AttributedString` in ScrollView with monospace font
- **Offline-first**: every API response cached to SwiftData. Reads hit cache first, then sync. Writes queue when offline.

---

## 3. Design Direction

**Style**: iOS-polished with premium dark twist. Follows Apple HIG closely with native components, enhanced by:
- Fraunces serif for screen titles (editorial elegance)
- DM Sans for all UI text (crisp readability)
- JetBrains Mono for terminal content
- Deep charcoal backgrounds (#0B0B0E, #16161A)
- Vibrant gradient accents: indigo (#6366F1) for conversations, emerald (#32D583) for terminals, coral (#E85A4F) for secondary actions
- Floating pill tab bar with active state fills
- 16-20px corner radii on cards, generous spacing

**Mockups**: Three screens designed in Pencil — Sessions list, Conversation view, Terminal view.

---

## 4. Navigation & Screens

### Tab Bar (4 tabs)

| Tab | Icon | Screen | Purpose |
|-----|------|--------|---------|
| Sessions | `layers` | Session list | Home — browse, filter, manage sessions |
| Terminal | `terminal` | Quick terminal | Jump to most recent active terminal |
| Search | `search` | Global search | Cross-session search (sessions + messages) |
| Settings | `settings` | Settings | Server config, appearance, about |

### Navigation Flows

```
Sessions tab:
  Session List -> Conversation View (push)
  Session List -> Terminal View (push)
  Session List -> New Session sheet

Terminal tab:
  -> Most recent active terminal (or picker if none)

Search tab:
  -> Search results -> taps push to Conversation/Terminal

Settings tab:
  -> Server URL, API key, appearance, cache management
```

### Gestures
- Swipe left on session card: Archive / Delete
- Long press session card: Context menu (rename, move workspace, pin)
- Pull to refresh on session list
- Swipe right from edge: back navigation (standard iOS)

---

## 5. Screen Details

### 5.1 Sessions List (Home)
- **Header**: "Sessions" title (Fraunces serif), plus button opens new session sheet
- **Search bar**: Local filter + triggers global search on submit
- **Workspace pills**: Horizontal scroll, "All" default, filters session list
- **Session cards**: Type icon (gradient), name, subtitle (type, message count, relative time), status dot (green=active, amber=idle) or unread badge
- **Swipe actions**: Archive (left), pin (right)
- **Empty state**: Illustration + "No sessions yet" + create button
- **Pull to refresh**: Syncs with server

### 5.2 Conversation View
- **Nav bar**: Back chevron, type icon, session name, subtitle, ellipsis menu (rename, export, archive, delete)
- **Message list**: ScrollViewReader with auto-scroll to bottom. Human bubbles right-aligned (indigo), agent bubbles left-aligned (dark card + bot avatar). Markdown rendering via AttributedString. Copy button on long press.
- **Input area**: Rounded text field, send button (indigo). Supports multi-line. Attachment button for file uploads later.
- **Streaming messages**: When a `stream_chunk` event arrives, the app creates or updates a `CachedMessage` with `status: "streaming"`. The bubble renders with a pulsing cursor at the end. Content is accumulated chunk-by-chunk into the message body. On `message_updated` with `status: "complete"`, the cursor disappears and the final content is cached. If the app goes offline mid-stream, the partial content is preserved in cache and marked as `status: "incomplete"` — on reconnect, the full message is fetched via REST.

### 5.3 Terminal View
- **Nav bar**: Same pattern, green gradient icon, "Active" status in green
- **Output area**: Dark background (#0D0D10), monospace AttributedString. Colour-coded: green for prompts/info, amber for warnings, red for errors, white for standard output. Auto-scrolls, tap to pause scroll.
- **Quick actions**: Horizontal pill row — Up (history), Tab (autocomplete), Ctrl+C, Ctrl+D. These send corresponding escape sequences via the API.
- **Command bar**: Monospace input with `$` prompt. Return key sends via `POST /api/sessions/:id/terminal/input`.

### 5.4 Search
- **Search field**: Auto-focus on tab select
- **Results**: Grouped by sessions and messages, with highlighted snippets
- **Tapping result**: Pushes to Conversation or Terminal view

### 5.5 Settings
- **Server section**: Client-local configuration — server URL field, API key (Keychain-backed), connection test button. These are stored locally on the device, not fetched from the server's `/api/settings` endpoint.
- **Appearance**: Terminal font size slider (dark mode only for v1)
- **Cache**: "Clear offline data" button, cache size display
- **Troubleshooting**: "Kill all terminals" button (calls `DELETE /api/sessions/terminals/all`)
- **About**: Version, link to ANT repo, open-source notice

---

## 6. Data Flow & Offline Strategy

### Real-time Sync
```
App Launch -> Connect Socket.IO -> join_session for active session
           -> Fetch all sessions (REST) -> cache to SwiftData
           -> NWPathMonitor watches connectivity
```

### Offline Behaviour

| Action | Offline | Reconnect |
|--------|---------|-----------|
| Browse sessions | Cached list from SwiftData | Refresh from server |
| Read messages | Cached messages | Fetch `?since=lastTimestamp` |
| Read terminal output | Cached output events | Fetch `?since=lastChunkIndex` |
| Send message | Queued in PendingAction table | Flushed in order |
| Terminal input | **Disabled** — command bar shows "Reconnecting..." | Resumes live input |
| Create/rename/archive session | Queued | Flushed |

> **Note**: Terminal input is NOT queued offline. Commands are context-dependent and the session may have been reaped during disconnection. The command bar is disabled with a clear "Terminal unavailable — reconnecting" state. Only idempotent REST operations (session CRUD, message send) are queued.

### SwiftData Models
- `CachedSession` — id, name, type, shell, cwd, workspaceId, archived, updatedAt
- `CachedMessage` — id, sessionId, role, content, format, status, metadata (raw JSON string, optional), createdAt
- `CachedTerminalChunk` — id, sessionId, chunkIndex, data, createdAt
- `PendingAction` — id, endpoint, method, body, createdAt (FIFO queue)

### Connection Lifecycle
1. App foreground: connect WebSocket
2. App background: disconnect after 30s (iOS limit)
3. App foregrounded again: reconnect, delta-sync all active sessions
4. Server unreachable: show OfflineBanner, switch to cache reads + write queuing

### Error Handling & Retry Strategy
- **HTTP 4xx**: Surface error to user (toast/alert). Do not retry. If a queued PendingAction fails with 4xx on flush, discard it and notify the user.
- **HTTP 5xx**: Retry up to 3 times with exponential backoff (1s, 2s, 4s). If still failing, surface error.
- **Socket.IO reconnection**: Handled by Socket.IO-Client-Swift — default exponential backoff with max 5 attempts, then surface "Connection lost" banner.
- **Queued action flush failures**: If a session was deleted server-side while offline, the queued action returns 404. Discard the action and remove the cached session.
- **Stale terminal sessions**: On reconnect, `check_health` confirms terminal is alive. If reaped, show "Session expired" state and offer to create a new one.

---

## 7. API Surface Used

### REST Endpoints
- `GET /api/sessions` — List all sessions (supports `?include_archived=true`)
- `GET /api/sessions/:id` — Get single session (all fields including cwd)
- `POST /api/sessions` — Create session (type: terminal/conversation)
- `PATCH /api/sessions/:id` — Update (name, workspace_id, archived)
- `DELETE /api/sessions/:id` — Delete session
- `DELETE /api/sessions/terminals/all` — Kill all terminal sessions (Settings troubleshooting)
- `GET /api/sessions/:id/messages` — List messages (supports `?since=<ISO8601>&limit=N`)
- `POST /api/sessions/:id/messages` — Send message (role, content, format, status)
- `PATCH /api/sessions/:id/messages/:msgId` — Update message
- `DELETE /api/sessions/:id/messages/:msgId` — Delete message
- `GET /api/sessions/:id/terminal/output` — Terminal history (supports `?since=<chunkIndex>` — **numeric integer, not timestamp**)
- `POST /api/sessions/:id/terminal/input` — Terminal input (body: `{ "data": "<string>" }`)
- `GET /api/sessions/:id/terminal/search?q=<query>` — Terminal-specific text search with time-range filtering (v1: optional)
- `GET /api/search?q=<query>&limit=50` — Global search
- `GET /api/workspaces` — List workspaces
- `POST /api/workspaces` — Create workspace
- `PATCH /api/workspaces/:id` — Update workspace
- `DELETE /api/workspaces/:id` — Delete workspace
- `GET /api/health` — Health check
- `GET /api/resume-commands` — Resume commands list
- `DELETE /api/resume-commands/:id` — Delete resume command
- `POST /api/upload` — File upload, multipart/form-data (future — for conversation attachments). Accepts images only (JPEG, PNG, GIF, WEBP), 10MB max.

> **Important `since` parameter difference**: Messages use `?since=<ISO8601 timestamp>`. Terminal output uses `?since=<chunk_index integer>`. Do not confuse these.

### WebSocket Events

| Event | Direction | Purpose |
|-------|-----------|---------|
| `join_session` | client -> server | Subscribe to session updates |
| `leave_session` | client -> server | Unsubscribe from session |
| `terminal_input` | client -> server | Send keyboard input to terminal |
| `terminal_output` | server -> client | Terminal output chunks |
| `message_created` | server -> client | New message broadcast |
| `message_updated` | server -> client | Message edited/completed |
| `message_deleted` | server -> client | Message removed |
| `stream_chunk` | server -> client | Streaming message content (`{ sessionId, messageId, role, format, content }`) |
| `session_list_changed` | server -> client | Sessions/workspaces changed |
| `session_health` | server -> client | Terminal tmux session alive status |
| `check_health` | client -> server | Request health check |
| `resume_command_captured` | server -> client | New resume command detected |

> **Message creation**: The iOS app uses REST (`POST /api/sessions/:id/messages`) for sending messages, not WebSocket. The WebSocket is receive-only for messages.

### Key Response Shapes

**Search results** (`GET /api/search`):
```json
{
  "sessions": [{ "id": "...", "name": "...", "type": "...", "workspace_id": "..." }],
  "messages": [{ "id": "...", "session_id": "...", "session_name": "...", "session_type": "...", "role": "...", "content_snippet": "...", "created_at": "..." }]
}
```
Note: `content_snippet` is a ~100 character window around the match. Highlighting is done client-side by finding the query string within the snippet. Message results include `session_name` and `session_type` to display context without a second lookup.

---

## 8. Authentication

### v1: Tailscale + API Key
- Phone on Tailscale network, hits ANT server at Tailscale IP
- API key stored in iOS Keychain via `KeychainHelper`
- Sent as `Authorization: Bearer <key>` header (server also accepts `x-api-key` header)

### Development Setup
- For local development without Tailscale (both devices on same WiFi), set `ANT_TAILSCALE_ONLY=false` on the server or add the device IP to `ANT_ALLOWLIST`
- The server's `tailscaleOnly` middleware restricts to 100.64.0.0/10 by default

### Future: Public Access
- Auth layer designed to be swappable (protocol-based `AuthProvider`)
- Could add Clerk, PassKey, or custom JWT later
- Server would need TLS + proper auth middleware

---

## 9. Project Structure

```
antios/
├── ANT.xcodeproj
├── ANT/
│   ├── ANTApp.swift
│   ├── Info.plist
│   ├── Core/
│   │   ├── Network/
│   │   │   ├── APIClient.swift
│   │   │   ├── SocketClient.swift
│   │   │   └── ConnectivityMonitor.swift
│   │   ├── Storage/
│   │   │   ├── SwiftDataModels.swift
│   │   │   ├── PendingActionQueue.swift
│   │   │   └── KeychainHelper.swift
│   │   └── Auth/
│   │       └── ServerConfig.swift
│   ├── Stores/
│   │   ├── SessionStore.swift
│   │   ├── MessageStore.swift
│   │   ├── TerminalStore.swift
│   │   └── SearchStore.swift
│   ├── Views/
│   │   ├── TabRoot.swift
│   │   ├── Sessions/
│   │   │   ├── SessionListView.swift
│   │   │   ├── SessionCardView.swift
│   │   │   ├── WorkspaceFilterBar.swift
│   │   │   └── NewSessionSheet.swift
│   │   ├── Conversation/
│   │   │   ├── ConversationView.swift
│   │   │   ├── MessageBubbleView.swift
│   │   │   ├── AgentAvatarView.swift
│   │   │   └── MessageInputBar.swift
│   │   ├── Terminal/
│   │   │   ├── TerminalView.swift
│   │   │   ├── TerminalOutputView.swift
│   │   │   ├── QuickActionsBar.swift
│   │   │   └── CommandInputBar.swift
│   │   ├── Search/
│   │   │   └── SearchView.swift
│   │   ├── Settings/
│   │   │   ├── SettingsView.swift
│   │   │   └── ServerConfigView.swift
│   │   └── Shared/
│   │       ├── StatusDot.swift
│   │       ├── GradientIcon.swift
│   │       ├── OfflineBanner.swift
│   │       └── NavBarHeader.swift
│   ├── Theme/
│   │   ├── ANTTheme.swift
│   │   └── Fonts/
│   └── Assets.xcassets/
├── ANTTests/
│   ├── APIClientTests.swift
│   ├── SocketClientTests.swift
│   ├── SessionStoreTests.swift
│   └── PendingActionQueueTests.swift
├── ANTUITests/
│   └── NavigationFlowTests.swift
├── .gitignore
├── README.md
└── LICENSE
```

---

## 10. Testing Strategy

- **Unit tests**: APIClient, SocketClient, SessionStore, PendingActionQueue
- **UI tests**: Navigation flows (tab switching, push/pop, swipe actions)
- **Manual testing**: Against running ANT server over Tailscale
- **No snapshot tests for v1** — visual verification via Pencil mockups + manual

---

## 11. Future Considerations (Post-v1)

- Push notifications via APNs (resume commands, new messages, pattern-matched terminal output)
- iPad adaptive layout
- macOS Catalyst or native macOS target
- Light theme
- Full terminal emulator mode (pro toggle)
- File upload attachments in conversations
- Biometric auth (Face ID / Touch ID) for sensitive sessions
- Widget for session status on home screen
