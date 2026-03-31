# ANT iOS — Native Mobile App Design Spec

**Date**: 2026-03-30
**Status**: Approved
**Repo**: `~/projects/antios` (private, open-source later)
**Mockups**: `docs/mockups.pen` — frames `iOSIg`, `iJfs7`, `y1sDB`, `2Y0Qb`, `SixBm`, `1mKKf`

---

## 1. Overview

A native iOS app for ANT (A Nice Terminal) — a premium mobile client connecting to the ANT server over Tailscale. The app is session-centric: a session is the atomic unit of work, containing both its chat history and its terminal in one place. Users move between sessions rather than between app-level feature tabs.

### Goals
- Premium iOS-native UX in SwiftUI with both dark and light mode
- Session-centric navigation — the sessions list IS the Chairman overview
- Chat mode: full-screen threading with streaming bubbles and X-Ray cross-referencing
- Terminal mode: progressive disclosure — KEY SIGNALS default view, RAW toggle to drill in; split scrollable output + keyboard-aware docked input (solves typing blind with keyboard covering input)
- Voice: three ambient sub-modes (Listen / Dictate / Replay) powered by ElevenLabs with a pluggable model API
- Context-aware quick phrases — CLI commands in terminal, chat phrases in chat
- File preview and URL auto-conversion (localhost → Tailscale equivalent)
- iPhone text replacement support via standard UITextView
- Tailscale IP authentication with API key

### Also in v1
- **Push notifications** via APNs — new messages, terminal pattern matches, resume commands, Chairman approvals
- **iPad adaptive layout** — sidebar + detail split view on iPad; macOS Catalyst excluded for now
- **Full xterm terminal emulator** — available as a third terminal view mode ("XTERM") alongside KEY SIGNALS and RAW
- **File upload** — attach images (JPEG/PNG/GIF/WEBP, 10 MB max) to chat messages via the attachment button in the input bar

### Non-Goals (v1)
- Biometric auth (post-v1)
- macOS Catalyst

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Platform | iOS 17+ (iPhone primary, iPad adaptive), Swift 6, Xcode 16 |
| UI | SwiftUI + Observation framework |
| Navigation | NavigationStack with typed destinations; UISplitViewController for iPad |
| State | `@Observable` classes (SessionStore, MessageStore, TerminalStore, VoiceStore) |
| Networking | URLSession for REST, Socket.IO-Client-Swift (v16.x) for WebSocket |
| Offline cache | SwiftData |
| Auth | API key stored in Keychain |
| Connectivity | NWPathMonitor for online/offline detection |
| Queued writes | PendingAction table in SwiftData, FIFO flush on reconnect |
| Voice | ElevenLabs API via pluggable `VoiceProvider` protocol |
| File preview | QuickLook framework |
| Terminal emulator | WKWebView + xterm.js (XTERM mode only) |
| Push notifications | APNs via `UNUserNotificationCenter`; server-side dispatch requires `POST /api/devices` token registration endpoint (new server work) |

### Key Decisions
- **No third-party UI libraries** — pure SwiftUI for full native feel
- **Socket.IO-Client-Swift** handles Engine.IO transport, heartbeats, and reconnection
- **Three terminal view modes**: KEY SIGNALS (default) → RAW (attributed string) → XTERM (WKWebView + xterm.js). KEY SIGNALS and RAW use the split keyboard-aware layout. XTERM uses xterm.js's built-in terminal geometry and input handling, full-screen.
- **Split terminal layout** (KEY SIGNALS + RAW modes) — output area (~65%) scrolls independently from the keyboard-aware docked input; they never overlap
- **Pluggable voice provider** — `VoiceProvider` protocol means ElevenLabs can be swapped for other TTS/STT models per user preference
- **iPad**: adaptive split-view layout — sessions list as sidebar, session space as detail. Same SwiftUI codebase, no separate target.
- **File upload**: attachment button in Chat input bar; uses `PHPickerViewController` to select images, uploads via `POST /api/upload` (multipart/form-data), inserts returned URL into the message body before sending.

---

## 3. Design System

### Typography
- **Cormorant Garamond** — screen titles, session names in headers, voice transcript (editorial elegance)
- **Inter** — all UI text, labels, body, meta
- **JetBrains Mono** — all terminal output, command input, code snippets in chat

### Colour Tokens

| Token | Hex | Meaning |
|---|---|---|
| `emerald` | `#22C55E` | Terminal / active / running |
| `indigo` | `#6366F1` | Chat / thinking / AI |
| `amber` | `#F59E0B` | Voice / awaiting input |
| `red` | `#EF4444` | Error / stalled |
| `gold` | `#C9A962` | Chairman |

