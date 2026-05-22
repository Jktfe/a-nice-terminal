# Slice 1 — visual evidence

6 PNGs captured 2026-05-22 from antchat commit `ef56b3b` (Slice 1 shell
scaffold + QC blocker fixes).

| File | Intended state | Captured state | Status |
|---|---|---|---|
| `01-default-1440x1080.png` | All visible | ops collapsed + bridges hidden (state-leak) | partial |
| `02-min-1280x800.png` | Min window | min window @ 1280×800 | clean |
| `03-sidebar-collapsed.png` | Sidebar collapsed | sidebar collapsed | clean |
| `04-ops-collapsed.png` | Ops collapsed | ops + bridges collapsed (state-leak) | partial |
| `05-shelf-collapsed.png` | Shelf collapsed | shelf collapsed | clean |
| `06-bridges-collapsed.png` | Bridges collapsed | bridges collapsed | clean |

## Known state-leak + layout caveats

**Layout fix landed AFTER these captures (commit follows this README).**
The PNGs show only 2 columns (sidebar + room) because the original
3-column NavigationSplitView form requires a sidebar selection to
drive the `content` slot — without one, OpsColumn rendered empty on
macOS. The fix rewires AppShellView to a 2-column NavigationSplitView
(sidebar + detail) with OpsColumn + RoomColumn in an HStack inside
detail. After this commit lands, OpsColumn renders alongside RoomColumn
by default. PNGs in this dir do NOT yet show the corrected layout —
they're proof-of-render and structural-coverage only.

**Toggle-back state-leak:** PNGs `01` and `04` carry residual
`ops.visible=0` + `bridges.hidden=1` state from the capture script's
toggle-back keystrokes that did not reach the app (focus moved off
Antchat between System Events sends).

**Re-capture friction:** The capture script subsequently retired in
favour of an in-session toolbar-driven approach (msg_0rvcrftqgz), but
re-capture hit a hard Keychain re-prompt friction (msg_l73v7wslbp):
ad-hoc-signed debug builds get a fresh code-sign hash per rebuild, and
macOS Keychain ACLs key on cert not bundle id, so Always-Allow does
NOT persist across rebuilds. Tracked for fix in Slice 1.5 (stable
Apple Development signing identity per @antux msg_l73v7wslbp).

## What these PNGs prove regardless of the state-leak

- Shell renders without crash; xcodebuild build + run launches succeed
- All 5 region chromes present and identifiable
  - Toolbar with `>_ANT` brand, "remoteant" title, ⌘K palette, Connected pill
  - Sidebar with SOURCES / SAVED ROOMS / ON THIS MAC eyebrows + skeleton rows
  - Ops column (when visible, e.g. shots 02 / 03 / 05) with FRIDAY/Today header
  - Room column with ACTIVE ROOM eyebrow + avatar stack + drop-hint + chat skeleton
  - Bridges strip with 12 chips when expanded, 16h sliver when hidden (shot 06)
- Tokens parity: warm ivory surface · accent coral · line-soft borders · soft pill backgrounds
- Premium tabs ★ Chair + ★ Validation styled warn + visually locked
- `.redacted(reason: .placeholder)` skeletons render across sidebar list, room chat, ops
  section cards (visible in every shot)

## Subsequent improvement (post-screenshot)

A separate commit adds 2 persistent toolbar leading toggles
(`sidebar.left` + `sidebar.squares.left`, state-filled icons) per
@antux patch 1 (msg_wb3wn09nrv). Fixes JWPK's UX blocker
(msg_5b98uvk01o) where a collapsed left pane had no on-screen
restore affordance. PNGs in this directory do NOT yet show the
new toolbar toggles — they will be re-shot after Slice 1.5 lands
the stable signing identity.
