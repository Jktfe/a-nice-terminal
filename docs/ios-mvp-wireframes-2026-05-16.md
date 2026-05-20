# Ant Chat iOS MVP — Wireframe + Interaction Spec

Date: 2026-05-16
Lane: pre-spawn design (no Swift code yet)
Audience: future Swift agent ramp-up
Scope: rooms list, room view, composer — the three surfaces needed for v4 go-live

---

## 1. Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Rooms Tab     │ ──▶ │   Room View     │ ──▶ │  Composer     │
│  (list + nav)   │     │  (chat + info)  │     │  (input sheet)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │
         ▼                       ▼
   GET /api/chat-rooms      GET /api/chat-rooms/:id/messages
   GET /api/asks            SSE /api/realtime/:id/events
   GET /api/health          POST /api/chat-rooms/:id/messages
```

**Backend contract:** Reuse the same HTTP + SSE surface the web UI uses. No iOS-specific API additions.

---

## 2. Rooms List View

### Purpose
Primary entry surface. Shows recent rooms, open asks, and quick actions. Mirrors the web Dashboard + Rooms list.

### Layout (iPhone portrait)
```
┌─────────────────────────────┐
│  ⌘ ANT Chat        [+]      │  ← nav bar: brand + new-room button
├─────────────────────────────┤
│  🔴 Live    Server: ok      │  ← status pill (green/yellow/red)
├─────────────────────────────┤
│  Awaiting decisions         │  ← section header
│  ┌─────────────────────┐    │
│  │ Ask: "Review PR #42"│    │  ← AskCard (tap → room)
│  │ @claude2  •  2m ago │    │
│  └─────────────────────┘    │
├─────────────────────────────┤
│  Recent rooms               │  ← section header
│  ┌─────────────────────┐    │
│  │ 🟢 antDevTeam       │    │  ← RoomCard (tap → room view)
│  │ 3 agents • 12 msgs  │    │     status dot = has unread
│  └─────────────────────┘    │
│  ┌─────────────────────┐    │
│  │ ⚪ compliance-review  │    │  ← grey dot = all read
│  │ 2 agents • 0 msgs   │    │
│  └─────────────────────┘    │
│                             │
│  [+] Create room            │  ← FAB (floating action button)
└─────────────────────────────┘
```

### Components
| Component | Source | Notes |
|---|---|---|
| Status pill | /api/health | Green = all boot flags true; yellow = degraded; red = unreachable |
| AskCard | /api/asks | Tap navigates to the ask's room |
| RoomCard | /api/chat-rooms | Shows name, member count, last message preview, unread dot |
| FAB | Local | Triggers "Create room" modal |

### Data flow
1. `onAppear` → fetch `/api/chat-rooms`, `/api/asks`, `/api/health`
2. Pull-to-refresh → same fetch
3. Tap room card → push Room View with `roomId`
4. Tap ask card → push Room View, scroll to ask context

### Empty states
- No rooms: "No rooms yet. Tap + to create one or use `ant invite` from a terminal."
- No asks: "No open asks. New decisions surface here automatically."

---

## 3. Room View

### Purpose
Chat surface + participant context. Shows messages, composer trigger, and room info.

### Layout
```
┌─────────────────────────────┐
│  ⟨ Back    antDevTeam  ℹ️   │  ← nav bar: back, room name, info button
├─────────────────────────────┤
│  ┌─────────────────────┐    │
│  │ @evolveantclaude    │    │  ← MessageBubble (incoming)
│  │ Phase 2 closed.     │    │
│  │        11:42        │    │
│  └─────────────────────┘    │
│            ┌────────────┐   │
│            │ @you       │   │  ← MessageBubble (outgoing)
│            │ Acknowledged│  │
│            │      11:43 │   │
│            └────────────┘   │
│  ┌─────────────────────┐    │
│  │ @evolveantdeep      │    │
│  │ Lane C verified...  │    │
│  │        11:44        │    │
│  └─────────────────────┘    │
│                             │
├─────────────────────────────┤
│  [🎤]  Type a message... [➤]│ ← composer bar (tap → full composer)
└─────────────────────────────┘
```

### Components
| Component | Source | Notes |
|---|---|---|
| MessageBubble | /api/chat-rooms/:id/messages | Incoming = left-aligned, grey. Outgoing = right-aligned, blue. System = centred, muted. |
| Timestamp | Local | Grouped by day ("Today", "Yesterday", date) |
| Typing indicator | SSE | Show "..." when SSE receives typing event |
| Composer bar | Local | Tap opens full composer sheet |
| Info button | Local | Push RoomInfo view (participants, mode, settings) |

### Data flow
1. `onAppear` → fetch `/api/chat-rooms/:id/messages` → render list
2. Start SSE connection to `/api/realtime/:id/events`
3. SSE `message_added` → append to list, scroll to bottom
4. SSE `typing` → show typing indicator for sender
5. Tap composer bar → present Composer sheet
6. Post message → optimistic local append + POST to API
7. On success → server confirms via SSE (no local state change needed)
8. On failure → show inline retry button on the optimistic bubble

### Real-time behaviour
- SSE auto-reconnects on network failure (EventSource native)
- `onConnect` callback triggers re-fetch of full message list (same as web: invalidateAll pattern)
- Background app → suspend SSE, foreground → reconnect + catch-up

### Gestures
- Pull up → load older messages (pagination: `?beforePostOrder=N`)
- Long-press message → context menu (reply, copy, react)
- Swipe left on outgoing message → edit/delete

---

## 4. Composer

### Purpose
Text input + attachment surface. Modal sheet that slides up from bottom.

### Layout
```
┌─────────────────────────────┐
│         ═══════             │  ← drag handle
├─────────────────────────────┤
│  Replying to @evolveantclaude│  ← reply context (if replying)
│  [x]                        │
├─────────────────────────────┤
│                             │
│  Type your message...       │  ← multi-line text view
│                             │
├─────────────────────────────┤
│  [📎]  [📷]  [🎤]     [➤]  │  ← toolbar: attach, photo, voice, send
└─────────────────────────────┘
```

### Components
| Component | Behaviour |
|---|---|
| Text view | Multi-line, auto-expands to 6 lines, then scrolls. Plain text for MVP; markdown rendering in bubbles only. |
| Attach button | Opens document picker (iOS UIDocumentPickerViewController). Uploads via `/api/upload` then references in message. |
| Photo button | Opens camera/photo library. Same upload path. |
| Voice button | Long-press to record, release to send. Uses iOS speech-to-text (SFSpeechRecognizer) or native audio recording. MVP: audio file upload with waveform placeholder. |
| Send button | Enabled when text non-empty or attachment selected. Disabled while sending. |

### Data flow
1. Type message → local draft (no server sync for MVP)
2. Tap send → POST `/api/chat-rooms/:id/messages` with body + optional attachment refs
3. Optimistic append to message list → dismiss composer
4. Server confirmation via SSE → no-op (already showing)
5. Failure → show toast "Message failed to send. Tap to retry."

### Keyboard handling
- Keyboard appears → composer sheet rises with keyboard
- Tap outside → dismiss keyboard, keep sheet open
- Tap background → dismiss sheet (discard draft with confirmation if text entered)

---

## 5. Room Info View

### Purpose
Read-only room metadata. Accessed via ℹ️ button in Room View nav bar.

### Layout
```
┌─────────────────────────────┐
│  ⟨ Back    Room Info        │
├─────────────────────────────┤
│  antDevTeam                 │
│  v3 to v4 review room       │
├─────────────────────────────┤
│  Participants               │
│  ┌─────────────────────┐    │
│  │ 🟢 @evolveantclaude│    │
│  │ 🟡 @evolveantkimi   │    │
│  │ ⚪ @evolveantdeep   │    │
│  └─────────────────────┘    │
├─────────────────────────────┤
│  Room mode: brainstorm        │
│  Responders: @claude2, @kimi│
├─────────────────────────────┤
│  [Share invite link]        │
│  [Leave room]               │
└─────────────────────────────┘
```

### Data
- Room name, description
- Participants list with online status (from SSE subscriber counts or presence API)
- Room mode (brainstorm/heads-down/closed)
- Responders list
- Share invite link (generates `/api/chat-invites`)
- Leave room (removes membership)

---

## 6. Navigation Structure

```
TabBarView
├── RoomsTab (NavigationStack)
│   ├── RoomsListView
│   └── RoomView
│       ├── Composer (sheet)
│       └── RoomInfoView
├── TerminalsTab (placeholder — v1.1)
├── PlansTab (placeholder — v1.1)
└── SettingsTab
    ├── Account
    ├── Server URL
    └── About