### Dark Mode Backgrounds
- Root: `#0B0B0E`
- Surface: `#16161A`
- Elevated: `#1E1E24`
- Terminal output: `#0D0D12`

### Light Mode Backgrounds
- Root: `#F8F8FC`
- Surface: `#FFFFFF`
- Elevated: `#F0F0F5`
- Terminal output: `#F4F4F8`

### Shared Rules
- Corner radii: 16–20px cards, 14px pills/chips, 20px input fields, 26–32px voice buttons
- Tab bar: floating pill (`#16161A` dark / `#FFFFFF` light), blur backdrop, 34px bottom safe area clearance
- Session card gradient: colour wash left → transparent (per-type accent colour at ~15% opacity)
- Session card left accent strip: 3px, full card height, accent colour, `cornerRadius: 2`
- Status dots: 8px circle, accent colour, live pulse animation when active

---

## 4. Navigation

### Tab Bar (3 tabs — floating pill)

| Tab | Icon | Screen |
|---|---|---|
| Sessions | `squares-2x2` (grid) | Sessions list — Chairman overview |
| Voice | `mic` | Voice ambient mode |
| Settings | `gear` | Configuration |

### Navigation Flows

```
Sessions → tap session card → Session Space (push)
                              ├── Chat Mode (default if session type = conversation)
                              └── Terminal Mode (default if session type = terminal)
                              (Chat/Terminal switcher in nav bar — toggles within same push)

Sessions → tap "+" → New Session sheet

Session Space (Chat) → tap X-Ray chip → Reference View (push)

Voice → full-screen ambient layer (not a push)

Settings → sub-rows push to detail screens
```

### Gestures
- Swipe left on session card: Archive / Delete
- Long press session card: context menu (rename, move workspace, pin)
- Pull to refresh: sync from server
- RAW button in terminal: toggles full output view (push or inline expand, TBD in implementation)

---

## 5. Screens

### 5.1 Sessions List — Chairman Overview (Dark: `iOSIg`, Light: `SixBm`)

The home screen doubles as the Chairman overview. Chairman's orchestration status surfaces here without a dedicated tab.

**Header (72px)**
- "ANT" title — Cormorant Garamond 52px, weight 300, letter-spacing –2
- Gold Chairman crown icon (right) — opens Chairman detail sheet
- Settings gear icon (right, secondary)
- Chairman status line — `● N agents active · N approval pending` in emerald/amber

**Workspace filter bar**
- Horizontal scroll pill strip: All (default active), then workspace names
- Active pill: accent-coloured fill; inactive: dim surface

**Session cards**
- Left accent strip (3px, corner 2, accent colour)
- Gradient wash: accent colour at ~12% opacity, left → transparent
- Session name — Inter medium
- Subtitle — type + status (e.g. `Terminal · working`, `Chat · thinking`)
- Status dot — live pulse if active, static if idle, static red if stalled
- Unread badge (indigo pill, top-right) if new messages since last view
- Drop shadow glow on active cards

**Empty state**: illustration + "No sessions yet" + create button

**Light mode**: white card backgrounds, same structure, colour accents remain, no glow shadows

---

### 5.2 Session Space — Chat Mode (Dark: `iJfs7`, Light: `1mKKf`)

Full-screen threading. Entering from a session card pushes here. Nav bar has Chat | Terminal segmented pill to switch modes within the same session.

**Nav bar**
- Back chevron, session name (Cormorant Garamond), type badge, ellipsis menu (rename, export, archive, delete)
- Chat | Terminal pill switcher (Chat active = indigo fill, Terminal active = emerald fill)

**Message list**
- `ScrollViewReader` with auto-scroll to latest
- Human bubbles: right-aligned, indigo → violet gradient, white text, `cornerRadius: [16,16,4,16]`
- Agent bubbles: left-aligned, `#1A1A22` dark surface, indigo 3px left accent strip, dim-white text, `cornerRadius: [16,16,16,4]`
- Streaming messages: pulsing cursor at end; partial content cached as `status: "streaming"`. On `message_updated` with `status: "complete"`, cursor removed and final content cached. Mid-stream offline: content preserved as `status: "incomplete"`, full fetch on reconnect.
- Long press bubble: copy action

