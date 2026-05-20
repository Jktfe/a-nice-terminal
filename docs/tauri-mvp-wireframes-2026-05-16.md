# Tauri MVP Wireframes — macOS Native ANT Client

**Date:** 2026-05-16
**Scope:** design-only, no implementation until JWPK opens native-app gate
**Platform:** macOS (Tauri v2, Rust backend + web frontend)
**Purpose:** concrete brief for evolveanttauri before they improvise a different mental model

---

## 1. Architecture

```
┌─────────────────────────────────────────┐
│  Tauri App (macOS)                     │
│  ┌─────────────┐  ┌─────────────────┐ │
│  │ Rust Core    │  │ Web Frontend    │ │
│  │ - Menu bar   │  │ (Svelte 5)        │ │
│  │ - PTY bridge │  │ - Rooms view      │ │
│  │ - Keychain   │  │ - Room detail     │ │
│  │ - File I/O   │  │ - Composer        │ │
│  │ - Notifier   │  │ - Settings        │ │
│  └─────────────┘  └─────────────────┘ │
│         ↑                              │
│    HTTP + SSE (same contract as iOS)   │
│         ↓                              │
│  ANT Server :6458 (frozen, consume only)│
└─────────────────────────────────────────┘
```

- **Backend frozen:** consume 10 existing HTTP+SSE endpoints, zero server changes
- **Frontend stack:** Svelte 5 (same as web UI — reuse components where possible)
- **Rust layer:** platform-specific macOS integrations only

---

## 2. Window Strategy — Multi-Window vs Single-Window

| Mode | Windows | Use Case |
|------|---------|----------|
| **Dock app** | 1 main window + N room windows | Power user, multiple rooms side-by-side |
| **Menu bar only** | 0 (popover) | Quick status check, minimal footprint |
| **Room torn off** | Per-room window | Drag room tab to create standalone window |

**Default:** Single main window with tabbed rooms (like iTerm2/Safari).
**Menu bar:** Always-on icon with popover showing unread counts + quick actions.

---

## 3. Menu Bar Integration (macOS-only moat)

```
┌─────────────────────────┐
│ 🐜 3 │  ← Menu bar icon   │
│    with unread badge     │
└─────────────────────────┘

Click → Popover:
┌─────────────────────────┐
│ v3 to v4        ● 3    │ ← Room list with unread
│ Native apps       ● 1    │
│ ─────────────────────── │
│ + Join Room...         │
│ Settings               │
│ ─────────────────────── │
│ Quit ANT               │
└─────────────────────────┘
```

- **Menu bar icon:** ANT logo with dynamic unread badge (red circle + count)
- **Popover:** room list, unread per room, quick join, settings
- **Global shortcut:** Cmd+Shift+A toggle main window (NSGlobalMonitor)
- **Status:** online/offline indicator via /api/health poll

**Why native-only:** NSStatusBar requires macOS app bundle, unavailable to web.

---

## 4. Main Window — Rooms Sidebar + Detail

```
┌─────────────────────────────────────────────────────────────┐
│ ANT — Rooms                              [+] [🔍] [⚙️]       │
├──────────┬──────────────────────────────────────────────────┤
│ 🐜 Rooms  │  v3 to v4 review                   12:34 PM     │
│ ────────  │  ─────────────────────────────────────────────  │
│ ● v3→v4  │  @evolveantclaude: Triple-verification...       │
│   3 new   │                                                   │
│           │  @evolveantkimi: Proceeding with D...           │
│ ● Native  │                                                   │
│   1 new   │  [Type a message...]          [📎] [🎙️] [➤]     │
│           │                                                   │
│ OSS Mig   │  ─────────────────────────────────────────────  │
│           │  Terminals: codex (● live)  gemini (○ idle)     │
│ ────────  │  [▶ Run] [📋 History] [⚙️ Inject]              │
│ + Join    │                                                   │
│           │                                                   │
└──────────┴──────────────────────────────────────────────────┘
```

- **Sidebar:** room list with unread badges, section headers (pinned/active/archived)
- **Detail pane:** message stream (SSE-driven), composer, terminal toolbar
- **Toolbar:** room name, participant count, terminal status, settings gear
- **Resize:** sidebar collapsible to icon-only (like Slack)

---

## 5. Room Detail — Message Stream + Composer