```

MVP scope: RoomsTab only. Other tabs show "Coming in v1.1" placeholder.

---

## 7. API Surface Summary

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Status pill |
| `/api/chat-rooms` | GET | Rooms list |
| `/api/asks` | GET | Open asks |
| `/api/chat-rooms/:id` | GET | Room metadata |
| `/api/chat-rooms/:id/messages` | GET | Message history |
| `/api/chat-rooms/:id/messages` | POST | Send message |
| `/api/realtime/:id/events` | SSE | Live events |
| `/api/chat-rooms/:id/members` | GET | Participants |
| `/api/chat-invites` | POST | Create invite |
| `/api/chat-rooms/:id/attachments` | GET | File attachment list |
| `/api/chat-rooms/:id/attachments` | POST | Upload file |

No new API endpoints needed. All reuse existing v4 surface.

---

## 8. Authentication

Reuse `antchat` token model:
1. First launch → prompt for server URL + invite code
2. Exchange invite → receive room token
3. Store token in iOS Keychain
4. All API calls include `Authorization: Bearer <token>`
5. Multiple rooms = multiple tokens (same as antchat CLI)

---

## 9. Offline Behaviour (MVP = graceful degrade)

| Scenario | Behaviour |
|---|---|
| No network on launch | Show cached rooms list from last session. Status pill = red. |
| No network in room | Show cached messages. Composer disabled. Banner: "Offline — messages will send when connected." |
| Send while offline | Queue in local draft. Retry on reconnect. No optimistic append. |
| Background app | Suspend SSE. Foreground → reconnect + catch-up via invalidateAll pattern. |

---

## 10. Swift Agent Ramp-Up Checklist

When Swift agent arrives, hand them this doc +:
- [ ] API contract: reuse the exact same JSON shapes the web UI uses
- [ ] SSE client: EventSource Swift library or URLSession with streaming
- [ ] No new backend work — backend is done
- [ ] Start with RoomsListView → RoomView → Composer in that order
- [ ] Use SwiftUI + async/await + @Observable for state
- [ ] Test against live :6174 server, not mocks

---

## Open Questions (for JWPK or Swift agent)

1. Should the iOS app support multiple servers simultaneously, or one-at-a-time like antchat CLI?
2. Push notifications — deferred to v1.1, or MVP?
3. Dark mode — follow iOS system setting, or manual toggle?
4. iPad support — universal app, or iPhone-only MVP?
