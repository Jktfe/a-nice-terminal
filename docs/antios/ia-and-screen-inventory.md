# antios — IA + screen inventory (Slice A)

**Status:** Slice A — antios IA + CanvasGrid screen map for the core mobile flows. ANT Cards splits as its own focused slice (motion-heavy).
**Owners:** @antux (spec) · @codexuxant (state vocabulary for ANT Cards) · @antchatmacdev (build) · @antmacdevcodex (QC)
**Anchored to:** `design-principles.md` (the 10 load-bearing rules)
**Implementation note:** Every screen below ships as `CanvasGrid("ScreenName") { ScreenView() }` so CanvasGrid auto-captures it; JWPK screenshots the board from mobile.

---

## Top-level information architecture

```
TAB BAR (bottom):
┌───────────┬───────────┬───────────┬───────────┬───────────┐
│ ANT Cards │   Plans   │   Inbox   │     +     │  Settings │
│  (Home)   │           │   (asks)  │  (action) │           │
└───────────┴───────────┴───────────┴───────────┴───────────┘

FLOATING COMPOSE FAB (anchored bottom-right ~16pt margin):
                                              ╭───╮
                                              │ ✎ │  ← persistent, present
                                              ╰───╯     in every tab except
                                                        Settings; tap/hold/swipe
                                                        per Compose-* states
```

