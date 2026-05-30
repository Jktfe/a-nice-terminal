# Mobile Terminals section — Settings sub-view spec

**Status:** v0.3 feature spec — non-blocking for v0.2.x ship, queued for after Plans/Inbox + ANT Cards + Room view fixes land
**Owners:** @codexuxant (build, polish lane) · @antmacdevcodex (QC) · @antux (UX)
**Plan / task:** `antios-make-it-functional-2026-05-26` task T11
**Trigger:** JWPK FlowDeck walkthrough 2026-05-26 (`msg_v2gpqd82hn`) — "on the settings page there should be a 'Terminals' section, for those who want to look at the terminals they've control of"

---

## What's a "Terminal" in ANT?

A **terminal** is a long-lived agent process (tmux pane or shell instance) that the user owns on their ANT server. Each terminal:

- Runs a CLI (Claude Code / Codex / pi / Gemini / etc) under a stable agent handle
- Lives across user sessions (per `project_long_lived_agents_positioning_2026_05_19` — "agent = substrate (memory + plan + room context + identity), LLM = muscle")
- Has a status (live / away / idle / not-responding)
- Surfaces via `GET /api/agents/availability` (per `project_ant_agents_status_tooling_2026_05_21`)
- Has properties: handle, status, last-activity-at, current model, cost tier, current room context

The mobile Terminals section lets the user **see** and (in v0.4) **control** these terminals without going to the Mac.

---

## IA placement

```
Settings tab
├── Account (existing)
├── Status (existing — Slice 8)
├── Notifications (existing)
├── Sounds & Haptics (existing)
├── ➕ Terminals (NEW — v0.3)
│   ├── My terminals (list view)
│   │   ├── [terminal-1]  → terminal detail view
│   │   ├── [terminal-2]  → ...
│   │   └── ...
│   └── ...
└── Sign out (existing)
```

The Terminals row sits between Sounds & Haptics + Sign out, since it's an "advanced/admin" surface for power users + matches the desktop placement convention.

---

## Settings row (entry point)

In `SettingsHomeView`:

```
┌─────────────────────────────────────┐
│  T  Terminals          7 running ▶  │
└─────────────────────────────────────┘
```

| Element | Spec |
|---|---|
| Icon | `terminal` SF Symbol (or `command.square`) in a coloured rounded square 28×28, `Tokens.purple` bg, white icon |
| Label | "Terminals" — 16pt weight 600 |
| Status text (right) | "N running" — 13pt `Tokens.ok` if > 0 active; "All idle" `Tokens.ink.muted` if 0 active; "Not connected" `Tokens.warn` if API errored |
| Chevron | Standard iOS row chevron |
| Tap → | Push `TerminalsListView` |

---

## TerminalsListView

Lists every terminal the user owns. Sourced from `GET /api/agents/availability` filtered to the current user's owned terminals.

```
╭─────────────────────────────────────╮
│ ← Settings    Terminals         (Refresh)│
├─────────────────────────────────────┤
│                                     │
│  ACTIVE (4)                         │  ← Section header
│                                     │
│  ┌────────────────────────────┐     │
│  │ ● @antchatmacdev           │     │  ← Row, 64pt tall
│  │   Sonnet 4.6 · in plan-rm  │     │
│  │   last activity 2m ago     │     │
│  └────────────────────────────┘     │
│  ┌────────────────────────────┐     │
│  │ ● @codexuxant              │     │
│  │   GPT-5 · in plan-rm       │     │
│  │   last activity 14s ago    │     │
│  └────────────────────────────┘     │
│                                     │
│  IDLE (2)                           │
│                                     │
│  ┌────────────────────────────┐     │
│  │ ◐ @speedykimi              │     │
│  │   Kimi K2 · no room        │     │
│  │   last activity 1h ago     │     │
│  └────────────────────────────┘     │
│                                     │
│  NOT RESPONDING (1)                 │
│                                     │
│  ┌────────────────────────────┐     │
│  │ ⚠ @qwen                    │     │
│  │   Qwen 3 · stalled         │     │
│  │   last activity 3h ago     │     │
│  └────────────────────────────┘     │
│                                     │
╰─────────────────────────────────────╯
```

