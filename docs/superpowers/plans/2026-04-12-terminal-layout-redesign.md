# Terminal Layout Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Maximise terminal viewport on iPhone by collapsing nav bar, adding a thumb-swipeable scroll track, and moving all controls into a compact bottom strip.

**Architecture:** Two-state layout (idle / input-active) implemented identically on antios (SwiftUI) and web (Svelte). No backend changes. The tmux status bar becomes the session header; slow-edit replaces direct keyboard input on mobile.

**Tech Stack:** SwiftUI + WKWebView + xterm.js (antios), Svelte 5 + xterm.js (web), existing WebSocket protocol unchanged.

**Spec:** `docs/superpowers/specs/2026-04-12-terminal-layout-redesign.md`

---

## File Map

### antios (`/Users/jamesking/CascadeProjects/antios`)

| Action | File | Responsibility |
|---|---|---|
| Modify | `ANT/Views/Session/Terminal/TerminalView.swift` | Restructure VStack: tmux bar → HStack(xterm, scroll track) → keys row → input row |
| Modify | `ANT/Views/Session/Terminal/XtermView.swift` | Expose scroll position via JS bridge for native scroll track |
| Modify | `ANT/Views/Session/Terminal/CLIInputBar.swift` | Replace with compact inline row (back/input/attach/chat/send) |
| Modify | `ANT/Views/Session/Terminal/TerminalControlBar.swift` | Already a ScrollView of pill keys — just needs height/padding tweaks |
| Create | `ANT/Views/Session/Terminal/SlowEditPanel.swift` | Slide-up multi-line text panel with dismiss/send |
| Create | `ANT/Views/Session/Terminal/TerminalScrollTrack.swift` | 32px native scroll track bound to xterm.js viewport |
| Modify | `ANT/Views/Shared/SessionSpaceView.swift` | Hide toolbar/nav bar in terminal mode |
| Modify | `ANT/Resources/xterm.html` | Add JS functions: getScrollInfo(), scrollToPosition(ratio) |

### a-nice-terminal (`/Users/jamesking/CascadeProjects/a-nice-terminal`)

| Action | File | Responsibility |
|---|---|---|
| Modify | `src/lib/components/Terminal.svelte` | Full layout restructure matching antios design |

---

## Part A: antios

### Task 1: Add xterm.js scroll bridge

**Files:**
- Modify: `ANT/Resources/xterm.html`

- [ ] **Step 1: Add JS scroll functions to xterm.html**

After the existing `term.onScroll` handler (~line 58), add:

```javascript
// Scroll bridge for native scroll track
function getScrollInfo() {
  const buffer = term.buffer.active;
  const totalRows = buffer.baseY + term.rows;
  const viewportTop = buffer.viewportY;
  const ratio = totalRows > term.rows ? viewportTop / buffer.baseY : 1;
  return JSON.stringify({
    ratio: ratio,
    totalRows: totalRows,
    viewportRows: term.rows,
    baseY: buffer.baseY,
    atBottom: buffer.viewportY >= buffer.baseY
  });
}

function scrollToRatio(r) {
  const target = Math.round(r * term.buffer.active.baseY);
  term.scrollToLine(target);
}
```

- [ ] **Step 2: Verify xterm.html loads without errors**

Build the project to confirm no JS syntax issues:
```bash
cd /Users/jamesking/CascadeProjects/antios
xcodebuild -scheme ANT -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```
Expected: BUILD SUCCEEDED

- [ ] **Step 3: Commit**
```bash
git add ANT/Resources/xterm.html
git commit -m "feat: xterm.js scroll bridge — getScrollInfo() + scrollToRatio()"
```

---

### Task 2: Create TerminalScrollTrack

**Files:**
- Create: `ANT/Views/Session/Terminal/TerminalScrollTrack.swift`

- [ ] **Step 1: Create the scroll track view**