**Message stream (same contract as iOS):**
- SSE subscription per room via `subscribeRoomStream()`
- `invalidateAll` catch-up on reconnect (same pattern as web/iOS)
- Message bubbles: sender avatar, handle, timestamp, text
- System messages: agent joined/left, terminal events, plan updates

**Composer:**
- Text input with @mention autocomplete (fetched from room participants)
- File attach: drag-and-drop or 📎 button → upload via existing `/api/file-refs`
- Voice note: 🎙️ button (defer to Phase 2)
- Send: Cmd+Enter or ➤ button

**Terminal toolbar (desktop-specific):**
- Active terminal list per room
- Quick actions: Run command, View history, Inject input
- PTY bridge launches via Rust `std::process::Command` (not web shell)

---

## 6. PTY Bridge — Native Terminal (macOS moat)

```rust
// Rust side (Tauri command)
#[tauri::command]
async fn spawn_terminal(session_id: String) -> Result<TerminalHandle, String> {
    let pty = portable_pty::native_pty_system();
    let pair = pty.openpty(PtySize { rows: 24, cols: 80, .. })?;
    let cmd = CommandBuilder::new("/bin/zsh");
    let child = pair.slave.spawn(cmd)?;
    
    // Stream output to frontend via Tauri event
    tokio::spawn(stream_to_frontend(pair.master, session_id));
    
    Ok(TerminalHandle { id: child.process_id() })
}
```

- **NOT a web shell:** native PTY via Rust `portable-pty` crate
- **Output streaming:** Tauri events (`emit`) to frontend, not WebSocket
- **Input injection:** frontend → Rust → PTY master write
- **Session persistence:** reconnect to same PTY if app restarts (via tmux/screen)

**Why native-only:** Web apps cannot allocate PTYs or spawn interactive shells.

---

## 7. QR Pairing + Deep Links (shared with iOS)

| Feature | macOS Implementation |
|---------|----------------------|
| **QR scan** | Use Mac camera or drag QR image onto app |
| **ant:// URL** | Register `CFBundleURLTypes` in Info.plist |
| **Deep link handler** | Tauri `deep-link` plugin → Rust → exchange token → store |
| **Keychain storage** | `kSecClassGenericPassword` for bearer tokens |

**Flow:**
1. User clicks "Join Room" → shows QR code from server
2. Or: scans QR from iOS device via Mac camera
3. ant:// redeem → token exchange → Keychain store
4. Frontend refreshes room list

---

## 8. Settings + Capability Negotiation

```
┌─────────────────────────────┐
│ Settings                    │
├─────────────────────────────┤
│ Server                      │
│ ┌─────────────────────────┐ │
│ │ https://localhost:6458  │ │
│ └─────────────────────────┘ │
│ Token: ●●●●●●●● (Keychain)  │
│                             │
│ Tier: OSS (free)            │
│ Features: chat, rooms, ...  │
│                             │
│ ─────────────────────────── │
│ Notifications               │
│ ☑ New messages              │
│ ☑ Terminal events           │
│ ☑ Ask answered              │
│                             │
│ ─────────────────────────── │
│ Appearance                  │
│ ☑ Menu bar icon             │
│ ☑ Dock badge                │
│ ☑ Dark mode                 │
│                             │
│ [Check for Updates]         │
│ Version: 1.0.0 (build 123)  │
└─────────────────────────────┘
```

- **Server URL + token:** editable, validated via `/api/health`
- **Tier discovery:** GET `/api/capabilities` on connect → show tier + available features
- **Notifications:** macOS notification center (NSUserNotification)
- **Auto-update:** UI stub — "Check for Updates" placeholder button. Working Sparkle pipeline deferred to Phase 2 (see §11).
- **Keychain:** all tokens stored in macOS Keychain, never plaintext

---

## 9. Notifications + Dock Badge

| Trigger | Notification | Dock Badge |
|---------|------------|------------|
| New message in subscribed room | Banner + sound | +1 |
| Terminal event complete | Banner | — |
| Ask answered | Banner | — |
| Agent joined/left | None | — |

- **macOS notification center:** NSUserNotification with room name + message preview
- **Click action:** bring app to foreground, navigate to room
- **Do Not Disturb respected:** query `NSWorkspace` for DND state
- **Badge:** cumulative unread across all rooms, cleared on foreground