### Row composition

| Element | Spec |
|---|---|
| **Status dot** | 10×10 circle, left edge of row. `Tokens.ok` (live) / `Tokens.warn` (idle) / `Tokens.accent` (not responding) |
| **Handle** | 16pt weight 700 `Tokens.ink.strong` |
| **Model + room context** | 13pt `Tokens.ink.soft` — format: `"<model> · <room or no-room>"`. Room name truncated at ~18 chars |
| **Last activity** | 11pt `Tokens.ink.muted` — `String.relativeShort` helper (the same `now / Nm / Nh / Nd / MMM d` format from Slice 3 ops column) |
| **Chevron** | Standard right chevron — tap pushes detail view |

### Sections

Group by status — Active / Idle / Not responding. Empty sections hidden.

### Refresh

- Pull-to-refresh on the list (`refreshable` modifier) — re-fetches `/api/agents/availability`
- Auto-refresh every 30s while view is on-screen
- Manual "Refresh" button in nav bar (top-right)

### Empty state

If user has no terminals:

```
   ┌───────────────────────────────┐
   │                               │
   │        T (icon, 60pt          │
   │        ink-muted)             │
   │                               │
   │     No terminals running      │
   │                               │
   │     Open ANT on your Mac to   │
   │     spawn agent terminals     │
   │     for your team.            │
   │                               │
   └───────────────────────────────┘
```

---

## TerminalDetailView

Tap a terminal row → push to detail. v0.3 = read-only; v0.4 adds control affordances (defer).

```
╭─────────────────────────────────────╮
│ ← Terminals     @antchatmacdev      │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐    │
│  │ ● Active                    │    │
│  │ Sonnet 4.6                  │    │
│  │ Last activity 2m ago        │    │
│  └─────────────────────────────┘    │
│                                     │
│  IN ROOM                            │
│  ┌─────────────────────────────┐    │
│  │ 🏠 plan-rm                  │    │
│  │ 3 active · last 14m         │    │
│  │ [Open room →]               │    │
│  └─────────────────────────────┘    │
│                                     │
│  CURRENT FOCUS                      │
│  ┌─────────────────────────────┐    │
│  │ "Building T2: Plans + Inbox │    │
│  │  iOS decode fix. Curl-      │    │
│  │  verified server fine,      │    │
│  │  AskStore decode failing."  │    │
│  └─────────────────────────────┘    │
│                                     │
│  CONTEXT WINDOW                     │
│  ┌─────────────────────────────┐    │
│  │ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░  48%   │    │
│  │ Next compaction at ~85%     │    │
│  └─────────────────────────────┘    │
│                                     │
│  RECENT MESSAGES (last 3)           │
│  ┌─────────────────────────────┐    │
│  │ • Posted to UX 2m ago       │    │
│  │ • Committed antios 12m ago  │    │
│  │ • Posted to plan-rm 14m ago │    │
│  └─────────────────────────────┘    │
│                                     │
│  ⚠ v0.4 will add: send message,    │
│  restart, pause, route mention      │
│                                     │
╰─────────────────────────────────────╯
```

### Sections

| Section | Source | v0.3? |
|---|---|---|
| **Status card** | `/api/agents/availability` row | ✅ |
| **In room** | `currentRoomId` from agent record + room data | ✅ |
| **Current focus** | Agent's most recent intent / `currentTask` field (if exposed) — may need Main team coordination | ✅ if API ready; placeholder string otherwise |
| **Context window** | Per-agent context-window state (% used + next compaction threshold) — per `project_agent_context_as_oss_positioning_2026_05_18` | ✅ if `/api/agents/<id>/context` exists; banked if not |
| **Recent messages** | Last 3 messages this agent posted across any room — needs a new endpoint OR query `/api/chat-messages?handle=X&limit=3` | ✅ if exists; defer if not |
| **Controls (v0.4)** | Send message / restart / pause / route mention | ❌ — placeholder banner only |

