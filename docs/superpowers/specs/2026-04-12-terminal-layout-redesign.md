# Terminal Layout Redesign — Mobile-First Space Optimisation

**Date:** 2026-04-12
**Status:** Approved (Pencil canvas `antV3.pen`, screens "iPhone — Terminal" + "iPhone — Terminal (Input Active)")
**Scope:** antios (iOS) + a-nice-terminal (web Terminal.svelte)

## Problem

The current terminal layout wastes ~90px of vertical space on iPhone:
- Navigation bar (back + Chat/Terminal picker + menu) = ~44px
- Oversized CLI input bar = ~52px
- Separate arrow-key row = ~40px

On a phone, every pixel matters for terminal scrollback.

## Design (two states)

### State 1: Terminal Idle (maximised)

Top-to-bottom, single vertical stack:

| Element | Height | Notes |
|---|---|---|
| **tmux status bar** | 22px | Green. Session ID left, pane_title + clock right. Replaces the old nav bar — this IS the session header. |
| **Terminal content** | fill remaining | xterm.js. Dark background (#0A0A0F). |
| **Scroll track** | full height, 32px wide | Right edge of terminal area. Wide enough for thumb-swipe on phone. Rounded 12px thumb. Dark track (#111318), thumb (#30363D). |
| **Special keys row** | 36px | Horizontally scrollable. Pill buttons: Esc, ↑, ↓, ←, →, Paste, ^C, ⇧Tab, Tab. Background #111318. |
| **Input row** | 48px | Single row: **← back/home** (34px square) \| **text field** (fill, rounded pill, "Type a command...") \| **📎 attach** (34px) \| **💬 Chat** (label+icon, switches to chat view) \| **↑ send** (34px circle, blue). |

No separate nav bar. No separate arrow row. Back button is inline with input.

### State 2: Input Active (slow edit open)

Triggered by tapping the input field.

| Element | Change from idle |
|---|---|
| Terminal content | **Dims to 40% opacity** — still visible for reference but not interactive. |
| Scroll track | Dims with terminal. |
| **Slow Edit panel** (NEW) | Slides up from bottom, above keys row. Dark surface (#161B22), rounded top corners. Contains: header ("Slow Edit" + ✕ close), multi-line text area (100px, dark input, monospace), hint text ("Paste, type, or use voice — then tap Send"). |
| Special keys row | Unchanged — still accessible for escape sequences while composing. |
| Input row | Input field shows active text with blue border. Send button turns green (#22C55E). Back/attach/chat remain. |
| **iOS keyboard** | Slides up below input row. |

Dismiss: tap ✕, or tap Send (sends command + collapses panel), or tap dimmed terminal area.

## Scroll track behaviour

- Always visible (not auto-hiding) — thumb-swipe target for phone users.
- Maps to xterm.js scrollback position. Drag thumb = scroll terminal.
- Track fills right 32px of the terminal area. Terminal content sits to its left.
- When at bottom, thumb rests at bottom of track. Scrolling up moves thumb up.

## Chat/Terminal switching

The **💬 Chat** button in the input row replaces the old nav-bar picker. Tap → swaps to the linked chat view. The chat view has a mirrored **▷ Terminal** button in the same position to swap back.

## Implementation targets

### antios (iOS — `/Users/jamesking/CascadeProjects/antios`)
- `TerminalView.swift` — restructure VStack: tmux bar (top), HStack(xterm + scroll track), keys row, input row
- `XtermView.swift` — reduce to fill available space; scrollbar is OUTSIDE the WebView
- `TerminalControlBar.swift` — becomes the horizontally-scrollable keys row
- `CLIInputBar.swift` — becomes the compact input row with back/attach/chat/send inline
- New: `SlowEditPanel.swift` — the popup multi-line text area
- New: `TerminalScrollTrack.swift` — native UIView scroll track bound to xterm.js scrollback via JS bridge
- `SessionSpaceView.swift` — remove/hide the navigation bar when in terminal mode

### a-nice-terminal (web — `/Users/jamesking/CascadeProjects/a-nice-terminal`)
- `src/lib/components/Terminal.svelte` — mirror the same layout: tmux top, terminal + scroll track, keys row, input row, slow-edit overlay
- Existing slow-edit logic can be reused; just needs repositioning as a slide-up panel

## What NOT to change
- pty-daemon, pty-client, server.ts, db.ts — no backend changes
- The linked chat view layout — separate redesign if needed
- iPad layout — keeps the existing split-view / grid-view; this spec is phone-only
- tmux status bar content/format — unchanged, just repositioned