**Lock — tab-bar `+` IS the action centre** (Option A per @antchatmacdev flag #2). Per iOS HIG, FAB-as-action-centre is an Android/Material idiom; iOS expects action-add to live in the tab bar (Twitter, Instagram, X all do this). The persistent compose FAB is a DIFFERENT action surface (feedback into existing rooms, not adding new things to the substrate).

| Surface | Purpose | Trigger |
|---|---|---|
| Tab-bar `+` | **Adding NEW things to the substrate** — room, agent, LLM bridge | Tap the 4th tab |
| Compose FAB (bottom-right) | **Feedback INTO existing rooms** — text / voice / interview / ask | Tap (text), hold (voice), swipe (mode switch) — per Compose-* states in the Room view section |

Two distinct conceptual actions, two distinct surfaces.

| Tab | Default | Purpose | Primary action above fold |
|---|---|---|---|
| **ANT Cards** | ✓ cold-launch lands here | The magic moment + room switcher | Tap a room card → enter room |
| **Plans** | | Progress on plans/tasks across rooms | Tap a plan → view steps |
| **Inbox** | | Open asks needing you | Tap an ask → answer / route |
| **+** | | Add: new room / invite agent / bring-in-LLM | One tap → action sheet |
| **Settings** | | Account, status, notifications, sounds | One tap → list |

**Tap depth invariant:** every primary task completes in ≤ 3 taps from the tab bar (`tab → detail → action`).

---

## Screen inventory

Each row in this table becomes one `CanvasGrid("ScreenName") { ... }` capture. Implementer sees the entire IA as one CanvasGrid board.

### Cold-launch + auth

| CanvasGrid name | SwiftUI view | Purpose | Primary action | States to wrap |
|---|---|---|---|---|
| `SignIn-TeamLogin` | `SignInTeamLoginView` | Email + password + licence key entry | Tap "Sign in" | empty / partial / submitting / error / success |
| `SignIn-InviteToken` | `SignInInviteTokenView` | Server URL + room ID + invite token | Tap "Join" | empty / partial / submitting / error / success |
| `Launch-Empty` | `LaunchEmptyView` | Cold launch, no rooms yet | Tap "Start something" | (single state) |

### Home — ANT Cards (the magic surface, own slice)

| CanvasGrid name | SwiftUI view | Purpose | Primary action | States to wrap |
|---|---|---|---|---|
| `ANTCards-Stack` | `ANTCardsStackView` | 3D-stacked deck of room cards, ambient motion | Tap a card → lift | idle / loading / many-rooms / few-rooms / single-room |
| `ANTCards-Lifted` | `ANTCardsLiftedView` | One card lifted, hero number + 3 agents + timeline | Tap again → settle | live / settling / empty-activity / error |
| `ANTCards-Empty` | `ANTCardsEmptyView` | No rooms yet — onboarding prompt | Tap "Start a room" | (single state) |

**ANT Cards splits as its own design slice — see `ant-cards-feel-reference.md` for state vocabulary + motion exemplars. Implementer wraps the state-list once codex's vocabulary is locked.**

### Room view

| CanvasGrid name | SwiftUI view | Purpose | Primary action | States to wrap |
|---|---|---|---|---|
| `Room-Chat` | `RoomChatView` | The chat stream inside a room | Compose / read / scroll | idle / loading / live / empty / error |
| `Room-Compose-Text` | `RoomComposeTextView` | Persistent compose FAB, text mode | Tap Send / ⌘↩ | idle / drafted / sending / sent / error |
| `Room-Compose-Voice` | `RoomComposeVoiceView` | Hold-to-record voice mode | Release → preview → send | recording / preview / sending / sent / error |
| `Room-Compose-Interview` | `RoomComposeInterviewView` | Structured Q&A mode | Step through prompts | step-1 / step-N / submitting / done |
| `Room-Compose-Ask` | `RoomComposeAskView` | File a new ask in this room | Tap "Raise ask" | empty / drafted / submitting / done |
| `Room-Context-Sheet` | `RoomContextSheetView` | **Dockable bottom handle** (Option B) — persistent ~24 pt strip at the bottom edge of room view with a visible grabber dot. Tap or swipe-up opens the sheet to a half-screen detent (browse); second swipe opens full-screen (deep search). iOS-17 sheet detents (`.medium`, `.large`). Reveals files / memories / artefacts for the current room. | Tap any item to open | docked / half / full / files-tab / memories-tab / artefacts-tab |
| `Room-Explain` | `RoomExplainView` | Long-press any term → inline grounded Explain panel (premium, Chair-pair). **Slice A scope:** locked-with-warn placeholder only — no Explain wiring until the Chair strategy session lands. | Tap "Unlock with Pro" or dismiss | locked-with-warn (Slice A) / future: resolving / resolved / no-grounding |

**Draft preservation:** every Compose-* state persists on every keystroke. Restore on foreground. Warn on swipe-away if dirty. Three failure modes covered: backgrounding / room-switch / network-drop.

### Plans

| CanvasGrid name | SwiftUI view | Purpose | Primary action | States to wrap |
|---|---|---|---|---|
| `Plans-List` | `PlansListView` | All active plans across rooms | Tap a plan → detail | loading / empty / few / many / error |
| `Plans-Detail` | `PlansDetailView` | One plan's steps + progress + room link | Tap a step → ?? (out of scope this slice) | loading / on-track / blocked / done |

### Inbox (Asks)

| CanvasGrid name | SwiftUI view | Purpose | Primary action | States to wrap |
|---|---|---|---|---|
| `Inbox-List` | `InboxListView` | Open asks needing you, across rooms | Tap an ask → answer | loading / empty / few / many / error |
| `Inbox-Ask-Detail` | `InboxAskDetailView` | One ask + room context + answer composer | Submit answer | answering / submitting / answered / error |

### + (Action sheet — bringing things into ANT)

| CanvasGrid name | SwiftUI view | Purpose | Primary action | States to wrap |
|---|---|---|---|---|
| `Plus-Sheet` | `PlusActionSheetView` | New room · Invite agent · Bring in LLM (4 vendors) | Tap an action | (single state — buttons only) |
| `Plus-NewRoom` | `PlusNewRoomView` | Create a new room | Tap "Create" | empty / named / submitting / done |
| `Plus-InviteAgent` | `PlusInviteAgentView` | Pick an agent or paste handle | Tap "Invite" | picker / pasted / submitting / done |
| `Plus-BringIn-Claude` | `BringInClaudeView` | Deep-link to Claude Desktop / Claude Mobile | Tap "Open Claude" | known-path / unknown-path |
| `Plus-BringIn-ChatGPT` | `BringInChatGPTView` | Deep-link or paste-buffer | Tap "Open" | known-path / unknown-path |
| `Plus-BringIn-Gemini` | `BringInGeminiView` | Same | Tap "Open" | known-path / unknown-path |

### Settings

| CanvasGrid name | SwiftUI view | Purpose | Primary action | States to wrap |
|---|---|---|---|---|
| `Settings-Home` | `SettingsHomeView` | Account / Status / Notifications / Sounds & haptics / Sign out | Tap a row | (single state) |
| `Settings-Status` | `SettingsStatusView` | Pick: Working / Away from desk / Away from office (Slice 8) | Tap a status | (3 states — one per status) |
| `Settings-Notifications` | `SettingsNotificationsView` | Push permission + per-category toggles | Tap a toggle | granted / denied / partial |
| `Settings-Sounds` | `SettingsSoundsView` | Mute toggle for ANT Cards card-lift sounds | Tap toggle | on / off |

---

## iPhone vs iPad

iPhone is the design substrate. iPad gets a 2-column layout in landscape:

| iPhone | iPad landscape |
|---|---|
| Tab bar bottom | Sidebar left (icon + label) |
| ANT Cards full-screen | ANT Cards in detail pane, sidebar shows: ANT Cards · Plans · Inbox · + · Settings |
| Compose sheet from bottom | Compose sheet from bottom OR side panel |
| Room view full-screen | Room view in detail pane; sidebar can pin to a specific room |
| Context sheet up | Context inspector as right rail |

Apple Pencil support: hand-written notes in Compose-Interview mode (deferred to Slice B+).

**Cross-team coordination ask:** iPad layout decisions can be delegated once the iPhone is solid; do not over-design iPad up-front.

---

## What this slice EXCLUDES (banked for later slices)

- **ANT Cards motion + state implementation** — `ant-cards-feel-reference.md` covers vocabulary; SwiftUI motion prototype lands in its own slice once codex locks the state list
- **Chair / EXPLAIN-THIS server endpoint** — folds into the paused Chair strategy session
- **Server-side `room.purpose` + `room.plan_id` + `GET /api/activity?roomId&since`** — Main team coordination via `hyz00k0ibh`
- **Apple Pencil annotation in Compose-Interview** — deferred to Slice B+
- **Multi-device handoff (Continuity)** — deferred
- **Widget + Live Activity** — deferred

---

## Acceptance gate (for @antmacdevcodex)

Once Slice A IA is locked + the SwiftUI scaffolds land:

1. Every CanvasGrid name above maps to a real `CanvasGrid("Name") { ... }` capture in the antios project
2. Every screen's primary action is reachable in ≤ 3 taps from cold launch
3. Compose surfaces persist drafts on every keystroke; verified by foreground / room-switch / network-drop test
4. Tab bar respects the 5-item iOS convention without overflow
5. ANT Cards is the cold-launch destination, no other tab steals first-paint
6. Room header surfaces `room.purpose` chip when present; renders "Set purpose" nudge when nil
7. Inbox list is curated (asks needing me only), not a chat firehose
8. VoiceOver labels on every interactive element + correct focus order per screen
9. Build green + CanvasGrid board captures landed in the project folder
10. JWPK can screenshot the full board from mobile + recognise every screen by name

---

## Hand-off

@codexuxant — your ANT Cards state vocabulary lock unblocks the dedicated ANT Cards slice. Feel free to draft `ant-cards-states-locked.md` companion or merge into the feel-reference doc directly.

@antchatmacdev — feasibility-check the screen inventory above. Flag any view that fights SwiftUI / iOS-17 patterns (especially the Room-Compose-Voice hold-to-record + Room-Explain long-press + ANT Cards 3D stack) before writing the implementation plan.

@antmacdevcodex — the 10-item acceptance gate above is my proposal; amend or ratify in this room.

Slice A is the spec; Slice A approval unlocks the SwiftUI scaffold work.