**X-Ray Reference chip (Chairman feature)**
- Appears below agent bubble text when Chairman has tagged the message with cross-references
- Appearance: `🔗 N refs · <topic>` — indigo pill, indigo border at 45% opacity
- Tap → pushes to Reference View (see §5.2.1)
- Chairman is responsible for tagging messages server-side; the app reads `metadata.xray` on each message object

**X-Ray Reference View (§5.2.1)**
- Full push screen
- Header: topic name + total reference count
- Grouped list: each session that contains references, with message snippets
- Tap a snippet → pushes back into that session's Chat Mode, scrolled to the referenced message
- This is a read-only audit trail — not editable

**Quick phrases bar**
- Horizontal scroll strip of context-aware phrase pills above the input area
- In Chat mode: conversational phrases — `summarise this`, `continue`, `explain that`, custom
- Tap phrase: inserts into input field (does not auto-send)

**Input area** (keyboard-aware, docked)
- Rounded text field with placeholder `Message <session-name>...`
- Standard `UITextView` backing — inherits iPhone text replacement natively
- Attachment button (clip icon, dim): opens `PHPickerViewController` — images only (JPEG/PNG/GIF/WEBP, 10 MB max). On pick, uploads via `POST /api/upload`, shows inline preview thumbnail + progress, inserts returned URL into the message body
- Voice button (amber, mic icon): opens Voice mode with current session pre-selected
- Send button (indigo circle with arrow): sends via `POST /api/sessions/:id/messages`
- Input area has subtle indigo top border (`#6366F125`) to visually anchor it

**Light mode**: white/grey-50 message bubbles, indigo user bubble unchanged, same structure

---

### 5.3 Session Space — Terminal Mode (Dark: `y1sDB`)

The core pain point solved here: the keyboard no longer covers the output. The output area and input area are completely independent.

**Layout (from top to bottom)**
1. Status bar (44px)
2. Nav bar (52px) — same as Chat, Terminal pill active (emerald fill)
3. KEY SIGNALS header row (32px) — label left, RAW toggle right
4. Signal view (fills remaining space, ~65% of screen) — independently scrollable
5. Drag handle pill (16px)
6. CLI quick phrases bar (40px)
7. CLI input bar (52px) — always docked, keyboard-aware
8. Home indicator (34px)

**KEY SIGNALS view** (progressive disclosure, default)

Signals are classified and rendered with visual weight:

| Signal type | Visual treatment |
|---|---|
| Error / type error | Dark red tint background (`#EF44441A`), 3px red left accent strip |
| Collapsed verbose lines | Dim text `> N lines — npm install output`, tap to expand |
| Success / build complete | 3px green left accent strip, green circle icon |
| Prompt awaiting input | Amber tint background, amber border, inline `y` (emerald) / `n` (dim) buttons |
| Normal output | Standard dim text, no adornment |

Green ambient radial glow behind the signal area (low opacity, decorative).

**Three terminal view modes** — toggled via a three-segment control in the header (SIGNALS | RAW | XTERM):

**RAW mode**
- Replaces the signal view inline — no push, keyboard state and docked input preserved
- Full unfiltered `AttributedString`; drag handle, phrases bar, and input bar remain in place
- Colour coding: green for prompts, amber for warnings, red for errors, white for standard output

**XTERM mode**
- Full-screen `WKWebView` loading xterm.js — a real terminal emulator
- Input is handled by xterm.js directly (its own keyboard capture)
- The docked CLIInputBar is hidden in XTERM mode; xterm.js manages cursor and input
- WebSocket `terminal_output` events are forwarded to xterm.js via `WKScriptMessageHandler`
- Terminal input sent via `WKWebView.evaluateJavaScript` → `term.write(data)` which then posts back to Swift via message handler → `POST /api/sessions/:id/terminal/input`
- Preserves scrollback buffer inside xterm.js; no SwiftData caching of raw bytes in this mode

**CLI quick phrases bar**
- CLI-specific phrases: `git status`, `bun run dev`, `ctrl+c`, and any user-configured phrases
- Same pill design as Chat quick phrases
- Tap inserts into CLI input field

**CLI input bar** (always visible, always docked)
- `$` prompt in emerald (JetBrains Mono)
- Text field: JetBrains Mono, dark surface background
- Up arrow button: cycles through command history
- Full `UITextView` backing: supports iPhone text replacement
- On keyboard show: output area shrinks; input bar stays anchored above keyboard
- When terminal session is offline: field is disabled, placeholder reads `Terminal unavailable — reconnecting`

**Light mode**: `#F8F8FC` background, `#F4F4F8` output surface, accent colours unchanged, same signal classification