```swift
import SwiftUI

struct TerminalScrollTrack: View {
    @Binding var scrollRatio: Double
    @Binding var isAtBottom: Bool
    var onScroll: (Double) -> Void

    @State private var isDragging = false

    var body: some View {
        GeometryReader { geo in
            let trackHeight = geo.size.height - 80 // top+bottom padding
            let thumbHeight: CGFloat = max(40, min(120, trackHeight * 0.15))
            let maxOffset = trackHeight - thumbHeight
            let thumbOffset = 40 + (1 - scrollRatio) * maxOffset

            ZStack(alignment: .top) {
                // Track background
                Rectangle()
                    .fill(Color(hex: "#111318"))

                // Thumb
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(hex: isDragging ? "#4B5563" : "#30363D"))
                    .frame(width: 24, height: thumbHeight)
                    .offset(y: thumbOffset)
                    .gesture(
                        DragGesture()
                            .onChanged { value in
                                isDragging = true
                                let newOffset = value.location.y - 40
                                let ratio = 1 - min(1, max(0, newOffset / maxOffset))
                                onScroll(ratio)
                            }
                            .onEnded { _ in
                                isDragging = false
                            }
                    )
            }
        }
        .frame(width: 32)
    }
}
```

- [ ] **Step 2: Build to verify**
```bash
cd /Users/jamesking/CascadeProjects/antios
xcodebuild -scheme ANT -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**
```bash
git add ANT/Views/Session/Terminal/TerminalScrollTrack.swift
git commit -m "feat: TerminalScrollTrack — 32px thumb-swipeable native scroll track"
```

---

### Task 3: Create SlowEditPanel

**Files:**
- Create: `ANT/Views/Session/Terminal/SlowEditPanel.swift`

- [ ] **Step 1: Create the slow edit panel**

```swift
import SwiftUI

struct SlowEditPanel: View {
    @Binding var text: String
    @Binding var isPresented: Bool
    var onSend: (String) -> Void
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Header
            HStack {
                Text("Slow Edit")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                Spacer()
                Button(action: { isPresented = false }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14))
                        .foregroundColor(Color(hex: "#8B949E"))
                }
            }

            // Multi-line input
            TextEditor(text: $text)
                .font(.system(size: 13, design: .monospaced))
                .foregroundColor(.white)
                .scrollContentBackground(.hidden)
                .background(Color(hex: "#1E2228"))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .frame(minHeight: 80, maxHeight: 120)
                .focused($isFocused)

            // Hint
            Text("Paste, type, or use voice — then tap Send")
                .font(.system(size: 11))
                .foregroundColor(Color(hex: "#8B949E"))
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(Color(hex: "#161B22"))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onAppear { isFocused = true }
    }
}
```

- [ ] **Step 2: Build to verify**
```bash
cd /Users/jamesking/CascadeProjects/antios
xcodebuild -scheme ANT -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**
```bash
git add ANT/Views/Session/Terminal/SlowEditPanel.swift
git commit -m "feat: SlowEditPanel — slide-up multi-line composer for mobile terminal"
```

---

### Task 4: Redesign CLIInputBar as compact inline row

**Files:**
- Modify: `ANT/Views/Session/Terminal/CLIInputBar.swift`

- [ ] **Step 1: Read the current file**

Read `CLIInputBar.swift` fully before editing.

- [ ] **Step 2: Rewrite as compact inline row**

Replace the body with a single HStack containing: back button (←), text field (rounded pill), attach button (📎), chat button (💬 Chat), send button (↑). All 34px height, 6px gap. Total row height: 48px with padding.

The text field should be non-editable (just a tap target) — tapping it sets a `@Binding var isSlowEditActive: Bool` to true, which the parent TerminalView uses to show SlowEditPanel.