**Why native-only:** Web notifications on macOS are sandboxed and less reliable.

---

## 10. File System Integration (desktop moat)

| Feature | Implementation |
|---------|---------------|
| **Drag-and-drop upload** | Drop file onto composer → `fs:read-file` Tauri API → base64 → POST `/api/file-refs` |
| **Download to Downloads** | Click file ref → `fs:write-file` → `~/Downloads/` |
| **Open in default app** | Double-click → `open::that` crate → system default handler |
| **Watch folder** | `notify` crate → auto-upload new files to room (opt-in) |

**Why native-only:** Web apps cannot write to arbitrary filesystem paths or watch directories.

---

## 11. Auto-Update — Phase 2 Architecture Note

**Status:** ❌ Deferred from Monday MVP. UI stub only in MVP (see §8).

**Phase 2 implementation:**

```
┌─────────────────────────────┐
│ Update Available             │
│ ANT 1.1.0 is ready.          │
│ • New: Voice notes           │
│ • Fix: SSE reconnect         │
│                              │
│ [Update Now]  [Later]      │
└─────────────────────────────┘
```

- **Sparkle 2.x:** standard macOS auto-update framework
- **Code-signed:** Developer ID certificate required for distribution
- **Changelog:** fetched from `/api/capabilities` or static JSON
- **Silent checks:** background poll every 24h
- **Pipeline:** GitHub Actions build → Apple notarization → Sparkle appcast
- **ETA:** 2 weeks minimum (cert procurement + pipeline setup)

**Why native-only:** Code signing + notarization requires Apple Developer account. Web apps have no equivalent.

---

## 12. MVP Cut for Monday NMVC

| Feature | In MVP | Post-MVP |
|---------|--------|----------|
| Multi-window rooms | ✅ | — |
| Menu bar icon + popover | ✅ | — |
| Room list + SSE chat | ✅ | — |
| Composer + @mentions | ✅ | — |
| Settings + server config | ✅ | — |
| QR pairing / deep links | ✅ | — |
| macOS notifications | ✅ | — |
| Dock badge | ✅ | — |
| PTY bridge (native terminal) | ✅ | — |
| Keychain token storage | ✅ | — |
| File drag-and-drop | ✅ | — |
| Spotlight integration | ❌ | Phase 2 |
| Sparkle auto-update | ❌ | Phase 2 |
| Voice notes | ❌ | Phase 2 |
| WidgetKit (macOS Sonoma+) | ❌ | Phase 2 |
| Apple Intelligence | ❌ | iOS 18.1+ |

---

## 13. API Endpoints Consumed (same as iOS)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/capabilities` | Tier discovery, feature flags |
| `GET /api/sessions` | Room list |
| `GET /api/sessions/:id/messages` | Message history |
| `POST /api/sessions/:id/messages` | Send message |
| `GET /api/sessions/:id/attachments` | File attachment list |
| `POST /api/sessions/:id/attachments` | Upload file |
| `GET /api/realtime/:id/events` | SSE stream |
| `GET /api/sessions/:id/participants` | Room members |
| `POST /api/chat-invites` | Create invite |
| `POST /api/qr-tokens` | QR pairing (deferred) |
| `GET /api/mcp/cli-verbs` | CLI discovery |
| `GET /api/diagnostics/summary` | Health check |

**Zero backend changes.** All endpoints exist and are frozen.

---

## 14. Boundaries + Out of Scope

**In scope (MVP):**
- macOS native client consuming existing HTTP+SSE APIs
- Menu bar, dock badge, notifications
- Native PTY bridge
- Keychain, file drag-and-drop
- QR pairing consumer side

**Out of scope (MVP):**
- Windows/Linux builds (Tauri supports them, but macOS is Monday target)
- Backend changes of any kind
- New API endpoints
- Commercial entitlement enforcement (client-side gating only)
- Receipt validation / App Store purchase flow

---

## 15. Open Questions (JWPK Gates)

| # | Question | Default |
|---|----------|---------|
| 1 | Title bar style — unified (Safari-like) or traditional? | unified |
| 2 | Window restore — reopen previous rooms on launch? | yes |
| 3 | PTY default shell — zsh, bash, or user default? | user default via `$SHELL` |
| 4 | Menu bar-only mode — hide dock icon entirely? | no, show both |