---

### 5.4 Voice Mode (Dark: `2Y0Qb`)

Accessed via the Voice tab. Ambient — not tied to a nav stack push.

**Header**
- Close (×) left, "Voice" title (Cormorant Garamond 24px, weight 300), settings sliders right
- Three sub-mode segmented control: **Listen** | **Dictate** | **Replay**

**Sub-modes**

| Mode | What it does |
|---|---|
| **Listen** | Ambient monitoring — streams the current active session's output to ElevenLabs TTS. User hears the AI responses spoken aloud. Amber waveform pulses with audio level. |
| **Dictate** | Push-to-hold or tap-to-toggle STT. Voice captured via ElevenLabs Whisper (or pluggable alternative). Transcribed text sent to the current session's chat input. |
| **Replay** | Plays back the last N messages from the current session as audio. User can chime in (pauses playback, opens dictate). |

**Context indicator**
- `● session-name · N ago` below the mode segmented control
- Green dot for active session, amber for idle

**Waveform area (180px)**
- 11 vertical bars, JetBrains Mono spacing, amber fill with varying opacity (40%–100%)
- Radial amber glow ellipse behind bars (absolute positioned, blur 30, low opacity)
- Bars animate with audio amplitude in real use

**Transcript area**
- Large Cormorant Garamond (26px, weight 300) — last spoken sentence
- Sub-label: `ModelName · session-name`

**Action row**
- Skip (previous): dim `#1E1E24` circle, 52px
- Chime in (centre): amber filled circle, 64px — interrupt and speak
- Stop: dim circle with stop icon, 52px

**ElevenLabs / Voice provider**
- `VoiceProvider` protocol: `func synthesise(text: String) async throws -> AudioData`, `func transcribe(audio: AudioData) async throws -> String`
- Default implementation: `ElevenLabsVoiceProvider` using ElevenLabs API
- API key stored in Keychain, configurable in Settings
- Model ID configurable (e.g. `eleven_turbo_v2`) — shown in Settings
- Alternative providers (e.g. OpenAI TTS, local Whisper) implement same protocol

**Light mode**: `#F8F8FC` background, amber tokens unchanged, amber waveform on light grey

---

### 5.5 Settings

Text-described; no dedicated mockup for v1.

**Server section** (device-local, not fetched from server)
- Tailscale IP / server URL text field
- API key field (masked, Keychain-backed)
- "Test connection" button → green tick or red error

**Voice section**
- ElevenLabs API key (masked, Keychain-backed)
- Voice model selector (e.g. `eleven_turbo_v2`)
- Voice provider selector (ElevenLabs / OpenAI TTS / custom)
- Playback speed slider

**Notifications**
- Toggle: new chat messages
- Toggle: terminal pattern matches (configurable regex, e.g. `error|FAILED`)
- Toggle: resume commands captured
- Toggle: Chairman approval requests

**Appearance**
- Dark / Light / System (follows iOS setting)
- Terminal font size slider (12–18px)
- Default terminal view mode (SIGNALS / RAW / XTERM)

**Quick phrases**
- Manage saved chat phrases
- Manage saved CLI phrases

**Cache**
- "Clear offline data" button + cache size display

**Troubleshooting**
- "Kill all terminals" → `DELETE /api/sessions/terminals/all`
- Logs viewer (last 100 console lines)

**About**
- Version, ANT repo link, open-source notice

---

## 6. File Preview and URL Handling

### File Preview
- When a message or terminal output contains a file path that resolves via the ANT server (e.g. `/home/user/report.pdf`), the app renders it as a tappable inline chip
- Tap → fetches file via `GET /api/files?path=<encoded-path>` and opens in QuickLook (`QLPreviewController`)
- Supported types: images, PDFs, text, code files (syntax highlighted via AttributedString)

### URL Auto-conversion
- ANT server sends URLs with `localhost` or `127.0.0.1`
- App maintains a `localhostMapping` in Settings: e.g. `localhost:3000` → `100.x.x.x:3000`
- At render time, all `localhost` URLs in messages and terminal output are rewritten using the mapping before display
- Tapping a converted URL opens in `SFSafariViewController` in-app
- If the mapping is not configured, `localhost` URLs show a warning chip: `⚠ localhost URL — configure Tailscale mapping`

---

## 7. Offline Strategy