Add new bindings/closures:
- `onBack: () -> Void` — fires when ← is tapped
- `onAttach: () -> Void` — fires when 📎 is tapped
- `onSwitchToChat: () -> Void` — fires when 💬 is tapped
- `@Binding isSlowEditActive: Bool`
- `displayText: String` — shows the slow-edit text preview in the pill when editing

- [ ] **Step 3: Build to verify**
```bash
xcodebuild -scheme ANT -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**
```bash
git add ANT/Views/Session/Terminal/CLIInputBar.swift
git commit -m "feat: CLIInputBar redesign — compact inline row with back/attach/chat/send"
```

---

### Task 5: Restructure TerminalView layout

**Files:**
- Modify: `ANT/Views/Session/Terminal/TerminalView.swift`

- [ ] **Step 1: Read the current file fully**

Read `TerminalView.swift` to understand all current state and bindings.

- [ ] **Step 2: Restructure the body**

The new VStack order:
1. **tmux status bar** — HStack, green background (#22C55E), 22px. Left: session name. Right: pane title from `terminalStore.paneTitle` + clock. (If pane title isn't available yet, show session name only.)
2. **HStack** filling remaining space:
   - **XtermView** (fill width)
   - **TerminalScrollTrack** (32px, bound to xterm scroll position)
3. **TerminalControlBar** — existing, unchanged (horizontally scrollable keys)
4. **CLIInputBar** — new compact row
5. **SlowEditPanel** — shown conditionally when `isSlowEditActive == true`, slides up between the keys row and CLIInputBar using a `.transition(.move(edge: .bottom))` animation

Add state:
- `@State private var isSlowEditActive = false`
- `@State private var slowEditText = ""`
- `@State private var scrollRatio: Double = 1.0`

Wire SlowEditPanel.onSend to: send text via `orchestrator.socketClient.sendTerminalInput(sessionId, slowEditText + "\n")`, then clear text + dismiss panel.

Wire CLIInputBar.onBack to dismiss / navigate back.
Wire CLIInputBar.onSwitchToChat to switch `sessionSpaceMode` to `.chat`.

- [ ] **Step 3: Build to verify**
```bash
xcodebuild -scheme ANT -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**
```bash
git add ANT/Views/Session/Terminal/TerminalView.swift
git commit -m "feat: TerminalView restructured — tmux top, scroll track, compact bottom"
```

---

### Task 6: Hide navigation bar in terminal mode

**Files:**
- Modify: `ANT/Views/Shared/SessionSpaceView.swift`

- [ ] **Step 1: Read the current file**

Read `SessionSpaceView.swift` to find where the NavigationStack/toolbar is configured.

- [ ] **Step 2: Hide the toolbar when mode is .terminal**

Add `.toolbar(.hidden, for: .navigationBar)` conditionally when `mode == .terminal`. The tmux status bar in TerminalView replaces the nav bar. When mode is `.chat`, the toolbar stays visible (chat still needs its own nav).

Also pass the `mode` binding and a `switchMode` callback so TerminalView's CLIInputBar can switch to chat.

- [ ] **Step 3: Build to verify**
```bash
xcodebuild -scheme ANT -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**
```bash
git add ANT/Views/Shared/SessionSpaceView.swift
git commit -m "feat: hide nav bar in terminal mode — tmux bar is the header"
```

---

### Task 7: Wire scroll track to xterm.js

**Files:**
- Modify: `ANT/Views/Session/Terminal/XtermView.swift`

- [ ] **Step 1: Read the current file**

Read `XtermView.swift` fully.

- [ ] **Step 2: Add scroll position callback**

In the Coordinator's `userContentController(_:didReceive:)` handler, add a new message handler `"terminalScrollUpdate"` that parses the scroll ratio from xterm.js and updates a `@Binding var scrollRatio: Double`.

In `xterm.html`, extend the existing `term.onScroll` handler to also post scroll info:
```javascript
term.onScroll(function() {
    var info = getScrollInfo();
    window.webkit.messageHandlers.terminalScrollUpdate.postMessage(info);
});
```

Add a method `scrollToRatio(_ ratio: Double)` on XtermView that calls `evaluateJavaScript("scrollToRatio(\(ratio))")` on the WebView.

- [ ] **Step 3: Build to verify**
```bash
xcodebuild -scheme ANT -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**
```bash
git add ANT/Views/Session/Terminal/XtermView.swift ANT/Resources/xterm.html
git commit -m "feat: bidirectional scroll bridge — xterm.js ↔ native scroll track"
```