---

## Cross-team coordination

Endpoints needed (Main team confirmation):
1. `GET /api/agents/availability` — already exists per banked memory; verify shape includes `model`, `currentRoomId`, `lastActivityAt`
2. `GET /api/agents/<handle>/context` — context-window % used. May not exist; if not, defer this section to v0.4 alongside controls
3. `GET /api/chat-messages?handle=X&limit=3` — recent messages by handle. Might need a new endpoint or use existing message query with `authorHandle` filter

Bank as a coordination ask alongside the existing `room.purpose` + `/api/activity` items from earlier specs.

---

## States

| State | Render |
|---|---|
| Loading | Section headers + 3 skeleton rows per section |
| Loaded (terminals present) | Full list per spec above |
| Loaded (zero terminals) | Empty state card |
| Error (no cache) | "Couldn't load terminals" + Retry button |
| Error (with cache) | Cached list + small `Tokens.warn` "Reconnecting…" chip in nav bar |
| Refresh in-flight | Spinner in nav bar Refresh button position |

---

## PASS gate (for @antmacdevcodex)

1. Settings row "Terminals" renders with the right icon + label + count-or-status text
2. Tap row pushes TerminalsListView
3. List sections (Active / Idle / Not responding) render correctly grouped + sorted by status then by recency
4. Each row shows status dot + handle + model · room context + last activity time
5. Pull-to-refresh re-fetches; 30s auto-refresh while on-screen
6. Empty state renders when user has no terminals
7. Tap row pushes TerminalDetailView
8. Detail view sections (Status / In room / Current focus / Context window / Recent messages) render against real data
9. Tokens — no raw hex; status dot colours map to `Tokens.ok/warn/accent`
10. VoiceOver labels on every interactive element
11. v0.4 controls banner present as placeholder + clearly labelled as future
12. Build green + CanvasGrid captures for Terminals-List (4 states: loading/loaded/empty/error) + Terminal-Detail (2 states: active/not-responding)

---

## Implementation tools

```swift
// New files
ANT/Views/Settings/TerminalsListView.swift
ANT/Views/Settings/TerminalDetailView.swift
ANT/Models/Terminal.swift                // Terminal struct, Codable from /api/agents/availability
ANT/Services/TerminalsService.swift      // LoadState<[Terminal]> + 30s refresh

// SettingsHomeView modification
NavigationLink(destination: TerminalsListView()) {
    SettingsRow(icon: "terminal", iconBg: Tokens.purple, title: "Terminals", trailing: terminalsService.summaryText)
}

// TerminalsListView grouping
List {
    if !active.isEmpty {
        Section("Active") {
            ForEach(active) { TerminalRow(terminal: $0) }
        }
    }
    // idle, notResponding sections
}
.refreshable { await terminalsService.refresh() }
```

---

## Out of scope (v0.4 candidates)

- **Controls** — send-message-to-terminal, restart-terminal, pause-terminal, route-mention-into-terminal
- **Spawning** — create a new terminal from mobile (currently you SSH to Mac to do this)
- **Configuring** — adjust per-terminal settings (auto-compact behaviour, model preference, room subscriptions)
- **Live log tail** — see the terminal's stdout in real time
- **Cost meter** — running-spend-per-terminal (server-operator-side; matches the remoteant-no-cost-meter policy)

---

## Hand-off

@codexuxant — v0.3 build, polish lane. Lift `TerminalsService` shape from Slice 3's `AsksService` / `PlansService` (same `LoadState<T>` pattern). The `Terminal` model maps to whatever `/api/agents/availability` returns — confirm shape with @antchatmacdev before writing the Codable struct.

@antmacdevcodex — 12-item PASS gate. The empty-state + error-state coverage is the easy thing to skip; please don't.

@antux — design lead for any clarifications during build. Coordinated cross-team asks (`/api/agents/<handle>/context`, `/api/chat-messages?handle=X`) need to land in the Main-team room before v0.4 ships; v0.3 can ship without them (sections degrade to "Not available in v0.3" placeholders).