| Action | Offline | On reconnect |
|---|---|---|
| Browse sessions | SwiftData cache | Refresh from server |
| Read chat messages | Cached messages | Fetch `?since=lastTimestamp` |
| Read terminal output | Cached chunks | Fetch `?since=lastChunkIndex` |
| Send chat message | Queued in PendingAction table | Flushed FIFO |
| Terminal input | **Disabled** — input bar shows reconnecting state | Resumes immediately |
| Session CRUD (create/rename/archive) | Queued | Flushed |

Terminal input is never queued — commands are context-dependent and the session may have been reaped.

### Error Handling
- **HTTP 4xx**: surface error toast, discard queued action if 404
- **HTTP 5xx**: retry 3× with exponential backoff (1s, 2s, 4s), then surface banner
- **Socket.IO**: handled by library — 5 attempts then "Connection lost" banner
- **Stale terminal**: `check_health` on reconnect; if reaped, show "Session expired" + offer new session

---

## 8. SwiftData Models

```swift
CachedSession    — id, name, type, shell, cwd, workspaceId, archived, updatedAt
CachedMessage    — id, sessionId, role, content, format, status, metadata (JSON string), createdAt
CachedTerminalChunk — id, sessionId, chunkIndex, data, createdAt
PendingAction    — id, endpoint, method, body (JSON string), createdAt
```

`metadata` on `CachedMessage` carries Chairman-tagged fields including `xray: { refs: Int, topic: String, linkedMessageIds: [String] }`.

---

## 9. API Surface Used

### REST
- `GET /api/sessions` — list (supports `?include_archived=true`)
- `GET /api/sessions/:id` — single session
- `POST /api/sessions` — create
- `PATCH /api/sessions/:id` — update (name, workspace_id, archived)
- `DELETE /api/sessions/:id` — delete
- `DELETE /api/sessions/terminals/all` — kill all terminals (Settings)
- `GET /api/sessions/:id/messages` — list (`?since=<ISO8601>&limit=N`)
- `POST /api/sessions/:id/messages` — send message
- `PATCH /api/sessions/:id/messages/:msgId` — update
- `DELETE /api/sessions/:id/messages/:msgId` — delete
- `GET /api/sessions/:id/terminal/output` — history (`?since=<chunkIndex integer>`)
- `POST /api/sessions/:id/terminal/input` — terminal input (`{ "data": "..." }`)
- `GET /api/search?q=<query>&limit=50` — global search
- `GET /api/workspaces` — list workspaces
- `POST /api/workspaces` — create workspace
- `PATCH /api/workspaces/:id` — update workspace
- `DELETE /api/workspaces/:id` — delete workspace
- `GET /api/health` — health check
- `POST /api/upload` — file upload, multipart/form-data; images only (JPEG, PNG, GIF, WEBP), 10 MB max; returns `{ url: string }`
- `POST /api/devices` — register APNs device token `{ token: string, platform: "ios" }`
- `DELETE /api/devices/:token` — unregister on app uninstall / sign-out

> `since` for messages = ISO8601 timestamp. `since` for terminal output = integer chunk index. These are different.

### WebSocket Events

| Event | Direction | Purpose |
|---|---|---|
| `join_session` | client → server | Subscribe to session |
| `leave_session` | client → server | Unsubscribe |
| `terminal_output` | server → client | Terminal output chunks |
| `message_created` | server → client | New message |
| `message_updated` | server → client | Message edited/completed |
| `message_deleted` | server → client | Message removed |
| `stream_chunk` | server → client | Streaming content `{ sessionId, messageId, role, format, content }` |
| `session_list_changed` | server → client | Sessions / workspaces changed |
| `session_health` | server → client | Terminal health status |
| `check_health` | client → server | Request health check |

Message sending is REST only (`POST /api/sessions/:id/messages`). WebSocket is receive-only for messages.

---

## 10. Authentication

### v1: Tailscale + API Key
- Device on Tailscale network, hits ANT server at Tailscale IP
- API key stored in iOS Keychain via `KeychainHelper`
- Sent as `Authorization: Bearer <key>` header (server also accepts `x-api-key`)

### Development (no Tailscale)
- Set `ANT_TAILSCALE_ONLY=false` on server, or add device IP to `ANT_ALLOWLIST`
- Default server restricts to `100.64.0.0/10`

---

## 11. Project Structure