---

### Task 8: Bump version + build + push

- [ ] **Step 1: Bump version**
```bash
cd /Users/jamesking/CascadeProjects/antios
sed -i '' 's/CURRENT_PROJECT_VERSION: 23/CURRENT_PROJECT_VERSION: 24/' project.yml
xcodegen
```

- [ ] **Step 2: Full build**
```bash
xcodebuild -scheme ANT -sdk iphoneos -configuration Release -archivePath build/ANT.xcarchive archive
```

- [ ] **Step 3: Commit + push**
```bash
git add -A
git reset HEAD .claude/ build/
git commit -m "feat: v2.1.0 (24) — terminal layout redesign, max viewport + scroll track"
git push origin main
```

- [ ] **Step 4: Export + upload to TestFlight**
```bash
xcodebuild -exportArchive -archivePath build/ANT.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/export
xcrun altool --upload-app -f build/export/ANT.ipa -t ios --apiKey 32BSGQ37S5 --apiIssuer 83b711a1-5edd-4f68-aa92-06ce20f94df3
```

---

## Part B: Web (Terminal.svelte)

### Task 9: Restructure Terminal.svelte

**Files:**
- Modify: `src/lib/components/Terminal.svelte`

- [ ] **Step 1: Read the current file fully**

Read all 391 lines of `Terminal.svelte`.

- [ ] **Step 2: Restructure the template**

Replace the current template (lines 336-391) with the new layout:

```
outer container (flex-col, full height)
├── tmux status bar (22px, green, session name + pane title)
├── terminal area (flex-1, flex-row)
│   ├── xterm.js div (flex-1)
│   └── scroll track div (32px, dark, with draggable thumb)
├── special keys row (36px, horizontally scrollable, pill buttons)
├── slow edit panel (conditional, slide-up, textarea + hint)
└── input row (48px: ← back | input pill | 📎 | 💬 Chat | ↑ send)
```

Reuse existing slow-edit state (`slowEdit`, `slowEditText`, `slowEditRef`) and send logic (`sendSlowEdit`). Add:
- `scrollRatio` state (updated via xterm.js `term.onScroll`)
- `specialKeys` array for the key buttons
- `onBack` / `onSwitchToChat` dispatched events

The input pill is a button that toggles `slowEdit = true` (not a real text input — same as antios design).

- [ ] **Step 3: Build to verify**
```bash
cd /Users/jamesking/CascadeProjects/a-nice-terminal
bun run build
```

- [ ] **Step 4: Commit + push**
```bash
git add src/lib/components/Terminal.svelte
git commit -m "feat: Terminal.svelte redesign — tmux top, scroll track, compact bottom"
git push origin main
```

---

## Verification Checklist

After all tasks:

- [ ] antios builds and uploads to TestFlight
- [ ] Web builds clean (`bun run build` + `svelte-check`)
- [ ] Terminal fills maximum vertical space on iPhone (no nav bar eating pixels)
- [ ] Scroll track appears on right, thumb-draggable, syncs with xterm.js viewport
- [ ] Special keys row scrollable horizontally, all keys send correct escape sequences
- [ ] Tapping input pill opens slow edit panel, terminal dims
- [ ] Sending from slow edit fires text to terminal and collapses panel
- [ ] ← back button navigates home, 💬 Chat switches to linked chat view
- [ ] iPad layout unchanged (split/grid views unaffected)
