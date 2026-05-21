# iOS Native App Research — Integration Opportunities

**Date:** 2026-05-16
**Scope:** research-only, no implementation
**Purpose:** identify Apple-platform integrations that create genuine native-only value

---

## 1. Siri & Shortcuts

| Integration | Value | ANT Fit |
|-------------|-------|---------|
| **Siri Intent** | "Hey Siri, check my ANT rooms" | Voice-first room status without opening app |
| **App Intent** | `/rooms` entity exposed to Shortcuts | Workflow automation: "When I leave office, mark me away in all ANT rooms" |
| **Shortcut Actions** | `ant-post-message`, `ant-list-rooms`, `ant-check-terminal` | Power-user automation, Shortcuts gallery |
| **Spotlight Indexing** | Rooms, tasks, plans indexed | Instant search from iOS home screen |

**Why native-only:** App Intents require app bundle ID provisioning, entitlements file, and App Store distribution. Cannot ship in OSS web wrapper.

---

## 2. WidgetKit

| Widget Type | Data | Update Strategy |
|-------------|------|-----------------|
| **Home Screen (small)** | Unread count + last message preview | Background refresh + push-driven |
| **Home Screen (medium)** | Room list with status dots | App Groups shared container |
| **Lock Screen** | Active terminal count | Live Activity tie-in |
| **StandBy** | Room activity timeline | iOS 17+ specific |

**Why native-only:** WidgetKit extensions are separate binaries with strict memory/CPU limits, require Xcode signing, and use `WidgetBundle` API unavailable to web.

---

## 3. Apple Intelligence (iOS 18.1+)

| Feature | ANT Application |
|---------|-----------------|
| **Writing Tools** | Summarize long room transcripts, proofread agent outputs |
| **Image Playground** | Generate visual summaries of room activity |
| **Genmoji** | Custom emoji reactions from text descriptions |
| **Siri with ChatGPT** | Natural language room queries: "What did evolveantclaude say about the migration?" |

**Why native-only:** Apple Intelligence APIs (`WritingTools`, `ImagePlaygroundView`) are UIKit/SwiftUI native. No web equivalent. Requires iOS 18.1+ runtime.

---

## 4. Live Activities & Dynamic Island

| Scenario | Live Activity Content |
|----------|----------------------|
| **Active terminal session** | Command running, elapsed time, ETA |
| **Long-running plan** | Progress bar, % complete, blocking items |
| **Room with pending asks** | "3 unanswered questions in v3-to-v4" |
| **Agent spawn in progress** | "Codex joining room..." with spinner |

**Why native-only:** `ActivityKit` framework, push-to-start tokens, exact Apple signing. No web fallback possible.

---

## 5. Push Notifications (APNs)

| Trigger | Payload | Action |
|---------|---------|--------|
| Message in subscribed room | `{roomId, messagePreview, sender}` | Deep link to room |
| Terminal event complete | `{terminalId, exitCode}` | Open terminal view |
| Ask answered | `{askId, answerer}` | Open ask thread |
| Agent joined/left | `{agentKind, roomId}` | Room list refresh |
| Plan milestone | `{planId, milestone}` | Plan view |

**Why native-only:** APNS requires Apple Developer account ($99/yr), p8 key, and app bundle ID. Cannot be OSS infrastructure.

---

## 6. Background Processing

| Task Type | Use Case | iOS API |
|-----------|----------|---------|
| **BGAppRefreshTask** | Poll SSE when foregrounded after long absence | `UIApplication.backgroundRefreshStatus` |
| **BGProcessingTask** | Sync room history for offline read | `BGTaskScheduler` |
| **URLSession background** | Upload large file refs | `URLSessionConfiguration.background` |
| **PushKit** | Silent push for real-time sync | `PKPushRegistry` (VoIP variant) |

**Why native-only:** Background execution is strictly policed by iOS. Web apps are suspended; native apps can request processing time.

---

## 7. Keychain & Secure Enclave

| Secret | Storage | Why |
|--------|---------|-----|
| Room bearer tokens | `kSecClassGenericPassword` with biometric lock | Tokens are credentials |
| ANT_API_KEY (if any) | Secure Enclave key generation | Hardware-backed crypto |
| QR pairing seed | `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` | Device-bound, not iCloud |

**Why native-only:** Web apps cannot access iOS Keychain. `localStorage` is trivially extractable. Native = real security.

---

## 8. App Groups & Shared Data

| Sharing Surface | Participants |
|-----------------|--------------|
| **App Group container** | Main app + Widget + Share Extension + Watch |
| **Room cache** | All extensions read latest room list |
| **Draft messages** | Share Extension drafts appear in main app composer |
| **Terminal scrollback** | Watch companion shows last 20 lines |

**Why native-only:** App Groups require team ID + bundle ID prefix registration. Web has no shared-container concept.

---

## 9. Share Extension

| Share Target | Action |
|--------------|--------|
| **URL from Safari** | Create room task: "Research this" |
| **Photo from Photos** | Attach to room message |
| **Text selection** | Post as message or create ask |
| **File from Files app** | Upload as file ref |

**Why native-only:** `SLComposeServiceViewController`, separate extension binary, Apple signing required.

---

## 10. Apple Watch Companion

| Watch App | Data Flow |
|-----------|-----------|
| **Complication** | Room unread count |
| **Glanceable terminal** | Last 5 lines from active terminal |
| **Quick reply** | Canned responses: "Acknowledged", "Standing by", "BLOCKER" |
| **Haptic notifications** | New message tap, different patterns for ask/terminal/chat |

**Why native-only:** watchOS is entirely native. No web runtime. `WKInterfaceDevice` haptics, `WCSession` paired communication.

---

## 11. Deep Linking (ant:// URL Scheme)

| URL | Action |
|-----|--------|
| `ant://room/NuK58yk82YXV9Ng6DK0ob` | Open room directly |
| `ant://terminal/abc123` | Open terminal view |
| `ant://task/WKQhLJd4` | Open task detail |
| `ant://qr/redeem?token=xyz` | QR pairing flow |
| `ant://settings` | Open settings |

**Why native-only:** Custom URL schemes require `CFBundleURLTypes` in `Info.plist` and Apple app association. Web uses `https://` only.

---

## 12. Summary: Native-Only Value Matrix

| Category | User Value | Commercial Defense |
|----------|-----------|-------------------|
| Siri/Shortcuts | Convenience | App Store only |
| Widgets | Glanceable info | Binary signing |
| Apple Intelligence | Premium AI | iOS 18.1+ runtime |
| Live Activities | Real-time awareness | ActivityKit API |
| Push Notifications | Instant delivery | APNS credentials |
| Background Sync | Reliability | BGTaskScheduler |
| Keychain Security | Trust | Secure Enclave |
| Share Extension | Workflow | Extension binary |
| Watch Companion | Ubiquity | watchOS native |
| Deep Linking | Speed | URL scheme registration |

**Conclusion:** iOS native value is not about "features OSS can't build" — it's about "features iOS literally prevents non-native apps from accessing." This is the strongest possible commercial moat because it's enforced by Apple, not by ANT code.
