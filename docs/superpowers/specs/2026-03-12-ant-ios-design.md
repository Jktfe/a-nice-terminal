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
| Networking | URLSession for REST, custom Socket.IO client over NWWebSocket |
| Offline cache | SwiftData |
| Auth | API key stored in Keychain |
| Connectivity | NWPathMonitor for online/offline detection |
| Queued writes | PendingAction table in SwiftData, FIFO flush on reconnect |

### Key Decisions
- **No third-party UI libraries** — pure SwiftUI for full native feel
- **Lightweight Socket.IO client**: custom Swift implementation (packet protocol over WebSocket) rather than Socket.IO-Client-Swift pod
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
- **Server section**: URL field, API key (Keychain-backed), connection test button
- **Appearance**: Terminal font size slider (dark mode only for v1)
- **Cache**: "Clear offline data" button, cache size display
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
| Terminal input | Queued in PendingAction table | Flushed in order |
| Create/rename/archive session | Queued | Flushed |

### SwiftData Models
- `CachedSession` — id, name, type, shell, cwd, workspaceId, archived, updatedAt
- `CachedMessage` — id, sessionId, role, content, format, status, createdAt
- `CachedTerminalChunk` — id, sessionId, chunkIndex, data, createdAt
- `PendingAction` — id, endpoint, method, body, createdAt (FIFO queue)

### Connection Lifecycle
1. App foreground: connect WebSocket
2. App background: disconnect after 30s (iOS limit)
3. App foregrounded again: reconnect, delta-sync all active sessions
4. Server unreachable: show OfflineBanner, switch to cache reads + write queuing

---

## 7. API Surface Used

### REST Endpoints
- `GET/POST/PATCH/DELETE /api/sessions` — Session CRUD
- `GET/POST/PATCH/DELETE /api/sessions/:id/messages` — Message CRUD
- `GET /api/sessions/:id/terminal/output` — Terminal history
- `POST /api/sessions/:id/terminal/input` — Terminal input
- `POST /api/sessions/:id/terminal/resize` — Resize (not needed for simplified view)
- `GET /api/search?q=<query>` — Global search
- `GET/POST/PATCH/DELETE /api/workspaces` — Workspace CRUD
- `GET /api/health` — Health check
- `GET /api/resume-commands` — Resume commands list

### WebSocket Events
- `join_session` / `leave_session` — Subscribe/unsubscribe
- `terminal_input` — Send input
- `terminal_output` — Receive output chunks
- `message_created` / `message_updated` / `message_deleted` — Message sync
- `stream_chunk` — Streaming message content
- `session_list_changed` — Session updates
- `session_health` — Terminal alive status

---

## 8. Authentication

### v1: Tailscale + API Key
- Phone on Tailscale network, hits ANT server at Tailscale IP
- API key stored in iOS Keychain via `KeychainHelper`
- Sent as `Authorization: Bearer <key>` header

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