```
antios/
├── ANT.xcodeproj
├── ANT/
│   ├── ANTApp.swift
│   ├── Core/
│   │   ├── Network/
│   │   │   ├── APIClient.swift
│   │   │   ├── SocketClient.swift
│   │   │   └── ConnectivityMonitor.swift
│   │   ├── Storage/
│   │   │   ├── SwiftDataModels.swift
│   │   │   ├── PendingActionQueue.swift
│   │   │   └── KeychainHelper.swift
│   │   ├── Auth/
│   │   │   └── ServerConfig.swift
│   │   └── Voice/
│   │       ├── VoiceProvider.swift          ← protocol
│   │       ├── ElevenLabsVoiceProvider.swift
│   │       └── VoiceStore.swift
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
│   │   ├── Session/
│   │   │   ├── SessionSpaceView.swift       ← host for chat/terminal switcher
│   │   │   ├── Chat/
│   │   │   │   ├── ChatView.swift
│   │   │   │   ├── MessageBubbleView.swift
│   │   │   │   ├── XRayChipView.swift
│   │   │   │   ├── ReferenceView.swift
│   │   │   │   └── MessageInputBar.swift
│   │   │   └── Terminal/
│   │   │       ├── TerminalView.swift        ← mode switcher host (SIGNALS/RAW/XTERM)
│   │   │       ├── SignalView.swift          ← KEY SIGNALS
│   │   │       ├── RawOutputView.swift
│   │   │       ├── XtermView.swift           ← WKWebView + xterm.js bridge
│   │   │       ├── QuickPhrasesBar.swift
│   │   │       └── CLIInputBar.swift
│   │   ├── Voice/
│   │   │   ├── VoiceView.swift
│   │   │   ├── WaveformView.swift
│   │   │   └── VoiceModeSwitcher.swift
│   │   ├── Settings/
│   │   │   ├── SettingsView.swift
│   │   │   ├── ServerConfigView.swift
│   │   │   ├── VoiceSettingsView.swift
│   │   │   └── QuickPhrasesEditorView.swift
│   │   └── Shared/
│   │       ├── StatusDot.swift
│   │       ├── PillTabBar.swift
│   │       ├── OfflineBanner.swift
│   │       ├── SessionModePill.swift        ← Chat|Terminal switcher
│   │       └── GradientCardBackground.swift
│   ├── Theme/
│   │   ├── ANTTheme.swift                   ← colour tokens, typography
│   │   └── Fonts/
│   └── Assets.xcassets/
├── ANTTests/
│   ├── APIClientTests.swift
│   ├── SocketClientTests.swift
│   ├── SessionStoreTests.swift
│   ├── PendingActionQueueTests.swift
│   └── SignalClassifierTests.swift          ← unit test signal classification logic
├── ANTUITests/
│   └── NavigationFlowTests.swift
├── .gitignore
├── README.md
└── LICENSE
```

---

## 12. Signal Classification Logic

The KEY SIGNALS view is powered by a `SignalClassifier` that processes raw terminal output chunks and emits typed signals. This is a client-side concern — no server changes required.

```swift
enum SignalType {
    case error(message: String)
    case success(message: String)
    case prompt(message: String, options: [String])   // e.g. y/n
    case collapsed(lineCount: Int, summary: String)
    case normal(message: String)
}
```

Classification rules (applied in order):
1. **Error**: line matches `/error|Error|ENOENT|✖|✗|failed|FAILED/` → `.error`
2. **Prompt**: line ends with `[y/N]`, `[Y/n]`, `(yes/no)`, or `?` after trimming → `.prompt`
3. **Success**: line matches `/✓|✔|success|Success|done|Done|complete|Complete|built in/` → `.success`
4. **Verbose burst**: 3+ consecutive lines matching `/node_modules|downloading|resolving|fetching/` → collapse into `.collapsed`
5. **Normal**: everything else

Unit tests in `SignalClassifierTests.swift` cover each rule.

---

## 13. Testing Strategy

- **Unit**: APIClient, SocketClient, SessionStore, PendingActionQueue, SignalClassifier
- **UI**: Navigation flows — tab switching, session push/pop, chat↔terminal mode toggle, X-Ray reference push
- **Manual**: Against live ANT server over Tailscale
- **No snapshot tests v1** — visual verification via mockups + manual

---

## 14. Future Considerations (Post-v1)

- **macOS Catalyst** — native macOS target
- **Biometric auth** — Face ID / Touch ID to gate app launch and reveal API key
- **Widget** — session status on home screen / lock screen via WidgetKit
- **Additional voice providers** — OpenAI TTS, local on-device Whisper, custom endpoints
- **Chairman approval actions** — respond to approval requests directly from lock screen notification
- **Video file preview** — AVKit inline player for video files from terminal output
